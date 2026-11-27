import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Zone } from '../api/plots'
import { testPlot, testZone } from '../test/fixtures'
import { attention, attentionLabel } from '../domain/attention'
import { NeedsAttention } from './NeedsAttention'

const today = '2026-11-22'
let n = 0
const zone = (label: string, over: Partial<Zone>): Zone => ({
  ...testZone,
  id: `20000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  label,
  last_sown_on: null,
  last_planted_on: null,
  last_watered_on: null,
  open_task_count: 0,
  needs_water: null, // ignored: derived from the dates and today
  ...over,
})

describe('attention', () => {
  const zones = [
    zone('Fine', { last_watered_on: '2026-11-21' }),
    zone('Path', { kind: 'path' }),
    zone('Dry 3 days', { last_watered_on: '2026-11-12' }),
    zone('Bare', {}),
    zone('Dry 10 days, 1 task', { last_sown_on: '2026-11-05', open_task_count: 1 }),
    zone('Path, 2 tasks', { kind: 'path', open_task_count: 2 }),
  ]

  it('groups zones by what they need, most urgent first, counting each zone once', () => {
    const a = attention(zones, today)
    expect(a.water.map((z) => z.label)).toEqual(['Dry 10 days, 1 task', 'Dry 3 days'])
    expect(a.sowing.map((z) => z.label)).toEqual(['Bare'])
    expect(a.tasks.map((z) => z.label)).toEqual(['Path, 2 tasks', 'Dry 10 days, 1 task'])
    expect(a.total).toBe(4)
  })

  it('follows the day: a watered zone comes back once its interval has passed', () => {
    expect(attention(zones, '2026-11-28').water.map((z) => z.label)).toContain('Fine')
  })

  it('says how many zones need attention', () => {
    expect(attentionLabel(0)).toBe('✓ Nenhuma zona precisa de nada')
    expect(attentionLabel(1)).toBe('1 zona precisa de atenção')
    expect(attentionLabel(4)).toBe('4 zonas precisam de atenção')
  })

  it('lists each group with its count, and picks a zone on tap', async () => {
    const onPick = vi.fn<(z: Zone) => void>()
    render(<NeedsAttention plots={[testPlot]} summary={attention(zones, today)} today={today} onPick={onPick} />)
    const water = screen.getByRole('region', { name: 'Por regar: 2' })
    expect(within(water).getAllByRole('button')[0]).toHaveTextContent(`Dry 10 days, 1 task${testPlot.name} · sem rega há 17 dias`)
    expect(screen.getByRole('region', { name: 'Ainda sem nada: 1' })).toBeInTheDocument()
    const tasks = screen.getByRole('region', { name: 'Tarefas por fazer: 2' })
    expect(within(tasks).getByRole('button', { name: /Path, 2 tasks.*2 tarefas por fazer/ })).toBeInTheDocument()
    await userEvent.click(within(tasks).getByRole('button', { name: /Path, 2 tasks/ }))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ label: 'Path, 2 tasks' }))
  })

  it('says when nothing needs attention', () => {
    render(<NeedsAttention plots={[testPlot]} summary={attention(zones.slice(0, 1), today)} today={today} onPick={() => {}} />)
    expect(screen.getByText(/Nenhuma zona está por regar ou por semear/)).toBeInTheDocument()
  })
})
