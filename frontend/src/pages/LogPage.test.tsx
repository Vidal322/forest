import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Browser } from 'leaflet'
import { onlineManager } from '@tanstack/react-query'
import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { Zone } from '../api/plots'
import { isShownInline } from '../api/outbox'
import type { Task } from '../api/tasks'
import { fieldToday } from '../domain/dates'
import { fakeApi } from '../test/fakeApi'
import { testField, testPlot, testZone } from '../test/fixtures'
import { renderApp } from '../test/render'

const browser = Browser as { any3d: boolean }
const realAny3d = browser.any3d
beforeAll(() => {
  browser.any3d = true
})
afterAll(() => {
  browser.any3d = realAny3d
})

const dryZone: Zone = { ...testZone } // sown long ago: needs water
const freshZone: Zone = {
  ...testZone,
  id: '20000000-0000-4000-8000-000000000002',
  label: 'Encosta',
  last_sown_on: fieldToday(),
  needs_water: false,
}
const suber = { id: '30000000-0000-4000-8000-000000000001', scientific_name: 'Quercus suber', common_name: 'sobreiro', notes: null, updated_at: 'x' }

const sowTask: Task = {
  id: '40000000-0000-4000-8000-000000000001',
  plot_id: null,
  zone_id: dryZone.id,
  title: 'Falta semear',
  description: null,
  kind: 'sow',
  status: 'open',
  due_on: null,
  completed_at: null,
  resolved_by_activity_id: null,
  version: 3,
  created_at: '2026-11-01T10:00:00Z',
  updated_at: '2026-11-01T10:00:00Z',
}
const pathTask: Task = { ...sowTask, id: '40000000-0000-4000-8000-000000000002', title: 'Melhorar caminho', kind: 'improve_path', zone_id: null, plot_id: testPlot.id }
// on another zone, not chosen below
const otherTask: Task = { ...sowTask, id: '40000000-0000-4000-8000-000000000003', title: 'Regar encosta', kind: 'water', zone_id: freshZone.id }
const doneTask: Task = { ...sowTask, id: '40000000-0000-4000-8000-000000000004', title: 'Já feito', status: 'done', completed_at: 'x' }

function logApi(taskList: Task[] = []) {
  let db = [...taskList]
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(800)
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(600)
  return fakeApi({
    'GET /api/field': () => ({ status: 200, body: testField }),
    'GET /api/plots': () => ({ status: 200, body: [testPlot] }),
    'GET /api/zones': () => ({ status: 200, body: [dryZone, freshZone] }),
    'GET /api/species': () => ({ status: 200, body: [suber] }),
    'GET /api/activities': () => ({ status: 200, body: [] }),
    'GET /api/tasks': () => ({ status: 200, body: db }),
    'PUT /api/tasks/[^/]+': ({ path, body }) => {
      const b = body as Partial<Task> & { base_version: number | null }
      const { base_version: _b, ...rest } = b
      const t = db.find((x) => x.id === path.split('/').pop())!
      const saved = { ...t, ...rest, completed_at: b.status === 'done' ? 'now' : null, version: (b.base_version ?? 0) + 1 }
      db = [...db.filter((x) => x.id !== t.id), saved]
      return { status: 200, body: saved }
    },
    'PUT /api/activities/[^/]+': ({ path, body }) => ({
      status: 201,
      body: { id: path.split('/').pop(), ...(body as object), version: 1, created_at: 'x', updated_at: 'x' },
    }),
  })
}

const puts = (api: ReturnType<typeof logApi>) => api.calls.filter((c) => c.method === 'PUT')
const putBody = (api: ReturnType<typeof logApi>) => api.calls.find((c) => c.method === 'PUT')?.body as Record<string, unknown>

describe('LogPage', () => {
  it('waters every zone that needs it in three taps', async () => {
    const api = logApi()
    renderApp('/log')
    await userEvent.click(await screen.findByRole('button', { name: 'Todas as zonas por regar (1)' }))
    expect(screen.getByText('Escolhida: Clareira')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Rega/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Guardar/ }))

    expect(await screen.findByText('Rega guardada em Clareira, hoje.')).toBeInTheDocument()
    expect(putBody(api)).toEqual({
      type: 'watering',
      performed_on: fieldToday(),
      notes: null,
      zones: [{ zone_id: dryZone.id, quantity: null, unit: null }],
      species: [],
      base_version: null,
    })
    // the form is ready for the next entry
    expect(screen.getByText('Nenhuma zona escolhida')).toBeInTheDocument()
  })

  it('logs a sowing with covas per zone and a seed mix', async () => {
    const api = logApi()
    renderApp('/log')
    await userEvent.click(await screen.findByRole('button', { name: 'Escolher numa lista' }))
    const list = screen.getByRole('group', { name: 'Zonas' })
    await userEvent.click(within(list).getByRole('checkbox', { name: /Clareira/ }))
    await userEvent.click(within(list).getByRole('checkbox', { name: /Encosta/ }))
    await userEvent.click(screen.getByRole('button', { name: /Sementeira/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Por zona…' }))
    await userEvent.type(screen.getByRole('textbox', { name: /Clareira, covas/ }), '100')
    await userEvent.type(screen.getByRole('textbox', { name: /Encosta, covas/ }), '80')
    await userEvent.click(screen.getByRole('button', { name: 'sobreiro' }))
    await userEvent.click(screen.getByRole('button', { name: 'Ontem' }))
    await userEvent.click(screen.getByRole('button', { name: /^Guardar/ }))

    expect(await screen.findByText(/Sementeira guardada em Clareira e Encosta, a /)).toBeInTheDocument()
    const body = putBody(api)
    expect(body.type).toBe('sowing')
    expect(body.zones).toEqual(
      expect.arrayContaining([
        { zone_id: dryZone.id, quantity: 100, unit: 'holes' },
        { zone_id: freshZone.id, quantity: 80, unit: 'holes' },
      ]),
    )
    expect(body.species).toEqual([{ species_id: suber.id, quantity: null, unit: null, notes: null }])
  })

  it('says what is missing before saving', async () => {
    logApi()
    renderApp('/log')
    await userEvent.click(await screen.findByRole('button', { name: /^Guardar/ }))
    expect(screen.getByRole('alert')).toHaveTextContent('Toca nas zonas onde trabalhaste')
    await userEvent.click(screen.getByRole('button', { name: /Todas as zonas por regar/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Guardar/ }))
    expect(screen.getByRole('alert')).toHaveTextContent('Escolhe o que fizeste')
  })

  it('starts with the zone chosen on the map', async () => {
    logApi()
    renderApp(`/log?zone=${freshZone.id}`)
    expect(await screen.findByText('Escolhida: Encosta')).toBeInTheDocument()
  })

  it('without a connection, keeps the entry on the phone and recolours the map', async () => {
    const api = logApi()
    const { queryClient } = renderApp('/log')
    await userEvent.click(await screen.findByRole('button', { name: /Todas as zonas por regar/ }))
    api.fetchMock.mockImplementation(async (input) => {
      if (String(input) === '/healthz') return new Response('{"status":"ok"}')
      throw new TypeError('Failed to fetch')
    })
    await userEvent.click(screen.getByRole('button', { name: /Rega/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Guardar/ }))
    expect(await screen.findByText(/Guardado neste telemóvel/)).toBeInTheDocument()
    const zones = queryClient.getQueryData<Zone[]>(['zones'])!
    expect(zones.find((z) => z.id === dryZone.id)?.last_watered_on).toBe(fieldToday())
    expect(screen.queryByRole('button', { name: /Todas as zonas por regar/ })).not.toBeInTheDocument()
  })

  it('keeps the entry when the server refuses it, and says why', async () => {
    const api = logApi()
    renderApp('/log')
    await userEvent.click(await screen.findByRole('button', { name: /Todas as zonas por regar/ }))
    api.fetchMock.mockImplementation(async (input, init) => {
      if (init?.method === 'PUT')
        return new Response('{"error":{"code":"invalid","message":"pick the zones again","field":"zones"}}', { status: 422 })
      return new Response(String(input) === '/healthz' ? '{"status":"ok"}' : '[]')
    })
    await userEvent.click(screen.getByRole('button', { name: /Rega/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Guardar/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Zonas: pick the zones again.')
    expect(screen.getByRole('button', { name: /Rega/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('drops a count typed for another kind of work', async () => {
    const api = logApi()
    renderApp('/log')
    await userEvent.click(await screen.findByRole('button', { name: /Todas as zonas por regar/ }))
    await userEvent.click(screen.getByRole('button', { name: /Sementeira/ }))
    await userEvent.type(screen.getByLabelText(/Quantidade \(covas\)/), '100')
    await userEvent.click(screen.getByRole('button', { name: /Mais…/ }))
    await userEvent.click(screen.getByRole('button', { name: /Outro/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Guardar/ }))
    await screen.findByText(/Registo guardado em Clareira/)
    expect((putBody(api).zones as { quantity: unknown }[])[0]!.quantity).toBeNull()
  })

  it('refuses a typed day in the future', async () => {
    logApi()
    renderApp('/log')
    await userEvent.click(await screen.findByRole('button', { name: /Todas as zonas por regar/ }))
    await userEvent.click(screen.getByRole('button', { name: /Rega/ }))
    fireEvent.change(screen.getByLabelText('Outro dia'), { target: { value: '2999-01-01' } })
    await userEvent.click(screen.getByRole('button', { name: /^Guardar/ }))
    expect(screen.getByRole('alert')).toHaveTextContent('O dia não pode ser depois de hoje.')
  })

  it('undoes the entry just logged in one tap', async () => {
    const api = logApi()
    renderApp('/log')
    await userEvent.click(await screen.findByRole('button', { name: /Todas as zonas por regar/ }))
    await userEvent.click(screen.getByRole('button', { name: /Rega/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Guardar/ }))
    await screen.findByText(/Rega guardada em Clareira, hoje/)
    const id = api.calls.find((c) => c.method === 'PUT')!.path.split('/').pop()
    await userEvent.click(screen.getByRole('button', { name: 'Anular' }))
    expect(await screen.findByText('Registo anulado.')).toBeInTheDocument()
    await waitFor(() => expect(api.calls.some((c) => c.method === 'DELETE' && c.path === `/api/activities/${id}`)).toBe(true))
  })

  describe('closing tasks with the entry', () => {
    async function pickClareira(type: RegExp) {
      await userEvent.click(await screen.findByRole('button', { name: 'Todas as zonas por regar (1)' }))
      await userEvent.click(screen.getByRole('button', { name: type }))
    }

    it('lists the open tasks of the chosen zones and their plot, the matching kind ticked', async () => {
      logApi([sowTask, pathTask, otherTask, doneTask])
      renderApp('/log')
      await userEvent.click(await screen.findByRole('button', { name: 'Todas as zonas por regar (1)' }))
      // nothing to choose from before saying what was done
      expect(screen.queryByRole('group', { name: 'Também ficou feito' })).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: /Sementeira/ }))
      const group = await screen.findByRole('group', { name: 'Também ficou feito' })
      const boxes = within(group).getAllByRole('checkbox')
      expect(boxes.map((b) => b.closest('label')!.textContent)).toEqual([
        expect.stringContaining('Falta semear'),
        expect.stringContaining('Melhorar caminho'),
      ])
      expect(within(group).getByRole('checkbox', { name: /Falta semear/ })).toBeChecked()
      expect(within(group).getByRole('checkbox', { name: /Melhorar caminho/ })).not.toBeChecked()
      // another kind of work: nothing ticked by default
      await userEvent.click(screen.getByRole('button', { name: /Rega/ }))
      expect(within(group).getByRole('checkbox', { name: /Falta semear/ })).not.toBeChecked()
    })

    it('marks the ticked tasks done by the new entry, sent after it with their version', async () => {
      const api = logApi([sowTask, pathTask])
      const { queryClient } = renderApp('/log')
      await pickClareira(/Sementeira/)
      const group = await screen.findByRole('group', { name: 'Também ficou feito' })
      await userEvent.click(within(group).getByRole('checkbox', { name: /Melhorar caminho/ }))
      await userEvent.click(screen.getByRole('button', { name: /^Guardar/ }))

      expect(await screen.findByText('Sementeira guardada em Clareira, hoje. Tarefas feitas: Falta semear, Melhorar caminho.')).toBeInTheDocument()
      const closes = () => puts(api).filter((c) => c.path.startsWith('/api/tasks/'))
      await waitFor(() => expect(closes()).toHaveLength(2))
      expect(closes().map((c) => c.path).sort()).toEqual([`/api/tasks/${sowTask.id}`, `/api/tasks/${pathTask.id}`])
      const entryId = (closes()[0]!.body as Task).resolved_by_activity_id
      // the entry reached the server before the tasks that point at it
      const entryAt = api.calls.findIndex((c) => c.method === 'PUT' && c.path === `/api/activities/${entryId}`)
      expect(entryAt).toBeGreaterThanOrEqual(0)
      expect(entryAt).toBeLessThan(api.calls.indexOf(closes()[0]!))
      expect(closes().find((c) => c.path.endsWith(sowTask.id))!.body).toEqual({
        plot_id: null,
        zone_id: dryZone.id,
        title: 'Falta semear',
        description: null,
        kind: 'sow',
        status: 'done',
        due_on: null,
        resolved_by_activity_id: entryId,
        base_version: 3,
      })
      await waitFor(() =>
        expect(queryClient.getQueryData<Task[]>(['tasks'])!.find((t) => t.id === sowTask.id)?.status).toBe('done'),
      )
    })

    it('ticks a plot-wide task by default only when the whole plot was worked', async () => {
      const waterPlot: Task = { ...pathTask, id: '40000000-0000-4000-8000-000000000005', title: 'Regar talhão', kind: 'water' }
      logApi([waterPlot])
      renderApp('/log')
      await pickClareira(/Rega/)
      const group = await screen.findByRole('group', { name: 'Também ficou feito' })
      // one zone of two: listed, not ticked
      expect(within(group).getByRole('checkbox', { name: /Regar talhão/ })).not.toBeChecked()
      expect(screen.getByRole('button', { name: /^Guardar/ })).toHaveAccessibleName('Guardar rega em Clareira')
      await userEvent.click(screen.getByRole('button', { name: 'Escolher numa lista' }))
      await userEvent.click(within(screen.getByRole('group', { name: 'Zonas' })).getByRole('checkbox', { name: /Encosta/ }))
      expect(within(group).getByRole('checkbox', { name: /Regar talhão/ })).toBeChecked()
      // the Save button says a task will be closed, even when the list is scrolled out of sight
      expect(screen.getByRole('button', { name: /^Guardar/ })).toHaveAccessibleName('Guardar rega em 2 zonas · fecha 1 tarefa')
    })

    it('a refused entry leaves its tasks open and ticked, reported once', async () => {
      const api = logApi([sowTask])
      const { queryClient } = renderApp('/log')
      await pickClareira(/Sementeira/)
      const group = await screen.findByRole('group', { name: 'Também ficou feito' })
      const real = api.fetchMock.getMockImplementation()!
      const refused: string[] = []
      api.fetchMock.mockImplementation(async (input, init) => {
        const path = String(input)
        if (init?.method === 'PUT') refused.push(path)
        if (init?.method === 'PUT' && path.startsWith('/api/activities/'))
          return new Response('{"error":{"code":"invalid","message":"pick the zones again","field":"zones"}}', { status: 422 })
        if (init?.method === 'PUT' && path.startsWith('/api/tasks/'))
          return new Response(
            '{"error":{"code":"invalid","message":"is not a known activity","field":"resolved_by_activity_id"}}',
            { status: 422 },
          )
        return real(input, init)
      })
      await userEvent.click(screen.getByRole('button', { name: /^Guardar/ }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Zonas: pick the zones again.')
      // the task write behind it was sent, failed, and is not reported again in the sync bar
      await waitFor(() => expect(refused).toContain(`/api/tasks/${sowTask.id}`))
      expect(refused[0]).toMatch(/^\/api\/activities\//)
      const taskWrite = () =>
        queryClient
          .getMutationCache()
          .getAll()
          .find((m) => m.options.mutationKey?.[0] === 'tasks')!
      await waitFor(() => expect(taskWrite().state.status).toBe('error'))
      expect(isShownInline(taskWrite().mutationId)).toBe(true)
      expect(screen.getAllByRole('alert')).toHaveLength(1)
      expect(screen.queryByText(/não foi guardado/)).not.toBeInTheDocument()
      // still open on the phone, and still ticked for the next try
      await waitFor(() =>
        expect(queryClient.getQueryData<Task[]>(['tasks'])!.find((t) => t.id === sowTask.id)?.status).toBe('open'),
      )
      expect(within(group).getByRole('checkbox', { name: /Falta semear/ })).toBeChecked()
    })

    it('leaves a task unticked alone', async () => {
      const api = logApi([sowTask])
      renderApp('/log')
      await pickClareira(/Sementeira/)
      await userEvent.click(within(await screen.findByRole('group', { name: 'Também ficou feito' })).getByRole('checkbox', { name: /Falta semear/ }))
      await userEvent.click(screen.getByRole('button', { name: /^Guardar/ }))
      expect(await screen.findByText('Sementeira guardada em Clareira, hoje.')).toBeInTheDocument()
      expect(puts(api).filter((c) => c.path.startsWith('/api/tasks/'))).toEqual([])
    })

    it('offline: the task is done on the phone at once, and queued behind the entry', async () => {
      const api = logApi([sowTask])
      const { queryClient, unmount } = renderApp('/log')
      await pickClareira(/Sementeira/)
      await screen.findByRole('group', { name: 'Também ficou feito' })
      onlineManager.setOnline(false)
      // unmounted before going back online: the queue stays paused and never reaches later tests
      onTestFinished(() => {
        unmount()
        onlineManager.setOnline(true)
      })
      await userEvent.click(screen.getByRole('button', { name: /^Guardar/ }))
      expect(await screen.findByText(/Guardado neste telemóvel\..* Tarefa feita: Falta semear\./)).toBeInTheDocument()
      const task = queryClient.getQueryData<Task[]>(['tasks'])!.find((t) => t.id === sowTask.id)!
      expect(task.status).toBe('done')
      // one ordered queue: the entry first, then the task that points at it
      const queued = queryClient
        .getMutationCache()
        .getAll()
        .filter((m) => m.state.status === 'pending')
        .map((m) => m.options.mutationKey?.[0])
      expect(queued).toEqual(['activities', 'tasks'])
      const entryId = (queryClient.getMutationCache().getAll()[0]!.state.variables as { id: string }).id
      expect(task.resolved_by_activity_id).toBe(entryId)
      expect(puts(api).filter((c) => c.path.endsWith(entryId) || c.path.endsWith(sowTask.id))).toEqual([])
    })

    it('Undo removes the entry and reopens its tasks', async () => {
      const api = logApi([sowTask])
      renderApp('/log')
      await pickClareira(/Sementeira/)
      await screen.findByRole('group', { name: 'Também ficou feito' })
      await userEvent.click(screen.getByRole('button', { name: /^Guardar/ }))
      await screen.findByText(/Tarefa feita: Falta semear/)
      const taskPuts = () => puts(api).filter((c) => c.path === `/api/tasks/${sowTask.id}`)
      await waitFor(() => expect(taskPuts()).toHaveLength(1))
      await userEvent.click(screen.getByRole('button', { name: 'Anular' }))
      await waitFor(() => expect(api.calls.some((c) => c.method === 'DELETE')).toBe(true))
      const reopen = taskPuts()[1]!
      // sent from the version the closing produced
      expect(reopen.body).toMatchObject({ status: 'open', resolved_by_activity_id: null, base_version: 4 })
      // the task is reopened before its entry goes
      expect(api.calls.findIndex((c) => c.method === 'DELETE')).toBeGreaterThan(api.calls.indexOf(reopen))
    })
  })
})
