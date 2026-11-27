import { onlineManager } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, onTestFinished } from 'vitest'
import type { Activity } from '../api/activities'
import type { Zone } from '../api/plots'
import { isOpen, type Task } from '../api/tasks'
import { addDays, fieldToday } from '../domain/dates'
import { fakeApi } from '../test/fakeApi'
import { testPlot, testZone } from '../test/fixtures'
import { renderApp } from '../test/render'

const today = fieldToday()
const base: Task = {
  id: '40000000-0000-4000-8000-000000000001',
  plot_id: null,
  zone_id: testZone.id,
  title: 'Falta semear',
  description: null,
  kind: 'sow',
  status: 'open',
  due_on: addDays(today, -2),
  completed_at: null,
  resolved_by_activity_id: null,
  version: 3,
  created_at: '2026-11-01T10:00:00Z',
  updated_at: '2026-11-01T10:00:00Z',
}
const later: Task = { ...base, id: '40000000-0000-4000-8000-000000000002', title: 'Melhorar caminho', kind: 'improve_path', zone_id: null, plot_id: testPlot.id, due_on: null }

const sowing: Activity = {
  id: '50000000-0000-4000-8000-000000000001',
  type: 'sowing',
  performed_on: addDays(today, -1),
  notes: null,
  zones: [{ zone_id: testZone.id, quantity: null, unit: null }],
  species: [],
  version: 1,
  created_at: '2026-11-01T10:00:00Z',
  updated_at: '2026-11-01T10:00:00Z',
}
const sown: Task = { ...base, status: 'done', completed_at: new Date().toISOString(), resolved_by_activity_id: sowing.id }

// a second plot with a zone of its own, for the plot filter
const plot2 = { ...testPlot, id: '10000000-0000-4000-8000-000000000002', name: 'Plot 2' }
const zone2 = { ...testZone, id: '20000000-0000-4000-8000-000000000002', plot_id: plot2.id, label: 'Ribeira' }
const inZone2: Task = { ...base, id: '40000000-0000-4000-8000-000000000003', title: 'Regar ribeira', kind: 'water', zone_id: zone2.id, due_on: today }

function taskApi(list: Task[] = [base, later], delayMs = 0, twoPlots = false) {
  let db = [...list]
  const api = fakeApi({
    'GET /api/activities.*': () => ({ status: 200, body: [sowing] }),
    'GET /api/species': () => ({ status: 200, body: [] }),
    'GET /api/tree-counts': () => ({ status: 200, body: [] }),
    'GET /api/tasks': () => ({ status: 200, body: db }),
    'GET /api/plots': () => ({ status: 200, body: twoPlots ? [testPlot, plot2] : [testPlot] }),
    // with the open task counts the server works out
    'GET /api/zones': () => ({
      status: 200,
      body: (twoPlots ? [testZone, zone2] : [testZone]).map((z) => ({
        ...z,
        open_task_count: db.filter((t) => t.zone_id === z.id && isOpen(t)).length,
      })),
    }),
    'PUT /api/tasks/[^/]+': ({ path, body }) => {
      const b = body as Partial<Task> & { base_version: number | null }
      const id = path.split('/').pop()!
      const saved = { ...base, ...b, id, version: (b.base_version ?? 0) + 1 }
      db = [...db.filter((t) => t.id !== id), saved]
      return { status: 200, body: saved }
    },
  })
  if (delayMs) {
    const real = api.fetchMock.getMockImplementation()!
    api.fetchMock.mockImplementation(async (input, init) => {
      if (init?.method === 'PUT') await new Promise((r) => setTimeout(r, delayMs))
      return real(input, init)
    })
  }
  return api
}

describe('TasksPage', () => {
  it('groups open tasks by urgency, with where they are', async () => {
    taskApi()
    renderApp('/tasks')
    expect(await screen.findByRole('heading', { name: /Atrasadas/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Sem prazo/ })).toBeInTheDocument()
    expect(screen.getByText(/Clareira, Plot 1, atrasada desde \d+ [a-z]{3}$/)).toBeInTheDocument()
  })

  it('ticks a task done in one tap, from its current version', async () => {
    const api = taskApi()
    renderApp('/tasks')
    await userEvent.click(await screen.findByRole('button', { name: 'Feita: Falta semear' }))
    expect(await screen.findByText('Tarefa feita: Falta semear.')).toBeInTheDocument()
    expect(api.calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ status: 'done', base_version: 3, zone_id: testZone.id })
    // the row stays where it was, ticked, so a second tap can't hit the next task
    const tick = screen.getByRole('button', { name: 'Feita: Falta semear' })
    expect(tick).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: /Atrasadas/ })).toBeInTheDocument()
  })

  it('adds a task to a zone', async () => {
    const api = taskApi([])
    renderApp('/tasks')
    expect(await screen.findByText(/Nada por fazer/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Acrescentar tarefa/ }))
    await userEvent.type(screen.getByLabelText('O que há para fazer?'), 'Mais ninhos')
    await userEvent.selectOptions(screen.getByLabelText('Onde'), `zone:${testZone.id}`)
    await userEvent.click(screen.getByRole('button', { name: /Fazer ninhos/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Daqui a uma semana' }))
    await userEvent.click(screen.getByRole('button', { name: 'Acrescentar tarefa' }))
    expect(await screen.findByText('Tarefa acrescentada: “Mais ninhos”.')).toBeInTheDocument()
    expect(api.calls.find((c) => c.method === 'PUT')?.body).toEqual({
      zone_id: testZone.id,
      plot_id: null,
      title: 'Mais ninhos',
      description: null,
      kind: 'add_nests',
      status: 'open',
      due_on: addDays(today, 7),
      resolved_by_activity_id: null,
      base_version: null,
    })
  })

  it('asks for a title and a place', async () => {
    taskApi([])
    renderApp('/tasks')
    await userEvent.click(await screen.findByRole('button', { name: /Acrescentar tarefa/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Acrescentar tarefa' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Escreve o que há para fazer.')
    await userEvent.type(screen.getByLabelText('O que há para fazer?'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Acrescentar tarefa' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Escolhe a zona ou a parcela.')
  })

  it('explains an edit that clashes with a change made elsewhere', async () => {
    const api = taskApi()
    api.fetchMock.mockImplementation(async (input, init) => {
      const path = String(input)
      if (init?.method === 'PUT') return new Response('{"error":{"code":"version_conflict"},"current":{}}', { status: 409 })
      if (path === '/api/tasks') return new Response(JSON.stringify([base]))
      if (path === '/api/plots') return new Response(JSON.stringify([testPlot]))
      if (path === '/api/zones') return new Response(JSON.stringify([testZone]))
      return new Response('{"status":"ok"}')
    })
    renderApp('/tasks')
    await userEvent.click(await screen.findByRole('button', { name: /Editar: .*Falta semear/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Feita' }))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('alterado noutro sítio')
    expect(screen.getByRole('button', { name: 'Carregar a mais recente' })).toBeInTheDocument()
  })

  it('says “done” at once even on a slow network, and can undo it', async () => {
    const api = taskApi([base], 300)
    renderApp('/tasks')
    await userEvent.click(await screen.findByRole('button', { name: 'Feita: Falta semear' }))
    expect(screen.getByText('Tarefa feita: Falta semear.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Anular' }))
    await waitFor(() => expect(api.calls.filter((c) => c.method === 'PUT')).toHaveLength(2), { timeout: 2000 })
    const [first, second] = api.calls.filter((c) => c.method === 'PUT')
    expect(first!.body).toMatchObject({ status: 'done', base_version: 3 })
    // the undo is sent from the version the tick produced
    expect(second!.body).toMatchObject({ status: 'open', base_version: 4 })
  })

  it('ignores a second tap while the first is being sent', async () => {
    const api = taskApi([base], 300)
    renderApp('/tasks')
    const tick = await screen.findByRole('button', { name: 'Feita: Falta semear' })
    await userEvent.dblClick(tick)
    await new Promise((r) => setTimeout(r, 500))
    expect(api.calls.filter((c) => c.method === 'PUT')).toHaveLength(1)
  })

  it('links a task done by a log entry to that entry in the zone’s history', async () => {
    taskApi([sown, later])
    const { router } = renderApp('/tasks')
    await userEvent.click(await screen.findByRole('button', { name: /Mostrar as feitas/ }))
    const link = await screen.findByRole('link', { name: /Feita com o registo: .*Sementeira/ })
    expect(link).toHaveAttribute('href', `/zones/${testZone.id}#entry-${sowing.id}`)
    await userEvent.click(link)
    expect(router.state.location.pathname).toBe(`/zones/${testZone.id}`)
    const entry = await screen.findByRole('button', { name: /Editar: .*Sementeira/ })
    await waitFor(() => expect(entry).toHaveFocus())
    expect(entry).toHaveClass('is-target')
  })

  it('reopening a task done by a log entry drops the link', async () => {
    const api = taskApi([sown])
    renderApp('/tasks')
    await userEvent.click(await screen.findByRole('button', { name: /Mostrar as feitas/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Feita: Falta semear' }))
    await waitFor(() => expect(api.calls.some((c) => c.method === 'PUT')).toBe(true))
    expect(api.calls.find((c) => c.method === 'PUT')!.body).toMatchObject({ status: 'open', resolved_by_activity_id: null })
    expect(screen.queryByRole('link', { name: /Feita com o registo/ })).not.toBeInTheDocument()
  })

  it('reopening a linked task in its form drops the link too', async () => {
    const api = taskApi([sown])
    renderApp('/tasks')
    await userEvent.click(await screen.findByRole('button', { name: /Mostrar as feitas/ }))
    await userEvent.click(await screen.findByRole('button', { name: /Editar: .*Falta semear/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Por fazer' }))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(api.calls.some((c) => c.method === 'PUT')).toBe(true))
    expect(api.calls.find((c) => c.method === 'PUT')!.body).toMatchObject({ status: 'open', resolved_by_activity_id: null })
  })

  it('keeps the link when a linked task is edited but stays done', async () => {
    const api = taskApi([sown])
    renderApp('/tasks')
    await userEvent.click(await screen.findByRole('button', { name: /Mostrar as feitas/ }))
    await userEvent.click(await screen.findByRole('button', { name: /Editar: .*Falta semear/ }))
    await userEvent.type(screen.getByLabelText('O que há para fazer?'), '!')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(api.calls.some((c) => c.method === 'PUT')).toBe(true))
    expect(api.calls.find((c) => c.method === 'PUT')!.body).toMatchObject({ status: 'done', resolved_by_activity_id: sowing.id })
  })

  it('offline: moving or deleting a task changes its zones’ open task counts at once', async () => {
    taskApi([base, inZone2], 0, true)
    const { queryClient } = renderApp('/tasks')
    await screen.findByRole('button', { name: /Editar: .*Falta semear/ })
    const counts = () => Object.fromEntries(queryClient.getQueryData<Zone[]>(['zones'])!.map((z) => [z.label, z.open_task_count]))
    await waitFor(() => expect(counts()).toEqual({ Clareira: 1, Ribeira: 1 }))
    onlineManager.setOnline(false)
    onTestFinished(() => onlineManager.setOnline(true))

    await userEvent.click(screen.getByRole('button', { name: /Editar: .*Falta semear/ }))
    await userEvent.selectOptions(screen.getByLabelText('Onde'), `zone:${zone2.id}`)
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(counts()).toEqual({ Clareira: 0, Ribeira: 2 }))

    await userEvent.click(await screen.findByRole('button', { name: /Editar: .*Regar ribeira/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Apagar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Apagar' }))
    await waitFor(() => expect(counts()).toEqual({ Clareira: 0, Ribeira: 1 }))
  })

  describe('plot filter', () => {
    const chip = (name: RegExp) => screen.findByRole('button', { name })

    it('is not shown with a single plot', async () => {
      taskApi()
      renderApp('/tasks')
      await screen.findByRole('heading', { name: /Atrasadas/ })
      expect(screen.queryByRole('group', { name: 'Mostrar as tarefas de' })).not.toBeInTheDocument()
    })

    it('shows one plot’s tasks, zone tasks counted under their plot', async () => {
      taskApi([base, later, inZone2], 0, true)
      renderApp('/tasks')
      expect(await chip(/Todas as parcelas \(3\)/)).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('button', { name: 'Plot 1 (2)' })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Plot 2 (1)' }))
      expect(screen.getByRole('button', { name: 'Plot 2 (1)' })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('button', { name: /Editar: .*Regar ribeira/ })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Editar: .*Falta semear/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Editar: .*Melhorar caminho/ })).not.toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Plot 1 (2)' }))
      expect(screen.getByRole('button', { name: /Editar: .*Falta semear/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Editar: .*Melhorar caminho/ })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Editar: .*Regar ribeira/ })).not.toBeInTheDocument()
    })

    it('filters the done ones too', async () => {
      taskApi([sown, inZone2], 0, true)
      renderApp('/tasks')
      await userEvent.click(await chip(/Plot 2 \(1\)/))
      expect(screen.queryByRole('button', { name: /Mostrar as feitas/ })).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Plot 1 (0)' }))
      expect(screen.getByRole('button', { name: /Mostrar as feitas e as canceladas \(1\)/ })).toBeInTheDocument()
    })

    it('is remembered when coming back to the page', async () => {
      taskApi([base, later, inZone2], 0, true)
      const { router } = renderApp('/tasks')
      await userEvent.click(await chip(/Plot 2 \(1\)/))
      await act(() => router.navigate('/more'))
      await act(() => router.navigate('/tasks'))
      expect(await chip(/Plot 2 \(1\)/)).toHaveAttribute('aria-pressed', 'true')
      expect(screen.queryByRole('button', { name: /Editar: .*Falta semear/ })).not.toBeInTheDocument()
    })

    it('says when a plot has nothing to do but others do', async () => {
      taskApi([base, later], 0, true)
      renderApp('/tasks')
      await userEvent.click(await chip(/Plot 2 \(0\)/))
      expect(screen.getByText('Nada por fazer em Plot 2.')).toBeInTheDocument()
      expect(screen.getByText('2 tarefas por fazer noutras parcelas.')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Mostrar todas as parcelas' }))
      expect(screen.getByRole('button', { name: /Todas as parcelas/ })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('button', { name: /Editar: .*Falta semear/ })).toBeInTheDocument()
    })
  })
})
