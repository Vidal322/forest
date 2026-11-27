import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Activity } from '../api/activities'
import type { Plot, Zone } from '../api/plots'
import type { Task } from '../api/tasks'
import { addDays, fieldToday } from '../domain/dates'
import { fakeApi } from '../test/fakeApi'
import { testPlot, testZone } from '../test/fixtures'
import { renderApp } from '../test/render'

const today = fieldToday()
const otherPlot: Plot = { ...testPlot, id: '10000000-0000-4000-8000-000000000002', name: 'Plot 2' }
// watered yesterday: fine; testZone (Clareira) needs water and comes first
const ribeira: Zone = { ...testZone, id: '20000000-0000-4000-8000-000000000002', label: 'Ribeira', last_watered_on: addDays(today, -1), needs_water: false, open_task_count: 1 }
const elsewhere: Zone = { ...testZone, id: '20000000-0000-4000-8000-000000000003', label: 'Longe', plot_id: otherPlot.id }

const task = (over: Partial<Task>): Task => ({
  id: '40000000-0000-4000-8000-000000000001',
  plot_id: null,
  zone_id: ribeira.id,
  title: 'Regar ribeira',
  description: null,
  kind: 'water',
  status: 'open',
  due_on: today,
  completed_at: null,
  resolved_by_activity_id: null,
  version: 1,
  created_at: 'x',
  updated_at: 'x',
  ...over,
})
const taskList = [
  task({}),
  task({ id: '40000000-0000-4000-8000-000000000002', zone_id: null, plot_id: testPlot.id, title: 'Melhorar caminho', kind: 'improve_path', due_on: null }),
  task({ id: '40000000-0000-4000-8000-000000000003', zone_id: elsewhere.id, title: 'Noutro talhão' }),
  task({ id: '40000000-0000-4000-8000-000000000004', title: 'Já feito', status: 'done', completed_at: new Date().toISOString() }),
]

const entry = (over: Partial<Activity>): Activity => ({
  id: '50000000-0000-4000-8000-000000000001',
  type: 'watering',
  performed_on: addDays(today, -1),
  notes: null,
  zones: [
    { zone_id: ribeira.id, quantity: 100, unit: 'litres' },
    { zone_id: testZone.id, quantity: 50, unit: 'litres' },
    { zone_id: elsewhere.id, quantity: 999, unit: 'litres' },
  ],
  species: [],
  version: 1,
  created_at: 'x',
  updated_at: 'x',
  ...over,
})

function plotApi(entries: Activity[] = [entry({})], plotEntries: Activity[] = entries) {
  let tasks = taskList
  return fakeApi({
    'GET /api/plots': () => ({ status: 200, body: [testPlot, otherPlot] }),
    'GET /api/zones': () => ({ status: 200, body: [ribeira, testZone, elsewhere] }),
    'GET /api/tasks': () => ({ status: 200, body: tasks }),
    [`GET /api/activities\\?plot_id=${testPlot.id}&.*`]: () => ({ status: 200, body: plotEntries }),
    'GET /api/activities.*': () => ({ status: 200, body: entries }),
    'PUT /api/tasks/[^/]+': ({ path, body }) => {
      const id = path.split('/').pop()!
      const saved = { ...taskList.find((t) => t.id === id)!, ...(body as object), id, version: 2 }
      tasks = tasks.map((t) => (t.id === id ? saved : t))
      return { status: 200, body: saved }
    },
  })
}

describe('PlotPage', () => {
  it('shows the plot’s area, its zones by need and a link to its stats', async () => {
    plotApi()
    renderApp(`/plots/${testPlot.id}`)
    expect(await screen.findByRole('heading', { name: 'Plot 1', level: 1 })).toBeInTheDocument()
    expect(screen.getByText(/3,69 ha · 6,20 ha no mapa antigo · 2 zonas/)).toBeInTheDocument()
    const zones = within(await screen.findByRole('region', { name: 'Zonas' }))
    const links = await zones.findAllByRole('link')
    expect(links.map((l) => l.textContent)).toEqual([expect.stringMatching(/^Clareira/), expect.stringMatching(/^Ribeira · 1 tarefa por fazer/)])
    expect(links[0]).toHaveAttribute('href', `/zones/${testZone.id}`)
    expect(zones.queryByText(/Longe/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Estatísticas de Plot 1/ })).toHaveAttribute('href', `/stats#plot-${testPlot.id}`)
  })

  it('lists the open tasks of the plot and its zones, and ticks one done', async () => {
    const api = plotApi()
    renderApp(`/plots/${testPlot.id}`)
    const todo = within(await screen.findByRole('region', { name: 'Tarefas' }))
    expect(await todo.findByRole('button', { name: /Editar: .*Regar ribeira/ })).toHaveTextContent('Ribeira · para hoje')
    expect(todo.getByRole('button', { name: /Editar: .*Melhorar caminho/ })).toHaveTextContent('Parcela inteira')
    expect(todo.queryByText(/Noutro talhão|Já feito/)).not.toBeInTheDocument()
    await userEvent.click(todo.getByRole('button', { name: 'Feita: Regar ribeira' }))
    expect(await screen.findByText('Tarefa feita: Regar ribeira.')).toBeInTheDocument()
    const put = api.calls.find((c) => c.method === 'PUT')!
    expect(put.body).toMatchObject({ status: 'done', base_version: 1 })
    // stays in place (struck through) so a second tap doesn't land on the next one
    await waitFor(() => expect(todo.getByRole('button', { name: 'Feita: Regar ribeira' })).toHaveAttribute('aria-pressed', 'true'))
  })

  it('shows recent activity in this plot only, each opening the zone’s history', async () => {
    plotApi([
      entry({}),
      entry({ id: '50000000-0000-4000-8000-000000000002', type: 'sowing', zones: [{ zone_id: elsewhere.id, quantity: 5, unit: 'holes' }] }),
    ])
    renderApp(`/plots/${testPlot.id}`)
    const recent = within(await screen.findByRole('region', { name: 'Últimos registos' }))
    const links = await recent.findAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveTextContent('Rega · 150 litros')
    expect(links[0]).toHaveTextContent('ontem')
    expect(links[0]).toHaveTextContent('Ribeira e Clareira')
    expect(links[0]).toHaveAttribute('href', `/zones/${ribeira.id}#entry-50000000-0000-4000-8000-000000000001`)
  })

  it('finds entries older than the capped global log in the plot’s own list', async () => {
    const busy = Array.from({ length: 500 }, (_, i) =>
      entry({ id: `51000000-0000-4000-8000-${String(i).padStart(12, '0')}`, zones: [{ zone_id: elsewhere.id, quantity: null, unit: null }] }),
    )
    const old = entry({ id: '50000000-0000-4000-8000-000000000009', type: 'sowing', performed_on: addDays(today, -60), zones: [{ zone_id: testZone.id, quantity: 80, unit: 'holes' }] })
    const api = plotApi(busy, [old])
    renderApp(`/plots/${testPlot.id}`)
    const recent = within(await screen.findByRole('region', { name: 'Últimos registos' }))
    const link = await recent.findByRole('link')
    expect(link).toHaveTextContent('Sementeira · 80 covas')
    expect(link).toHaveTextContent('Clareira')
    expect(api.calls.some((c) => c.path.startsWith(`/api/activities?plot_id=${testPlot.id}&`))).toBe(true)
  })

  it('says when the plot does not exist', async () => {
    plotApi()
    renderApp('/plots/10000000-0000-4000-8000-0000000000ff')
    expect(await screen.findByRole('heading', { name: 'Parcela não encontrada' })).toBeInTheDocument()
  })

  it('is reached from the plot stats', async () => {
    fakeApi({
      'GET /api/plot-stats': () => ({
        status: 200,
        body: [{ plot_id: testPlot.id, name: 'Plot 1', area_ha: 3.69, declared_area_ha: null, zone_count: 1, tree_count: 0, dead_tree_count: 0, species_count: 0, last_watered_on: null, open_task_count: 0, holes_sown: 0, trees_planted: 0, litres_watered: 0, waterings_last_30d: 0, zones_need_water: 0, cultivation_zones: 1, zones_watered_7d: 0, activities_per_week: [0, 0, 0, 0, 0, 0, 0, 0] }],
      }),
    })
    renderApp('/stats')
    expect(await screen.findByRole('link', { name: 'Plot 1' })).toHaveAttribute('href', `/plots/${testPlot.id}`)
  })
})
