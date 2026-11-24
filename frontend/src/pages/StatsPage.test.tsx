import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { PlantedStats, PlotStats } from '../api/stats'
import { overlappingMonths } from '../api/stats'
import { fakeApi } from '../test/fakeApi'
import { testField } from '../test/fixtures'
import { renderApp } from '../test/render'
import { addDays, fieldToday } from '../domain/dates'

const p1: PlotStats = {
  plot_id: 'p1',
  name: 'Plot 1',
  area_ha: 6.14,
  declared_area_ha: 6.2,
  zone_count: 7,
  tree_count: 0,
  dead_tree_count: 0,
  species_count: 3,
  last_watered_on: null,
  open_task_count: 2,
  holes_sown: 240,
  trees_planted: 78,
  litres_watered: 0,
  waterings_last_30d: 4,
  zones_need_water: 2,
  cultivation_zones: 6,
  zones_watered_7d: 4,
  activities_per_week: [1, 0, 0, 2, 0, 0, 1, 5],
}

describe('StatsPage', () => {
  it('shows per-plot numbers and how the area compares with the old map', async () => {
    fakeApi({ 'GET /api/plot-stats': () => ({ status: 200, body: [p1, { ...p1, plot_id: 'p2', name: 'Plot 2', area_ha: null }] }) })
    renderApp('/stats')
    const card = await screen.findByRole('region', { name: 'Plot 1' })
    expect(card).toHaveTextContent('6.14 ha measured · 6.20 ha on the old map (-1%)')
    expect(within(card).getByText('240')).toBeInTheDocument()
    expect(card).toHaveTextContent('Last watered: never')
    expect(screen.getByText(/Areas appear once the scale is set/)).toBeInTheDocument()
  })

  it('shows watering coverage over 7 days and activity per week over 8 weeks', async () => {
    const empty = { ...p1, plot_id: 'p2', name: 'Plot 2', cultivation_zones: 0, zones_watered_7d: 0, activities_per_week: Array(8).fill(0) }
    fakeApi({ 'GET /api/plot-stats': () => ({ status: 200, body: [p1, empty] }) })
    renderApp('/stats')
    const card = await screen.findByRole('region', { name: 'Plot 1' })
    expect(card).toHaveTextContent('4 of 6 cultivation zones (67%)')
    const weeks = within(within(card).getByRole('list', { name: /Activities logged per week/ })).getAllByRole('listitem')
    expect(weeks).toHaveLength(8)
    expect(weeks[0]).toHaveTextContent('49–55 days ago: 1 activity')
    expect(weeks[7]).toHaveTextContent('last 7 days: 5 activities')

    const other = screen.getByRole('region', { name: 'Plot 2' })
    expect(other).toHaveTextContent('No cultivation zones yet.')
    expect(other).toHaveTextContent('Nothing logged in the last 8 weeks.')
    expect(other.querySelector('.meter')).toBeNull()
  })
})

describe('sown and planted by date', () => {
  const planted = (from: string, to: string): PlantedStats => ({
    from,
    to,
    plots: [
      { plot_id: 'p1', name: 'Plot 1', holes_sown: 1200, trees_planted: 30 },
      { plot_id: 'p2', name: 'Plot 2', holes_sown: 40, trees_planted: 0 },
    ],
    species: [{ species_id: 's1', scientific_name: 'Quercus suber', common_name: 'Sobreiro', holes_sown: 1240, trees_planted: 12 }],
  })
  const api = () =>
    fakeApi({
      'GET /api/plot-stats': () => ({ status: 200, body: [p1, { ...p1, plot_id: 'p2', name: 'Plot 2' }] }),
      'GET /api/planted-stats\\?.*': ({ path }) => {
        const q = new URLSearchParams(path.split('?')[1])
        return { status: 200, body: planted(q.get('from')!, q.get('to')!) }
      },
    })
  const requested = (calls: { path: string }[]) => calls.filter((c) => c.path.startsWith('/api/planted-stats')).map((c) => c.path)

  it('shows covas and trees per plot and per species, this year by default', async () => {
    const { calls } = api()
    renderApp('/stats')
    const card = await screen.findByRole('region', { name: 'Sown & planted by date' })
    const today = fieldToday()
    expect(within(card).getByRole('button', { name: 'This year' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(card).getByLabelText('From')).toHaveValue(`${today.slice(0, 4)}-01-01`)
    expect(within(card).getByLabelText('To')).toHaveValue(today)
    const perPlot = await within(card).findByRole('table', { name: 'Per plot' })
    expect(within(perPlot).getByRole('row', { name: /Plot 1/ })).toHaveTextContent('Plot 11,20030')
    expect(within(perPlot).getByRole('row', { name: /All plots/ })).toHaveTextContent('All plots1,24030')
    const perSpecies = within(card).getByRole('table', { name: 'Per species' })
    expect(within(perSpecies).getByRole('row', { name: /Sobreiro/ })).toHaveTextContent('SobreiroQuercus suber1,24012')
    expect(new Set(requested(calls))).toEqual(new Set([`/api/planted-stats?from=${today.slice(0, 4)}-01-01&to=${today}`]))
  })

  it('changes the range with a quick range or the dates, and refuses a reversed range', async () => {
    const { calls } = api()
    renderApp('/stats')
    const card = await screen.findByRole('region', { name: 'Sown & planted by date' })
    const today = fieldToday()
    await userEvent.click(within(card).getByRole('button', { name: 'Last 30 days' }))
    expect(within(card).getByLabelText('From')).toHaveValue(addDays(today, -29))
    await waitFor(() => expect(requested(calls)).toContain(`/api/planted-stats?from=${addDays(today, -29)}&to=${today}`))

    const before = requested(calls).length
    fireEvent.change(within(card).getByLabelText('From'), { target: { value: addDays(today, 1) } })
    expect(within(card).getByRole('alert')).toHaveTextContent('The start date is after the end date.')
    expect(within(card).getByLabelText('From')).toHaveAttribute('aria-invalid', 'true')
    expect(within(card).queryByRole('table')).toBeNull()
    expect(requested(calls)).toHaveLength(before)

    fireEvent.change(within(card).getByLabelText('From'), { target: { value: `${today.slice(0, 4)}-09-01` } })
    fireEvent.change(within(card).getByLabelText('To'), { target: { value: `${today.slice(0, 4)}-09-30` } })
    await waitFor(() => expect(requested(calls)).toContain(`/api/planted-stats?from=${today.slice(0, 4)}-09-01&to=${today.slice(0, 4)}-09-30`))
    await waitFor(() => expect(card).toHaveTextContent(/1 Sept? – 30 Sept?, both days included/))
  })

  it('falls back to the default range when the address carries an impossible date', async () => {
    const { calls } = api()
    renderApp('/stats?from=2026-13-45&to=2026-02-30')
    const card = await screen.findByRole('region', { name: 'Sown & planted by date' })
    const today = fieldToday()
    expect(within(card).getByLabelText('From')).toHaveValue(`${today.slice(0, 4)}-01-01`)
    expect(within(card).getByLabelText('To')).toHaveValue(today)
    await waitFor(() => expect(new Set(requested(calls))).toEqual(new Set([`/api/planted-stats?from=${today.slice(0, 4)}-01-01&to=${today}`])))
  })
})

describe('watering rules', () => {
  it('finds months covered twice, also across December', () => {
    expect(overlappingMonths([{ from_month: 11, to_month: 2 }, { from_month: 1, to_month: 3 }])).toEqual([1, 2])
    expect(overlappingMonths([{ from_month: 6, to_month: 9 }, { from_month: 10, to_month: 5 }])).toEqual([])
  })

  it('adds a season in field setup', async () => {
    let rules: object[] = []
    const api = fakeApi({
      'GET /api/field': () => ({ status: 200, body: testField }),
      'GET /api/watering-rules': () => ({ status: 200, body: rules }),
      'PUT /api/watering-rules/[^/]+': ({ path, body }) => {
        const saved = { id: path.split('/').pop(), ...(body as object), created_at: 'x', updated_at: 'x', overlaps_with: [] }
        rules = [saved]
        return { status: 201, body: saved }
      },
    })
    renderApp('/field')
    await userEvent.click(await screen.findByRole('button', { name: /Add a season/ }))
    const form = screen.getByRole('form', { name: 'New season' })
    await userEvent.type(within(form).getByLabelText('Season'), 'Summer')
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Saved Summer.')).toBeInTheDocument()
    expect(api.calls.find((c) => c.method === 'PUT')?.body).toEqual({ name: 'Summer', from_month: 6, to_month: 9, interval_days: 4 })
    expect(screen.getByRole('button', { name: 'Edit Summer' })).toHaveTextContent('June – September')
  })
})
