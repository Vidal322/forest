import { onlineManager } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Browser, Map as LeafletMap, latLng, latLngBounds, type LatLng, type LatLngBounds } from 'leaflet'
import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { Zone } from '../api/plots'
import type { Task } from '../api/tasks'
import { addDays, fieldToday, formatDay } from '../domain/dates'
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

function mapApi(over: Parameters<typeof fakeApi>[0] = {}) {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(800)
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(600)
  return fakeApi({
    'GET /api/field': () => ({ status: 200, body: testField }),
    'GET /api/plots': () => ({ status: 200, body: [testPlot] }),
    'GET /api/zones': () => ({ status: 200, body: [testZone] }),
    ...over,
  })
}

describe('MapPage', () => {
  it('labels plots with their measured area and zones with their name', async () => {
    mapApi()
    renderApp('/')
    expect(await screen.findByText('Plot 1 · 3.69 ha')).toBeInTheDocument()
    // the zone is 150 units wide: at the fitted zoom (−0.5 on an 800 px map) that is ~106 px, room for a label
    expect(await screen.findByText('Clareira')).toBeInTheDocument()
  })

  it('opens a sheet with the zone’s state when you tap it', async () => {
    mapApi()
    const { container } = renderApp('/')
    await screen.findByText('Clareira')
    const zonePath = await waitFor(() => {
      const path = container.querySelector('path.map-zone')
      expect(path).not.toBeNull()
      return path!
    })
    await userEvent.click(zonePath)
    const sheet = await screen.findByRole('region', { name: 'Clareira' })
    expect(sheet).toHaveTextContent('Needs water') // sown long ago, never watered
    expect(sheet).toHaveTextContent('Sown')
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('region', { name: 'Clareira' })).not.toBeInTheDocument()
  })

  it('reaches zones without the map, through the zone list', async () => {
    mapApi()
    renderApp('/')
    await userEvent.click(await screen.findByRole('button', { name: 'Zones' }))
    await userEvent.click(screen.getByRole('button', { name: /Clareira/ }))
    const heading = await screen.findByRole('heading', { name: 'Clareira' })
    expect(heading).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('heading', { name: 'Clareira' })).not.toBeInTheDocument()
  })

  it('sums up what needs attention, collapsed, and opens a zone from it', async () => {
    mapApi()
    renderApp('/')
    const pill = await screen.findByRole('button', { name: /1 zone needs attention/ })
    expect(pill).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('region', { name: /Need water/ })).not.toBeInTheDocument()
    await userEvent.click(pill)
    const water = screen.getByRole('region', { name: 'Need water: 1' })
    await userEvent.click(within(water).getByRole('button', { name: /Clareira/ }))
    expect(await screen.findByRole('heading', { name: 'Clareira' })).toHaveFocus()
    expect(screen.queryByRole('region', { name: /Need water/ })).not.toBeInTheDocument()
  })

  it('centres a zone picked from the list above the sheet, even at the bottom edge of the field', async () => {
    // the field is 1000 × 700: this zone is in its bottom-right corner, where the sheet covers it
    const corner = { ...testZone, id: '20000000-0000-4000-8000-0000000000c1', label: 'Canto', last_sown_on: null,
      geom: { type: 'Polygon' as const, coordinates: [[[900, 600], [1000, 600], [1000, 700], [900, 700], [900, 600]]] } }
    mapApi({ 'GET /api/zones': () => ({ status: 200, body: [testZone, corner] }) })
    const setView = vi.spyOn(LeafletMap.prototype, 'setView')
    renderApp('/')
    await userEvent.click(await screen.findByRole('button', { name: /2 zones need attention/ }))
    setView.mockClear()
    await userEvent.click(within(screen.getByRole('region', { name: 'Not sown yet: 1' })).getByRole('button', { name: /Canto/ }))
    expect(await screen.findByRole('heading', { name: 'Canto' })).toHaveFocus()
    expect(setView).toHaveBeenCalledTimes(1)
    const map = setView.mock.contexts[0] as LeafletMap
    const [target, zoom] = setView.mock.calls[0] as [LatLng, number]
    // the 800 × 600 map is covered by a 360 px sheet: the zone's centre lands in the middle of the 240 px above it
    const at = map.project(latLng(650, 950), zoom).subtract(map.project(target, zoom)).add(map.getSize().divideBy(2))
    expect(at.x).toBeCloseTo(400, 0)
    expect(at.y).toBeCloseTo(120, 0)
    // and the pan limits let the map go there
    const half = map.getSize().divideBy(2)
    const p = map.project(target, zoom)
    const view = latLngBounds(map.unproject(p.subtract(half), zoom), map.unproject(p.add(half), zoom))
    expect((map.options.maxBounds as LatLngBounds).contains(view)).toBe(true)
    // closing the sheet puts the limits back, and the pill with it
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('heading', { name: 'Canto' })).not.toBeInTheDocument()
    expect((map.options.maxBounds as LatLngBounds).contains(view)).toBe(false)
    expect(screen.getByRole('button', { name: /2 zones need attention/ })).toBeInTheDocument()
  })

  it('hides the attention pill while a zone’s sheet is open', async () => {
    mapApi()
    renderApp('/')
    await userEvent.click(await screen.findByRole('button', { name: 'Zones' }))
    await userEvent.click(screen.getByRole('button', { name: /Clareira/ }))
    await screen.findByRole('heading', { name: 'Clareira' })
    expect(screen.queryByRole('button', { name: /needs attention/ })).not.toBeInTheDocument()
  })

  it('says so when nothing needs attention', async () => {
    mapApi({ 'GET /api/zones': () => ({ status: 200, body: [{ ...testZone, kind: 'path' }] }) })
    renderApp('/')
    expect(await screen.findByRole('button', { name: /Nothing needs attention/ })).toBeInTheDocument()
  })

  it('has a legend for the colours, with the layers', async () => {
    mapApi()
    renderApp('/')
    await userEvent.click(await screen.findByRole('button', { name: 'Layers' }))
    expect(screen.getByRole('list', { name: 'Map colours' })).toHaveTextContent('Needs water')
  })

  it('shows the zones as they were on a past day, with a clear way back to today', async () => {
    const day = addDays(fieldToday(), -3)
    const { calls } = mapApi({
      // that day the zone had just been sown: fine, not dry
      'GET /api/zones\\?as_of=.*': () => ({ status: 200, body: [{ ...testZone, last_sown_on: day, needs_water: false }] }),
    })
    renderApp('/')
    await screen.findByRole('button', { name: /1 zone needs attention/ })
    await userEvent.click(screen.getByRole('button', { name: 'Layers' }))
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: day } })
    expect(await screen.findByText(`Viewing ${formatDay(day)}`)).toBeInTheDocument()
    expect(screen.getByText(/3 days ago/)).toBeInTheDocument()
    // "needs attention" is about today: not shown while looking back
    expect(screen.queryByRole('button', { name: /needs attention/ })).not.toBeInTheDocument()
    await waitFor(() => expect(calls.some((c) => c.path === `/api/zones?as_of=${day}`)).toBe(true))
    await waitFor(() => expect(screen.queryByText(/loading/)).not.toBeInTheDocument())

    // the zone's sheet tells that day's state
    await userEvent.click(screen.getByRole('button', { name: 'Layers' }))
    await userEvent.click(screen.getByRole('button', { name: 'Zones' }))
    await userEvent.click(screen.getByRole('button', { name: /Clareira/ }))
    const sheet = await screen.findByRole('region', { name: 'Clareira' })
    expect(sheet).toHaveTextContent(`On ${formatDay(day)}:`)
    expect(sheet).toHaveTextContent('Sown')
    expect(sheet).not.toHaveTextContent('Needs water')

    await userEvent.click(screen.getByRole('button', { name: 'Back to today' }))
    expect(screen.queryByText(/Viewing/)).not.toBeInTheDocument()
    expect(sheet).toHaveTextContent('Needs water')
  })

  it('says so when a past day cannot be loaded', async () => {
    mapApi({ 'GET /api/zones\\?as_of=.*': () => ({ status: 500, body: { error: { code: 'internal', message: 'boom' } } }) })
    renderApp('/')
    await userEvent.click(await screen.findByRole('button', { name: 'Layers' }))
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: addDays(fieldToday(), -10) } })
    expect(await screen.findByText(/Viewing/)).toBeInTheDocument()
    await waitFor(() => expect(document.querySelector('.asof-banner--warn')).not.toBeNull(), { timeout: 5000 })
  })

  it('invites you to draw when there are no plots yet', async () => {
    mapApi({ 'GET /api/plots': () => ({ status: 200, body: [] }), 'GET /api/zones': () => ({ status: 200, body: [] }) })
    renderApp('/')
    expect(await screen.findByText(/No plots yet/)).toBeInTheDocument()
  })
})

const openTask: Task = {
  id: '40000000-0000-4000-8000-0000000000a1',
  plot_id: null,
  zone_id: testZone.id,
  title: 'Regar',
  description: null,
  kind: 'water',
  status: 'open',
  due_on: null,
  completed_at: null,
  resolved_by_activity_id: null,
  version: 1,
  created_at: '2026-11-01T10:00:00Z',
  updated_at: '2026-11-01T10:00:00Z',
}

describe('task pins', () => {
  it('pins open tasks at their zone or plot; a pin lists its tasks, each ticked done in one tap', async () => {
    const plotTask: Task = { ...openTask, id: '40000000-0000-4000-8000-0000000000a2', zone_id: null, plot_id: testPlot.id, title: 'Refazer caminho', kind: 'improve_path' }
    const closed: Task = { ...openTask, id: '40000000-0000-4000-8000-0000000000a3', title: 'Já feito', status: 'done' }
    let tasks = [openTask, plotTask, closed]
    const puts: unknown[] = []
    mapApi({
      'GET /api/tasks': () => ({ status: 200, body: tasks }),
      'PUT /api/tasks/[^/]+': ({ path, body }) => {
        puts.push(body)
        const b = body as Task & { base_version: number }
        const saved = { ...tasks.find((t) => path.endsWith(t.id))!, ...b, version: b.base_version + 1 }
        tasks = tasks.map((t) => (t.id === saved.id ? saved : t))
        return { status: 200, body: saved }
      },
    })
    renderApp('/')
    const pin = await screen.findByRole('button', { name: 'Task: Regar' })
    expect(screen.getByRole('button', { name: 'Task: Refazer caminho' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Task: Já feito' })).not.toBeInTheDocument()

    fireEvent.click(pin)
    const sheet = await screen.findByRole('region', { name: 'Clareira' })
    expect(within(sheet).getByRole('heading', { name: 'Clareira' })).toHaveFocus()
    expect(sheet).toHaveTextContent('Tasks in this zone · Plot 1')
    expect(sheet).not.toHaveTextContent('Já feito')
    // not over the sheet
    expect(screen.queryByRole('button', { name: /needs attention/ })).not.toBeInTheDocument()

    await userEvent.click(within(sheet).getByRole('button', { name: 'Done: Regar' }))
    expect(within(sheet).getByText(/Done: Regar\./)).toBeInTheDocument()
    // stays in the sheet, ticked, so it can be undone
    expect(within(sheet).getByRole('button', { name: 'Done: Regar' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(puts).toEqual([expect.objectContaining({ status: 'done', base_version: 1 })]))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Task: Regar' })).not.toBeInTheDocument())

    // the plot's own pin: tasks for the whole plot
    fireEvent.click(screen.getByRole('button', { name: 'Task: Refazer caminho' }))
    const plotSheet = await screen.findByRole('region', { name: 'Plot 1' })
    expect(plotSheet).toHaveTextContent('Tasks for the whole plot')
    expect(within(plotSheet).getByRole('link', { name: 'All tasks' })).toHaveAttribute('href', '/tasks')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('region', { name: 'Plot 1' })).not.toBeInTheDocument()
  })

  it('puts the tasks of one zone under one pin', async () => {
    const second: Task = { ...openTask, id: '40000000-0000-4000-8000-0000000000a4', title: 'Semear', kind: 'sow' }
    let tasks = [openTask, second]
    mapApi({
      'GET /api/tasks': () => ({ status: 200, body: tasks }),
      'PUT /api/tasks/[^/]+': ({ body }) => {
        tasks = [{ ...openTask, ...(body as object), version: 2 }, second]
        return { status: 200, body: tasks[0] }
      },
    })
    renderApp('/')
    fireEvent.click(await screen.findByRole('button', { name: '2 tasks: Clareira' }))
    const sheet = await screen.findByRole('region', { name: 'Clareira' })
    const rows = () => within(sheet).getAllByRole('listitem').map((li) => li.textContent)
    expect(rows()).toEqual([expect.stringContaining('Regar'), expect.stringContaining('Semear')])
    // a ticked task keeps its row, so the next tap doesn't land on another one
    await userEvent.click(within(sheet).getByRole('button', { name: 'Done: Regar' }))
    expect(rows()).toEqual([expect.stringContaining('Regar'), expect.stringContaining('Semear')])
    // the pin now stands for the one task left
    expect(await screen.findByRole('button', { name: 'Task: Semear' })).toBeInTheDocument()
  })

  it('tapping a zone after a pin swaps the pin’s sheet for the zone’s', async () => {
    mapApi({ 'GET /api/tasks': () => ({ status: 200, body: [openTask] }) })
    const { container } = renderApp('/')
    fireEvent.click(await screen.findByRole('button', { name: 'Task: Regar' }))
    expect(await screen.findByText('Tasks in this zone · Plot 1')).toBeInTheDocument()
    await userEvent.click(container.querySelector('path.map-zone')!)
    expect(await screen.findByRole('link', { name: /Log activity/ })).toBeInTheDocument()
    expect(screen.queryByText('Tasks in this zone · Plot 1')).not.toBeInTheDocument()
  })
})

describe('layers', () => {
  it('switches plots, zones and tasks off and on, remembered on the phone', async () => {
    mapApi({ 'GET /api/tasks': () => ({ status: 200, body: [openTask] }) })
    const first = renderApp('/')
    await screen.findByRole('button', { name: 'Task: Regar' })
    await userEvent.click(screen.getByRole('button', { name: 'Layers' }))
    const group = screen.getByRole('group', { name: 'Show on the map' })
    await userEvent.click(within(group).getByRole('checkbox', { name: 'Tasks' }))
    await userEvent.click(within(group).getByRole('checkbox', { name: 'Zones' }))
    expect(screen.queryByRole('button', { name: 'Task: Regar' })).not.toBeInTheDocument()
    expect(first.container.querySelector('path.map-zone')).toBeNull()
    expect(screen.getByText('Plot 1 · 3.69 ha')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Layers, 2 off' })).toBeInTheDocument()
    first.unmount()

    // next time the app opens
    const again = renderApp('/')
    expect(await screen.findByText('Plot 1 · 3.69 ha')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Layers, 2 off' })).toBeInTheDocument()
    expect(again.container.querySelector('path.map-zone')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Task: Regar' })).not.toBeInTheDocument()

    // a zone picked from the list still shows with zones off
    await userEvent.click(screen.getByRole('button', { name: 'Zones' }))
    await userEvent.click(screen.getByRole('button', { name: /Clareira/ }))
    await screen.findByRole('heading', { name: 'Clareira' })
    expect(again.container.querySelectorAll('path.map-zone')).toHaveLength(1)
    await userEvent.keyboard('{Escape}')

    await userEvent.click(screen.getByRole('button', { name: 'Layers, 2 off' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Plots' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Zones' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Tasks' }))
    expect(screen.queryByText('Plot 1 · 3.69 ha')).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Task: Regar' })).toBeInTheDocument()
    expect(again.container.querySelector('path.map-zone')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Layers, 1 off' })).toBeInTheDocument()
  })

  it('shows everything when the stored choice is unreadable', async () => {
    localStorage.setItem('forest.map.layers', '{not json')
    mapApi({ 'GET /api/tasks': () => ({ status: 200, body: [openTask] }) })
    renderApp('/')
    expect(await screen.findByRole('button', { name: 'Task: Regar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Layers' })).toBeInTheDocument()
  })
})

describe('drawing', () => {
  it('draws a plot by tapping its corners, then names and saves it', async () => {
    const api = mapApi({
      'GET /api/plots': () => ({ status: 200, body: [] }),
      'GET /api/zones': () => ({ status: 200, body: [] }),
    })
    // the PUT answers with what it got
    api.fetchMock.mockImplementation(async (input, init) => {
      const path = String(input)
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body))
        return new Response(JSON.stringify({ id: path.split('/').pop(), ...body, area_ha: null, updated_at: 'x' }), { status: 201 })
      }
      if (path === '/api/field') return new Response(JSON.stringify(testField))
      return new Response(path === '/healthz' ? '{"status":"ok"}' : '[]')
    })
    const { container } = renderApp('/')
    await userEvent.click(await screen.findByRole('button', { name: '＋ Draw' }))
    await userEvent.click(screen.getByRole('button', { name: /A plot/ }))
    expect(screen.getByText(/0 of at least 3/)).toBeInTheDocument()

    const mapEl = container.querySelector('.leaflet-container')!
    for (const [x, y] of [
      [100, 100],
      [300, 100],
      [300, 300],
    ]) {
      fireEvent.click(mapEl, { clientX: x, clientY: y })
    }
    expect(await screen.findByText(/Drag corners to adjust/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByLabelText('Name')).toHaveValue('Plot 1')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Added Plot 1.')).toBeInTheDocument()
    const put = api.fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!
    const body = JSON.parse(String(put[1]!.body))
    expect(put[0]).toMatch(/^\/api\/plots\/[0-9a-f-]{36}$/)
    expect(body.geom.type).toBe('Polygon')
    expect(body.geom.coordinates[0]).toHaveLength(4) // 3 corners + closing point
    expect(body.geom.coordinates[0][0]).toEqual(body.geom.coordinates[0][3])
  })

  it('cannot draw a zone before there is a plot', async () => {
    mapApi({ 'GET /api/plots': () => ({ status: 200, body: [] }), 'GET /api/zones': () => ({ status: 200, body: [] }) })
    renderApp('/')
    await userEvent.click(await screen.findByRole('button', { name: '＋ Draw' }))
    expect(screen.getByRole('button', { name: /A zone/ })).toBeDisabled()
    expect(screen.getByText(/Draw a plot first/)).toBeInTheDocument()
  })

  it('edits a zone from its sheet', async () => {
    mapApi()
    renderApp('/')
    await userEvent.click(await screen.findByRole('button', { name: 'Zones' }))
    await userEvent.click(screen.getByRole('button', { name: /Clareira/ }))
    await userEvent.click(screen.getByRole('button', { name: /Edit zone/ }))
    expect(screen.getByRole('heading', { name: 'Edit the zone’s outline' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByLabelText(/Name/)).toHaveValue('Clareira')
    await userEvent.click(screen.getByRole('button', { name: '← Outline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: '＋ Draw' })).toBeInTheDocument()
  })

  it('undoes corners, and refuses a plot name that is taken', async () => {
    const api = mapApi()
    const { container } = renderApp('/')
    await userEvent.click(await screen.findByRole('button', { name: '＋ Draw' }))
    await userEvent.click(screen.getByRole('button', { name: /A plot/ }))
    const mapEl = container.querySelector('.leaflet-container')!
    for (const [x, y] of [
      [500, 100],
      [700, 100],
      [700, 300],
      [600, 400],
    ]) {
      fireEvent.click(mapEl, { clientX: x, clientY: y })
    }
    expect(await screen.findByText(/4 corners/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Undo/ }))
    expect(screen.getByText(/3 corners/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    const name = screen.getByLabelText('Name')
    await userEvent.clear(name)
    await userEvent.type(name, 'plot 1')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Another plot is already called “Plot 1”.')
    expect(api.fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  })

  it('a new zone is sent with the plot it was drawn in', async () => {
    const api = mapApi()
    api.fetchMock.mockImplementation(async (input, init) => {
      const path = String(input)
      if (init?.method === 'PUT') return new Response(JSON.stringify({ ...testZone, ...JSON.parse(String(init.body)), id: path.split('/').pop() }), { status: 201 })
      if (path === '/api/field') return new Response(JSON.stringify(testField))
      if (path === '/api/plots') return new Response(JSON.stringify([testPlot]))
      if (path === '/api/zones') return new Response(JSON.stringify([]))
      return new Response(path.startsWith('/api/') ? '[]' : '{"status":"ok"}')
    })
    const { container } = renderApp('/')
    await userEvent.click(await screen.findByRole('button', { name: '＋ Draw' }))
    await userEvent.click(screen.getByRole('button', { name: /A zone/ }))
    const mapEl = container.querySelector('.leaflet-container')!
    // well inside Plot 1 (0–400 frame units, shown from the top-left of the map)
    for (const [x, y] of [
      [250, 180],
      [300, 180],
      [300, 230],
    ]) {
      fireEvent.click(mapEl, { clientX: x, clientY: y })
    }
    expect(await screen.findByText(/In Plot 1/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.type(screen.getByLabelText(/Name/), 'Nova')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Added Nova.')).toBeInTheDocument()
    const put = api.fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!
    expect(JSON.parse(String(put[1]!.body))).toMatchObject({ plot_id: testPlot.id, label: 'Nova', kind: 'cultivation' })
  })

  it('deleting a zone says what goes with it, and hides its tasks at once', async () => {
    const task = { id: 't1', zone_id: testZone.id, plot_id: null, title: 'Regar', status: 'open', kind: 'water', due_on: null, created_at: 'x' }
    let tasks = [task]
    mapApi({
      'GET /api/tasks': () => ({ status: 200, body: tasks }),
      // the server deletes the zone's tasks with it
      'DELETE /api/zones/[^/]+': () => {
        tasks = []
        return { status: 204 }
      },
    })
    const { queryClient } = renderApp('/')
    await userEvent.click(await screen.findByRole('button', { name: 'Zones' }))
    await userEvent.click(screen.getByRole('button', { name: /Clareira/ }))
    await userEvent.click(screen.getByRole('button', { name: /Edit zone/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(queryClient.getQueryData(['tasks'])).toBeDefined())
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByRole('group', { name: 'Confirm delete' })).toHaveTextContent('Delete Clareira with its 1 open task?')
    await userEvent.click(screen.getByRole('button', { name: 'Delete zone' }))
    await waitFor(() => expect(queryClient.getQueryData(['tasks'])).toEqual([]))
  })

  it('offline: closing or reopening a task moves its zone in the list at once, and the server has the last word', async () => {
    const today = fieldToday()
    // both watered today; Clareira only comes first for its open task
    const clareira: Zone = { ...testZone, last_watered_on: today }
    const alto: Zone = { ...testZone, id: '20000000-0000-4000-8000-000000000002', label: 'Alto', last_watered_on: today }
    const task: Task = {
      id: '40000000-0000-4000-8000-000000000001',
      plot_id: null,
      zone_id: clareira.id,
      title: 'Regar',
      description: null,
      kind: 'water',
      status: 'open',
      due_on: null,
      completed_at: null,
      resolved_by_activity_id: null,
      version: 1,
      created_at: '2026-11-01T10:00:00Z',
      updated_at: '2026-11-01T10:00:00Z',
    }
    let tasks: Task[] = [task]
    const puts: string[] = []
    const count = (z: Zone) => tasks.filter((t) => t.zone_id === z.id && (t.status === 'open' || t.status === 'in_progress')).length
    const api = mapApi({
      'GET /api/zones': () => ({ status: 200, body: [clareira, alto].map((z) => ({ ...z, open_task_count: count(z) })) }),
      'GET /api/tasks': () => ({ status: 200, body: tasks }),
      'GET /api/activities.*': () => ({ status: 200, body: [] }),
    })
    api.fetchMock.mockImplementation(
      ((real) => async (input, init) => {
        const path = String(input)
        if (init?.method === 'PUT' && path.startsWith('/api/tasks/')) {
          puts.push(path)
          const body = JSON.parse(String(init.body)) as Task & { base_version: number }
          const saved = { ...task, ...body, id: path.split('/').pop()!, version: body.base_version + 1 }
          tasks = [...tasks.filter((t) => t.id !== saved.id), saved]
          return new Response(JSON.stringify(saved), { status: 200 })
        }
        return real(input, init)
      })(api.fetchMock.getMockImplementation()!),
    )
    // the tasks and the map were both seen online before
    const { router, queryClient } = renderApp('/tasks')
    await screen.findByRole('button', { name: 'Done: Regar' })
    await act(() => router.navigate('/'))
    await userEvent.click(await screen.findByRole('button', { name: 'Zones' }))
    const order = () =>
      within(screen.getByRole('region', { name: testPlot.name }))
        .getAllByRole('button')
        .map((b) => b.textContent)
    expect(order()).toEqual([expect.stringMatching(/^Clareira · 1 open task/), expect.stringMatching(/^Alto/)])

    onlineManager.setOnline(false)
    onTestFinished(() => onlineManager.setOnline(true))
    await act(() => router.navigate('/tasks'))
    await userEvent.click(await screen.findByRole('button', { name: 'Done: Regar' }))
    expect(await screen.findByText('Done: Regar.')).toBeInTheDocument()
    await act(() => router.navigate('/'))
    await userEvent.click(await screen.findByRole('button', { name: 'Zones' }))
    // nothing left to do in Clareira: back in name order, before the outbox is sent
    expect(order()).toEqual([expect.stringMatching(/^Alto/), expect.stringMatching(/^Clareira$|^Clareira[^·]/)])
    expect(puts).toEqual([])

    // reopened, still offline: counted again
    await act(() => router.navigate('/tasks'))
    await userEvent.click(await screen.findByRole('button', { name: /Show done/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Done: Regar' }))
    await act(() => router.navigate('/'))
    await userEvent.click(await screen.findByRole('button', { name: 'Zones' }))
    expect(order()[0]).toMatch(/^Clareira · 1 open task/)

    // meanwhile a second task was added there elsewhere: once synced, the server's count wins
    tasks = [...tasks, { ...task, id: '40000000-0000-4000-8000-000000000009', title: 'Semear' }]
    onlineManager.setOnline(true)
    await waitFor(() => expect(puts).toHaveLength(2))
    await waitFor(() => expect(order()[0]).toMatch(/^Clareira · 2 open tasks/))
    expect(queryClient.getQueryData<Zone[]>(['zones'])!.find((z) => z.id === clareira.id)!.open_task_count).toBe(2)
  })
})
