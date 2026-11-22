import { describe, expect, it } from 'vitest'
import { ApiError } from './client'
import { friendlyError } from './errors'

describe('friendlyError', () => {
  it('names the field in validation messages', () => {
    expect(friendlyError(new ApiError(422, 'invalid', 'is required', null, 'scientific_name'))).toBe(
      'Scientific name is required.',
    )
  })

  it('says which value is a duplicate', () => {
    expect(friendlyError(new ApiError(409, 'duplicate', 'x', null, 'scientific_name'))).toBe(
      'Scientific name is already used by another entry.',
    )
  })

  it('explains connection problems', () => {
    expect(friendlyError(new ApiError(0, 'network', 'x', null))).toMatch(/No connection/)
  })

  it('gives a reference for server errors', () => {
    expect(friendlyError(new ApiError(500, 'internal', 'x', 'abc123'))).toMatch(/ref\. abc123/)
  })

  it('handles non-API errors', () => {
    expect(friendlyError(new Error('boom'))).toBe('Something went wrong. Please try again.')
  })
})
