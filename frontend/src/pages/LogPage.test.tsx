import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Browser } from 'leaflet'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Zone } from '../api/plots'
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

function logApi() {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(800)
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(600)
  return fakeApi({
    'GET /api/field': () => ({ status: 200, body: testField }),
    'GET /api/plots': () => ({ status: 200, body: [testPlot] }),
    'GET /api/zones': () => ({ status: 200, body: [dryZone, freshZone] }),
    'GET /api/species': () => ({ status: 200, body: [suber] }),
    'GET /api/activities': () => ({ status: 200, body: [] }),
    'PUT /api/activities/[^/]+': ({ path, body }) => ({
      status: 201,
      body: { id: path.split('/').pop(), ...(body as object), version: 1, created_at: 'x', updated_at: 'x' },
    }),
  })
}

const putBody = (api: ReturnType<typeof logApi>) => api.calls.find((c) => c.method === 'PUT')?.body as Record<string, unknown>

describe('LogPage', () => {
  it('waters every zone that needs it in three taps', async () => {
    const api = logApi()
    renderApp('/log')
    await userEvent.click(await screen.findByRole('button', { name: 'All that need water (1)' }))
    expect(screen.getByText('Clareira selected')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Watered/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }))

    expect(await screen.findByText('Logged: watered Clareira today.')).toBeInTheDocument()
    expect(putBody(api)).toEqual({
      type: 'watering',
      performed_on: fieldToday(),
      notes: null,
      zones: [{ zone_id: dryZone.id, quantity: null, unit: null }],
      species: [],
      base_version: null,
    })
    // the form is ready for the next entry
    expect(screen.getByText('No zones selected')).toBeInTheDocument()
  })

  it('logs a sowing with covas per zone and a seed mix', async () => {
    const api = logApi()
    renderApp('/log')
    await userEvent.click(await screen.findByRole('button', { name: 'Pick from a list' }))
    const list = screen.getByRole('group', { name: 'Zones' })
    await userEvent.click(within(list).getByRole('checkbox', { name: /Clareira/ }))
    await userEvent.click(within(list).getByRole('checkbox', { name: /Encosta/ }))
    await userEvent.click(screen.getByRole('button', { name: /Sowed/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Per zone…' }))
    await userEvent.type(screen.getByRole('textbox', { name: /Clareira, covas/ }), '100')
    await userEvent.type(screen.getByRole('textbox', { name: /Encosta, covas/ }), '80')
    await userEvent.click(screen.getByRole('button', { name: 'sobreiro' }))
    await userEvent.click(screen.getByRole('button', { name: 'Yesterday' }))
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }))

    expect(await screen.findByText(/Logged: sowed Clareira and Encosta on/)).toBeInTheDocument()
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
    await userEvent.click(await screen.findByRole('button', { name: /^Save/ }))
    expect(screen.getByRole('alert')).toHaveTextContent('Tap the zones you worked on')
    await userEvent.click(screen.getByRole('button', { name: /All that need water/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }))
    expect(screen.getByRole('alert')).toHaveTextContent('Choose what you did')
  })

  it('starts with the zone chosen on the map', async () => {
    logApi()
    renderApp(`/log?zone=${freshZone.id}`)
    expect(await screen.findByText('Encosta selected')).toBeInTheDocument()
  })

  it('without a connection, keeps the entry on the phone and recolours the map', async () => {
    const api = logApi()
    const { queryClient } = renderApp('/log')
    await userEvent.click(await screen.findByRole('button', { name: /All that need water/ }))
    api.fetchMock.mockImplementation(async (input) => {
      if (String(input) === '/healthz') return new Response('{"status":"ok"}')
      throw new TypeError('Failed to fetch')
    })
    await userEvent.click(screen.getByRole('button', { name: /Watered/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }))
    expect(await screen.findByText(/Saved on this phone/)).toBeInTheDocument()
    const zones = queryClient.getQueryData<Zone[]>(['zones'])!
    expect(zones.find((z) => z.id === dryZone.id)?.last_watered_on).toBe(fieldToday())
    expect(screen.queryByRole('button', { name: /All that need water/ })).not.toBeInTheDocument()
  })

  it('keeps the entry when the server refuses it, and says why', async () => {
    const api = logApi()
    renderApp('/log')
    await userEvent.click(await screen.findByRole('button', { name: /All that need water/ }))
    api.fetchMock.mockImplementation(async (input, init) => {
      if (init?.method === 'PUT')
        return new Response('{"error":{"code":"invalid","message":"pick the zones again","field":"zones"}}', { status: 422 })
      return new Response(String(input) === '/healthz' ? '{"status":"ok"}' : '[]')
    })
    await userEvent.click(screen.getByRole('button', { name: /Watered/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Zones: pick the zones again.')
    expect(screen.getByRole('button', { name: /Watered/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('drops a count typed for another kind of work', async () => {
    const api = logApi()
    renderApp('/log')
    await userEvent.click(await screen.findByRole('button', { name: /All that need water/ }))
    await userEvent.click(screen.getByRole('button', { name: /Sowed/ }))
    await userEvent.type(screen.getByLabelText(/How many covas/), '100')
    await userEvent.click(screen.getByRole('button', { name: /More/ }))
    await userEvent.click(screen.getByRole('button', { name: /Other/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }))
    await screen.findByText(/Logged: logged Clareira/)
    expect((putBody(api).zones as { quantity: unknown }[])[0]!.quantity).toBeNull()
  })

  it('refuses a typed day in the future', async () => {
    logApi()
    renderApp('/log')
    await userEvent.click(await screen.findByRole('button', { name: /All that need water/ }))
    await userEvent.click(screen.getByRole('button', { name: /Watered/ }))
    fireEvent.change(screen.getByLabelText('Another day'), { target: { value: '2999-01-01' } })
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }))
    expect(screen.getByRole('alert')).toHaveTextContent("The day can't be after today.")
  })

  it('undoes the entry just logged in one tap', async () => {
    const api = logApi()
    renderApp('/log')
    await userEvent.click(await screen.findByRole('button', { name: /All that need water/ }))
    await userEvent.click(screen.getByRole('button', { name: /Watered/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }))
    await screen.findByText(/Logged: watered Clareira today/)
    const id = api.calls.find((c) => c.method === 'PUT')!.path.split('/').pop()
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('Entry removed.')).toBeInTheDocument()
    await waitFor(() => expect(api.calls.some((c) => c.method === 'DELETE' && c.path === `/api/activities/${id}`)).toBe(true))
  })
})
