import { screen, waitFor } from '@testing-library/react'
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
