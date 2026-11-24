import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { PlotStats } from '../api/stats'
import { overlappingMonths } from '../api/stats'
import { fakeApi } from '../test/fakeApi'
import { testField } from '../test/fixtures'
import { renderApp } from '../test/render'

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
