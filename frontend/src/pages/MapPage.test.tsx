import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Browser } from 'leaflet'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
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

function mapApi(over: Record<string, () => { status: number; body?: unknown }> = {}) {
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

  it('has a legend for the colours', async () => {
    mapApi()
    renderApp('/')
    await userEvent.click(await screen.findByRole('button', { name: 'Legend' }))
    expect(screen.getByRole('list', { name: 'Map colours' })).toHaveTextContent('Needs water')
  })

  it('invites you to draw when there are no plots yet', async () => {
    mapApi({ 'GET /api/plots': () => ({ status: 200, body: [] }), 'GET /api/zones': () => ({ status: 200, body: [] }) })
    renderApp('/')
    expect(await screen.findByText(/No plots yet/)).toBeInTheDocument()
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
      return new Response('{"status":"ok"}')
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
})
