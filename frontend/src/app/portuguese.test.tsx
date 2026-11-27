import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Browser } from 'leaflet'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Activity } from '../api/activities'
import type { Plot, Zone } from '../api/plots'
import type { Species } from '../api/species'
import type { PlotStats } from '../api/stats'
import type { Task } from '../api/tasks'
import { addDays, fieldToday } from '../domain/dates'
import { fakeApi } from '../test/fakeApi'
import { testField, testPlot, testZone } from '../test/fixtures'
import { renderApp } from '../test/render'

/**
 * Everything a user can see is in Portuguese: each page is rendered with data (and its
 * panels and forms opened), and its text and labels may not hold any of these English words.
 */
const ENGLISH = [
  'add', 'ago', 'all', 'and', 'area', 'back', 'cancel', 'close', 'colours', 'connection', 'count', 'date', 'day',
  'days', 'delete', 'details', 'done', 'draw', 'due', 'edit', 'entry', 'field', 'for', 'from', 'hide', 'holes', 'in',
  'is', 'it', 'kind', 'later', 'layers', 'legend', 'litres', 'loading', 'log', 'map', 'mix', 'month', 'more', 'name',
  'nests', 'never', 'next', 'nothing', 'notes', 'of', 'on', 'online', 'open', 'or', 'other', 'overdue', 'path', 'per',
  'photo', 'planted', 'please', 'plot', 'plots', 'quantity', 'remove', 'save', 'search', 'season', 'seeds', 'show',
  'shown', 'sown', 'species', 'stats', 'status', 'task', 'tasks', 'the', 'this', 'to', 'today', 'tree', 'trees',
  'undo', 'unit', 'water', 'watered', 'week', 'when', 'where', 'with', 'year', 'yesterday', 'you', 'your', 'zone',
  'zones',
]
// whole words only: a letter (accented too, "Início") on either side means another word
const english = new RegExp(`(?<!\\p{L})(${ENGLISH.join('|')})(?!\\p{L})`, 'iu')

/** The page's text and the words only some users get: labels, titles, placeholders, alt texts. */
function shownText(): string[] {
  const out = [document.body.textContent ?? '']
  for (const el of document.body.querySelectorAll('*')) {
    for (const a of ['aria-label', 'title', 'placeholder', 'alt', 'aria-valuetext']) {
      const v = el.getAttribute(a)
      if (v) out.push(v)
    }
  }
  return out
}

/** The English found on screen, with some text around it, each line headed by `where`. */
function englishOn(where: string): string[] {
  return shownText()
    .map((t) => t.match(new RegExp(`.{0,30}${english.source}.{0,30}`, 'iu'))?.[0])
    .filter((t): t is string => Boolean(t))
    .map((t) => `${where}: ${t}`)
}

const today = fieldToday()
const plot: Plot = { ...testPlot, name: 'Parcela 1' }
const plot2: Plot = { ...testPlot, id: '10000000-0000-4000-8000-000000000002', name: 'Parcela 2' }
const dry: Zone = { ...testZone, plot_id: plot.id, open_task_count: 1 }
const fine: Zone = {
  ...testZone,
  id: '20000000-0000-4000-8000-000000000002',
  label: 'Encosta',
  last_watered_on: addDays(today, -1),
  last_planted_on: addDays(today, -30),
  needs_water: false,
}
const bare: Zone = { ...testZone, id: '20000000-0000-4000-8000-000000000003', label: null, last_sown_on: null, needs_water: false }
const path: Zone = { ...testZone, id: '20000000-0000-4000-8000-000000000004', label: null, kind: 'path', last_sown_on: null }
const sobreiro: Species = { id: 's1', scientific_name: 'Quercus suber', common_name: 'sobreiro', notes: 'gosta de sol', updated_at: 'x' }
const task = (over: Partial<Task>): Task => ({
  id: '40000000-0000-4000-8000-000000000001',
  plot_id: null,
  zone_id: dry.id,
  title: 'Falta semear',
  description: 'junto ao muro',
  kind: 'sow',
  status: 'open',
  due_on: addDays(today, -2),
  completed_at: null,
  resolved_by_activity_id: null,
  version: 1,
  created_at: 'x',
  updated_at: 'x',
  ...over,
})
const tasks = [
  task({}),
  task({ id: '40000000-0000-4000-8000-000000000002', zone_id: null, plot_id: plot.id, title: 'Melhorar caminho', kind: 'improve_path', due_on: null, status: 'in_progress' }),
  task({ id: '40000000-0000-4000-8000-000000000003', title: 'Regar', kind: 'water', due_on: addDays(today, 3) }),
  task({ id: '40000000-0000-4000-8000-000000000004', title: 'Ninhos', kind: 'add_nests', status: 'done', completed_at: new Date().toISOString(), resolved_by_activity_id: '50000000-0000-4000-8000-000000000001' }),
  task({ id: '40000000-0000-4000-8000-000000000005', zone_id: null, plot_id: plot2.id, title: 'Cancelada', status: 'cancelled', completed_at: new Date().toISOString() }),
]
const entry = (over: Partial<Activity>): Activity => ({
  id: '50000000-0000-4000-8000-000000000001',
  type: 'sowing',
  performed_on: addDays(today, -3),
  notes: 'com chuva',
  zones: [
    { zone_id: dry.id, quantity: 1200, unit: 'holes' },
    { zone_id: fine.id, quantity: 80, unit: 'holes' },
  ],
  species: [{ species_id: sobreiro.id, quantity: 40, unit: 'seeds', notes: null }],
  version: 1,
  created_at: 'x',
  updated_at: 'x',
  ...over,
})
const entries = [
  entry({}),
  entry({ id: '50000000-0000-4000-8000-000000000002', type: 'watering', performed_on: addDays(today, -40), zones: [{ zone_id: dry.id, quantity: 150, unit: 'litres' }], species: [], notes: null }),
  entry({ id: '50000000-0000-4000-8000-000000000003', type: 'other', performed_on: today, zones: [{ zone_id: fine.id, quantity: null, unit: null }], species: [], notes: null }),
]
const plotStats = (p: Plot): PlotStats => ({
  plot_id: p.id,
  name: p.name,
  area_ha: p.id === plot.id ? 3.69 : null,
  declared_area_ha: 6.2,
  zone_count: 4,
  tree_count: 29,
  dead_tree_count: 1,
  species_count: 1,
  last_watered_on: p.id === plot.id ? addDays(today, -1) : null,
  open_task_count: 2,
  holes_sown: 1280,
  trees_planted: 30,
  litres_watered: 150,
  waterings_last_30d: 3,
  zones_need_water: 1,
  cultivation_zones: 3,
  zones_watered_7d: 1,
  activities_per_week: [1, 0, 2, 0, 0, 1, 0, 3],
})

function api() {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(800)
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(600)
  return fakeApi({
    'GET /api/field': () => ({ status: 200, body: { ...testField, name: 'Quinta do Vale' } }),
    'GET /api/field/photos': () => ({
      status: 200,
      body: [
        { ...testField.photo, is_current: false, residual_px: null, alignment_points: [] },
        { ...testField.photo, id: 'p2', captured_on: addDays(today, -5), is_current: true, residual_px: 4, alignment_points: [1, 2, 3, 4] },
      ],
    }),
    'GET /api/plots': () => ({ status: 200, body: [plot, plot2] }),
    'GET /api/zones': () => ({ status: 200, body: [dry, fine, bare, path] }),
    'GET /api/tasks': () => ({ status: 200, body: tasks }),
    'GET /api/activities.*': () => ({ status: 200, body: entries }),
    'GET /api/species': () => ({ status: 200, body: [sobreiro, { ...sobreiro, id: 's2', scientific_name: 'Pinus pinea', common_name: null, notes: null }] }),
    'GET /api/species-stats': () => ({ status: 200, body: [{ species_id: sobreiro.id, zone_count: 2, alive_tree_count: 29, last_sown_on: addDays(today, -3), last_planted_on: null }] }),
    'GET /api/tree-counts': () => ({ status: 200, body: [{ zone_id: dry.id, species_id: sobreiro.id, alive: 29, dead: 1 }] }),
    'GET /api/plot-stats': () => ({ status: 200, body: [plotStats(plot), plotStats(plot2)] }),
    'GET /api/planted-stats.*': ({ path: p }) => {
      const q = new URLSearchParams(p.split('?')[1])
      return {
        status: 200,
        body: {
          from: q.get('from'),
          to: q.get('to'),
          plots: [{ plot_id: plot.id, name: plot.name, holes_sown: 1280, trees_planted: 30 }, { plot_id: plot2.id, name: plot2.name, holes_sown: 0, trees_planted: 0 }],
          species: [{ species_id: sobreiro.id, scientific_name: sobreiro.scientific_name, common_name: sobreiro.common_name, holes_sown: 1280, trees_planted: 30 }],
        },
      }
    },
    'GET /api/watering-rules': () => ({ status: 200, body: [{ id: 'r1', name: 'Verão', from_month: 6, to_month: 9, interval_days: 4, created_at: 'x', updated_at: 'x' }, { id: 'r2', name: 'Julho', from_month: 7, to_month: 7, interval_days: 1, created_at: 'y', updated_at: 'y' }] }),
  })
}

const click = async (name: string | RegExp, role: 'button' | 'link' = 'button') =>
  userEvent.click(await screen.findByRole(role, { name }))

const browser = Browser as { any3d: boolean }
const realAny3d = browser.any3d
beforeAll(() => {
  browser.any3d = true
})
afterAll(() => {
  browser.any3d = realAny3d
})

describe('every page is in Portuguese', () => {
  it('catches English (the check itself works)', () => {
    document.body.innerHTML = '<p>Guardar</p><button aria-label="Close">✕</button>'
    expect(shownText().some((t) => english.test(t))).toBe(true)
    document.body.innerHTML = ''
  })

  it('the map, its panels, a zone sheet, a task sheet and the draw menu', async () => {
    api()
    renderApp('/')
    await screen.findByText('Parcela 1 · 3,69 ha')
    await click('Camadas')
    expect(englishOn('map layers')).toEqual([])
    await click('Zonas')
    expect(englishOn('zone list')).toEqual([])
    await click(/precisa/)
    expect(englishOn('needs attention')).toEqual([])
    await userEvent.click(within(document.getElementById('map-attention')!).getAllByRole('button', { name: /^Clareira/ })[0]!)
    await screen.findByRole('heading', { name: 'Clareira' })
    expect(englishOn('zone sheet')).toEqual([])
    await click('Fechar')
    await userEvent.click(await screen.findByRole('button', { name: '2 tarefas: Clareira' }))
    expect(englishOn('task sheet')).toEqual([])
    await click('Fechar')
    await click('＋ Desenhar')
    expect(englishOn('draw menu')).toEqual([])
    await click(/Uma zona/)
    expect(englishOn('drawing a zone')).toEqual([])
  })

  it('the map before the field is set up', async () => {
    fakeApi({ 'GET /api/field': () => ({ status: 404, body: { error: { code: 'no_field' } } }) })
    renderApp('/')
    await screen.findByRole('heading', { name: 'Bem-vindo ao Forest' })
    expect(englishOn('welcome')).toEqual([])
  })

  it('logging, with a kind chosen', async () => {
    api()
    renderApp('/log')
    await click(/^Todas as zonas por regar/)
    await click(/Sementeira/)
    await click(/^Mais…/)
    await click('Escolher numa lista')
    await screen.findByText('Também ficou feito')
    expect(englishOn('log page')).toEqual([])
  })

  it('tasks, with the form open', async () => {
    api()
    renderApp('/tasks')
    await screen.findByRole('heading', { name: /Atrasadas/ })
    await click(/^Mostrar as feitas/)
    expect(englishOn('tasks page')).toEqual([])
    await click(/^Editar: .*Falta semear/)
    expect(englishOn('task form')).toEqual([])
  })

  it('a zone, with its task form, tree counts and an entry being edited', async () => {
    api()
    renderApp(`/zones/${dry.id}`)
    await screen.findByRole('heading', { name: 'Clareira', level: 1 })
    await screen.findByText(/sobreiro ×40/)
    await click(/^Mostrar as feitas/)
    expect(englishOn('zone page')).toEqual([])
    await click('✎ Contar árvores')
    await click('＋ Acrescentar tarefa')
    expect(englishOn('zone forms')).toEqual([])
    await userEvent.click(within(screen.getByRole('form', { name: 'Tarefa nova' })).getByRole('button', { name: 'Cancelar' }))
    await click(/^Editar: .*Sementeira/)
    expect(englishOn('entry form')).toEqual([])
    await click('Apagar')
    expect(englishOn('entry delete')).toEqual([])
  })

  it('a plot', async () => {
    api()
    renderApp(`/plots/${plot.id}`)
    await screen.findByRole('heading', { name: 'Parcela 1', level: 1 })
    await screen.findByText(/Sementeira · 1280 covas/)
    expect(englishOn('plot page')).toEqual([])
  })

  it('stats', async () => {
    api()
    renderApp('/stats')
    await screen.findByRole('table', { name: 'Por espécie' })
    expect(englishOn('stats page')).toEqual([])
  })

  it('species, with the form open', async () => {
    api()
    renderApp('/species')
    await screen.findByText(/2 zonas · 29 árvores vivas/)
    expect(englishOn('species page')).toEqual([])
    await click('Editar Quercus suber')
    await click('Apagar')
    expect(englishOn('species form')).toEqual([])
  })

  it('field setup, with a season open', async () => {
    api()
    renderApp('/field')
    await screen.findByText('1 px ≈ 0,48 m')
    await click(/^Mostrar as 2 fotografias/)
    await click('Editar Verão')
    expect(englishOn('field setup')).toEqual([])
  })

  it('field setup before the field exists', async () => {
    fakeApi({ 'GET /api/field': () => ({ status: 404, body: { error: { code: 'no_field' } } }) })
    renderApp('/field')
    await screen.findByRole('button', { name: 'Criar o terreno' })
    await click('Criar o terreno')
    expect(englishOn('create field')).toEqual([])
  })

  it('more, and an unknown address', async () => {
    api()
    const { unmount } = renderApp('/more')
    await screen.findByRole('button', { name: /Descarregar CSV/ })
    expect(englishOn('more page')).toEqual([])
    unmount()
    renderApp('/nada')
    await screen.findByRole('heading', { name: 'Página não encontrada' })
    expect(englishOn('not found')).toEqual([])
  })

  it('a sync problem and no connection', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(() => Promise.reject(new TypeError('Failed to fetch'))))
    renderApp('/stats')
    await waitFor(() => expect(within(document.body).getByText('Servidor sem resposta')).toBeInTheDocument())
    expect(englishOn('offline')).toEqual([])
  })
})
