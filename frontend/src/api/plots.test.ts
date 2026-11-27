import { describe, expect, it } from 'vitest'
import { testPlot, testZone } from '../test/fixtures'
import { optimisticZone, zoneCode, zoneSubtitle, zoneTitle, type ZoneInput } from './plots'

const input: ZoneInput = { plot_id: testZone.plot_id, label: testZone.label, kind: testZone.kind, geom: testZone.geom, notes: null }

describe('zone codes', () => {
  it('names a zone by its code, or "nova" before the server gives it one', () => {
    expect(zoneCode(testZone)).toBe('Z1')
    expect(zoneTitle(testZone)).toBe('Z1 Clareira')
    const fresh = { ...testZone, code: null }
    expect(zoneCode(fresh)).toBe('nova')
    expect(zoneTitle(fresh)).toBe('Clareira (nova)')
    // a zone cached on the phone before codes existed
    expect(zoneCode({ ...testZone, code: undefined as unknown as null })).toBe('nova')
  })

  it('says which plot in the subtitle', () => {
    expect(zoneSubtitle(testZone, { name: 'Parcela 1' })).toBe('Zona Z1 da Parcela 1, 0,23 ha')
    expect(zoneSubtitle(testZone, testPlot)).toBe('Zona Z1 da parcela Plot 1, 0,23 ha')
    expect(zoneSubtitle({ ...testZone, code: null, area_ha: null }, { name: 'Encosta' })).toBe('Zona nova da parcela Encosta')
    expect(zoneSubtitle(testZone, undefined)).toBe('Zona Z1, 0,23 ha')
  })

  it('keeps the code on an edit while offline, and waits for a new one for a new or moved zone', () => {
    expect(optimisticZone('new-id', input, undefined).code).toBeNull()
    expect(optimisticZone(testZone.id, { ...input, label: 'Outra' }, testZone).code).toBe('Z1')
    expect(optimisticZone(testZone.id, { ...input, plot_id: 'another-plot' }, testZone).code).toBeNull()
  })
})
