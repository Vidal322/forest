import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useFieldToday } from './useFieldToday'

afterEach(() => {
  vi.useRealTimers()
})

describe('useFieldToday', () => {
  it('moves on at midnight in the field while the app stays open', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-22T23:59:30Z')) // Lisbon = UTC in winter
    const { result } = renderHook(() => useFieldToday())
    expect(result.current).toBe('2026-11-22')
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(result.current).toBe('2026-11-23')
  })
})
