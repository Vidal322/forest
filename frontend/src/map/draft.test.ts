import { describe, expect, it } from 'vitest'
import { testPlot, testZone } from '../test/fixtures'
import { checkDraft, editDraft, newDraft } from './draft'

describe('checkDraft', () => {
  it('counts corners until there is a shape', () => {
    expect(checkDraft({ ...newDraft('plot'), corners: [[0, 0]] }, [], []).message).toMatch(/1 of at least 3/)
  })

  it('refuses an outline that crosses itself', () => {
    const d = { ...newDraft('plot'), corners: [[0, 0], [10, 10], [10, 0], [0, 10]] as [number, number][] }
    expect(checkDraft(d, [], [])).toMatchObject({ ok: false, message: expect.stringMatching(/crosses itself/) })
  })

  it('finds the plot a zone is in, and refuses a zone that leaves it', () => {
    const inside = { ...newDraft('zone'), corners: [[10, 10], [50, 10], [50, 50]] as [number, number][] }
    expect(checkDraft(inside, [testPlot], [])).toMatchObject({ ok: true, plotId: testPlot.id })
    const outside = { ...inside, corners: [[10, 10], [500, 10], [50, 50]] as [number, number][] }
    expect(checkDraft(outside, [testPlot], [])).toMatchObject({ ok: false, message: 'Keep the whole zone inside one plot.' })
  })

  it('will not shrink a plot past its zones', () => {
    const d = { ...editDraft('plot', testPlot), corners: [[0, 0], [100, 0], [100, 100], [0, 100]] as [number, number][] }
    expect(checkDraft(d, [testPlot], [testZone])).toMatchObject({ ok: false, message: expect.stringMatching(/Clareira would end up outside/) })
  })
})
