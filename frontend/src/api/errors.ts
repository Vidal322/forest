import { ApiError } from './client'

/** How each API input field is called on screen, for error sentences. */
const FIELD_LABELS: Record<string, string> = {
  scientific_name: 'Scientific name',
  common_name: 'Common name',
  notes: 'Notes',
  name: 'Name',
  photo: 'The photo',
  calibration_line: 'The scale line',
  calibration_length_m: 'The distance',
  default_water_interval_days: 'The watering interval',
}

function sentence(s: string): string {
  const t = s.trim()
  return t.endsWith('.') ? t : `${t}.`
}

/** A sentence a person in the field can act on, for any error thrown by the API layer. */
export function friendlyError(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Something went wrong. Please try again.'
  switch (err.code) {
    case 'network':
      return 'No connection to the server. Check your signal and try again.'
    case 'timeout':
      return 'The server is taking too long. Try again in a moment.'
    case 'duplicate':
      return err.field && FIELD_LABELS[err.field]
        ? `${FIELD_LABELS[err.field]} is already used by another entry.`
        : 'That name is already taken.'
    case 'invalid':
    case 'not_an_image':
    case 'too_large': {
      const label = err.field ? FIELD_LABELS[err.field] : undefined
      if (label && err.message) return sentence(`${label} ${err.message}`)
      return err.message ? sentence(`Please check this: ${err.message}`) : 'Please check what you typed.'
    }
    case 'deleted':
      return 'This was deleted in the meantime.'
    case 'not_found':
      return 'This no longer exists.'
    case 'version_conflict':
      return 'This was changed somewhere else in the meantime. Reload to see the latest.'
    default:
      return err.requestId
        ? `The server had a problem (ref. ${err.requestId}). Please try again.`
        : 'The server had a problem. Please try again.'
  }
}
