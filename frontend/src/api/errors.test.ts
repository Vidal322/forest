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

describe('photo upload errors', () => {
  it('has its own sentences, whatever the server message', () => {
    expect(friendlyError(new ApiError(422, 'not_an_image', 'not a PNG, JPEG or WebP image', null, 'photo'))).toBe(
      "That file isn't a photo the app can read. Use a PNG, JPG or WebP image.",
    )
    expect(friendlyError(new ApiError(413, 'too_large', 'the photo is larger than 30 MB', null, 'photo'))).toBe(
      'The photo is too big to upload (max 30 MB).',
    )
    expect(friendlyError(new ApiError(409, 'field_exists', 'x', null))).toBe('This field is already set up.')
  })
})
