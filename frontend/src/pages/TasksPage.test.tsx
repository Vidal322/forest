import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Task } from '../api/tasks'
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

function taskApi(list: Task[] = [base, later], delayMs = 0) {
  let db = [...list]
  const api = fakeApi({
    'GET /api/tasks': () => ({ status: 200, body: db }),
    'GET /api/plots': () => ({ status: 200, body: [testPlot] }),
    'GET /api/zones': () => ({ status: 200, body: [testZone] }),
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
    expect(await screen.findByRole('heading', { name: /Overdue/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /No date/ })).toBeInTheDocument()
    expect(screen.getByText(/Clareira · Plot 1 · due 2 days ago/)).toBeInTheDocument()
  })

  it('ticks a task done in one tap, from its current version', async () => {
    const api = taskApi()
    renderApp('/tasks')
    await userEvent.click(await screen.findByRole('button', { name: 'Done: Falta semear' }))
    expect(await screen.findByText('Done: Falta semear.')).toBeInTheDocument()
    expect(api.calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ status: 'done', base_version: 3, zone_id: testZone.id })
    // the row stays where it was, ticked, so a second tap can't hit the next task
    const tick = screen.getByRole('button', { name: 'Done: Falta semear' })
    expect(tick).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: /Overdue/ })).toBeInTheDocument()
  })

  it('adds a task to a zone', async () => {
    const api = taskApi([])
    renderApp('/tasks')
    expect(await screen.findByText(/Nothing to do/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Add task/ }))
    await userEvent.type(screen.getByLabelText('What needs doing?'), 'Mais ninhos')
    await userEvent.selectOptions(screen.getByLabelText('Where'), `zone:${testZone.id}`)
    await userEvent.click(screen.getByRole('button', { name: /Add nests/ }))
    await userEvent.click(screen.getByRole('button', { name: 'In a week' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add task' }))
    expect(await screen.findByText('Added “Mais ninhos”.')).toBeInTheDocument()
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
    await userEvent.click(await screen.findByRole('button', { name: /Add task/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Add task' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Write what needs doing.')
    await userEvent.type(screen.getByLabelText('What needs doing?'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Add task' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Choose the zone or plot.')
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
    await userEvent.click(await screen.findByRole('button', { name: /Edit: .*Falta semear/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('changed somewhere else')
    expect(screen.getByRole('button', { name: 'Load latest' })).toBeInTheDocument()
  })

  it('says “done” at once even on a slow network, and can undo it', async () => {
    const api = taskApi([base], 300)
    renderApp('/tasks')
    await userEvent.click(await screen.findByRole('button', { name: 'Done: Falta semear' }))
    expect(screen.getByText('Done: Falta semear.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(api.calls.filter((c) => c.method === 'PUT')).toHaveLength(2), { timeout: 2000 })
    const [first, second] = api.calls.filter((c) => c.method === 'PUT')
    expect(first!.body).toMatchObject({ status: 'done', base_version: 3 })
    // the undo is sent from the version the tick produced
    expect(second!.body).toMatchObject({ status: 'open', base_version: 4 })
  })

  it('ignores a second tap while the first is being sent', async () => {
    const api = taskApi([base], 300)
    renderApp('/tasks')
    const tick = await screen.findByRole('button', { name: 'Done: Falta semear' })
    await userEvent.dblClick(tick)
    await new Promise((r) => setTimeout(r, 500))
    expect(api.calls.filter((c) => c.method === 'PUT')).toHaveLength(1)
  })
})
