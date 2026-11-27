import { describe, expect, it } from 'vitest'
import { ApiError } from './client'
import { friendlyError } from './errors'

describe('friendlyError', () => {
  it('names the field in validation messages, with the server text as it arrives', () => {
    expect(friendlyError(new ApiError(422, 'invalid', 'é obrigatório', null, 'scientific_name'))).toBe(
      'O nome científico é obrigatório.',
    )
  })

  it('says which value is a duplicate', () => {
    expect(friendlyError(new ApiError(409, 'duplicate', 'x', null, 'scientific_name'))).toBe(
      'O nome científico já está a ser usado noutro registo.',
    )
  })

  it('explains connection problems', () => {
    expect(friendlyError(new ApiError(0, 'network', 'x', null))).toMatch(/Sem ligação/)
  })

  it('gives a reference for server errors', () => {
    expect(friendlyError(new ApiError(500, 'internal', 'x', 'abc123'))).toMatch(/ref\. abc123/)
  })

  it('handles non-API errors', () => {
    expect(friendlyError(new Error('boom'))).toBe('Algo correu mal. Tenta outra vez.')
  })
})

describe('photo upload errors', () => {
  it('has its own sentences, whatever the server message', () => {
    expect(friendlyError(new ApiError(422, 'not_an_image', 'not a PNG, JPEG or WebP image', null, 'photo'))).toBe(
      'Esse ficheiro não é uma fotografia que a aplicação consiga ler. Usa uma imagem PNG, JPG ou WebP.',
    )
    expect(friendlyError(new ApiError(413, 'too_large', 'the photo is larger than 30 MB', null, 'photo'))).toBe(
      'A fotografia é grande demais para enviar (máximo 30 MB).',
    )
    expect(friendlyError(new ApiError(409, 'field_exists', 'x', null))).toBe('Este terreno já está configurado.')
  })
})
