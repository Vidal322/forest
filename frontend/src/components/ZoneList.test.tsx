import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import type { Zone } from '../api/plots'
import { testPlot, testZone } from '../test/fixtures'
import { ZoneList } from './ZoneList'

const today = '2026-11-22'
let n = 0
const pick = () => {}
// the plot names link to the plot's page
const wrapper = MemoryRouter
const zone = (label: string, over: Partial<Zone>): Zone => ({
  ...testZone,
  id: `20000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  label,
  last_sown_on: null,
  last_planted_on: null,
  last_watered_on: null,
  open_task_count: 0,
  needs_water: null, // stored flag is ignored: the list derives the status itself
  ...over,
})

describe('ZoneList', () => {
  it('lists the most urgent zones first and says why', () => {
    const zones = [
      zone('A fine', { last_watered_on: '2026-11-21' }),
      zone('B path', { kind: 'path' }),
      zone('C dry 3 days', { last_watered_on: '2026-11-12' }), // interval 7: due 11-19
      zone('D nothing sown', {}),
      zone('E dry 10 days', { last_sown_on: '2026-11-05' }), // due 11-12
      zone('F path with a task', { kind: 'path', open_task_count: 2 }),
      zone('G watered with a task', { last_watered_on: '2026-11-21', open_task_count: 1 }),
      zone('H dry today', { last_planted_on: '2026-11-15' }), // due today
    ]
    render(<ZoneList plots={[testPlot]} zones={zones} today={today} onPick={pick} />, { wrapper })
    expect(screen.getByText(/Most urgent first/)).toBeInTheDocument()
    const names = within(screen.getByRole('region', { name: testPlot.name }))
      .getAllByRole('button')
      .map((b) => b.textContent!.match(/^[A-H]/)![0])
    expect(names.join('')).toBe('ECHDFGAB')
    expect(screen.getByRole('button', { name: /F path with a task · 2 open tasks/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /G watered with a task · 1 open task(?!s)/ })).toBeInTheDocument()
  })

  it('follows the day: a zone that dries out moves up', () => {
    const zones = [zone('Alpha', { last_watered_on: '2026-11-21' }), zone('Beta', { last_watered_on: '2026-11-20' })]
    const { rerender } = render(<ZoneList plots={[testPlot]} zones={zones} today={today} onPick={pick} />, { wrapper })
    const order = () => screen.getAllByRole('button').map((b) => b.textContent!.match(/^(Alpha|Beta)/)![0])
    expect(order()).toEqual(['Alpha', 'Beta']) // both fine: by name
    rerender(<ZoneList plots={[testPlot]} zones={zones} today="2026-11-27" onPick={pick} />)
    expect(order()).toEqual(['Beta', 'Alpha']) // Beta is due on the 27th, Alpha not yet
  })
})
