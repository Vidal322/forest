import { formatNumber } from '../domain/numbers'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { FieldPhoto } from '../components/FieldMap'
import { toAffine } from '../map/affine'
import type { FramePoint } from '../map/frame'
import { ApiError, apiGet, apiRequest, apiSend } from './client'
import { outboxDefaults, pendingWrites } from './outbox'

export interface LineString {
  type: 'LineString'
  coordinates: [number, number][]
}

export interface Photo {
  id: string
  key: string
  width: number
  height: number
  affine_to_frame: number[]
  captured_on: string | null
  created_at: string
  alignment_points?: { photo: [number, number]; frame: [number, number] }[]
}

export interface Field {
  id: string
  name: string
  frame_width: number
  frame_height: number
  calibration_line: LineString | null
  calibration_length_m: number | null
  metres_per_unit: number | null
  default_water_interval_days: number
  photo: Photo | null
  updated_at: string
}

export interface FieldInput {
  name: string
  calibration_line: LineString | null
  calibration_length_m: number | null
  default_water_interval_days: number
}

export const fieldKey = ['field'] as const
const updateKey = ['field', 'update'] as const

/** The field, or null before it is set up (the API answers 404 no_field). */
export function useField() {
  return useQuery({
    queryKey: fieldKey,
    queryFn: async ({ signal }) => {
      try {
        return await apiGet<Field>('/api/field', { signal })
      } catch (err) {
        if (err instanceof ApiError && err.code === 'no_field') return null
        throw err
      }
    },
    staleTime: 5 * 60_000,
  })
}

/**
 * What FieldMap needs to show the field's current photo. The map loads the light
 * display copy (≤ 2048 px a side) stretched over the photo's full size, so the frame
 * is unchanged; calibration and alignment use the full-size original.
 */
export function fieldPhoto(field: Field, size: 'display' | 'original' = 'display'): FieldPhoto | null {
  if (!field.photo) return null
  const p = field.photo
  return {
    url: photoUrl(p.key, size),
    width: field.frame_width,
    height: field.frame_height,
    image: { width: p.width, height: p.height, affine: toAffine(p.affine_to_frame) },
  }
}

/** URL of a stored photo, as uploaded or as the map's display copy. */
export function photoUrl(key: string, size: 'display' | 'original'): string {
  return size === 'display' ? `/api/photos/${key}/display` : `/api/photos/${key}`
}

export function lineOf(a: FramePoint, b: FramePoint): LineString {
  return { type: 'LineString', coordinates: [[a[0], a[1]], [b[0], b[1]]] }
}

export function lineLength(l: LineString): number {
  const [a, b] = l.coordinates
  return a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0
}

/**
 * Set up the field: name + first photo. Needs a connection (a photo is too big to
 * queue on the phone), so it is a plain mutation, not part of the outbox.
 */
export function useCreateField() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ name, photo }: { name: string; photo: File }) => {
      const body = new FormData()
      body.append('name', name)
      body.append('photo', photo)
      return apiRequest<Field>('/api/field', { method: 'POST', body, timeoutMs: 5 * 60_000 })
    },
    networkMode: 'always', // fail at once with "no connection" instead of waiting silently
    onSuccess: (field) => qc.setQueryData(fieldKey, field),
    onError: (err) => {
      // e.g. the first try did arrive but its answer got lost: just load the field
      if (err instanceof ApiError && err.code === 'field_exists') void qc.invalidateQueries({ queryKey: fieldKey })
    },
  })
}

export function registerFieldMutations(qc: QueryClient) {
  qc.setMutationDefaults(updateKey, {
    ...outboxDefaults,
    mutationFn: (input: FieldInput) => apiSend<Field>('PUT', '/api/field', input),
    onMutate: async (input: FieldInput) => {
      await qc.cancelQueries({ queryKey: fieldKey })
      const before = qc.getQueryData<Field | null>(fieldKey)
      if (before) {
        const len = input.calibration_line ? lineLength(input.calibration_line) : 0
        qc.setQueryData<Field>(fieldKey, {
          ...before,
          ...input,
          metres_per_unit: input.calibration_length_m && len > 0 ? input.calibration_length_m / len : null,
        })
      }
      return { before }
    },
    // With more field edits queued, the last one's answer is the truth: until then keep
    // showing the optimistic state rather than flicker back to an older one.
    onSuccess: (field: Field) => {
      if (pendingWrites(qc, updateKey) <= 1) qc.setQueryData(fieldKey, field)
    },
    onError: (_err, _input, ctx) => {
      if (pendingWrites(qc, updateKey) > 1) return
      const before = (ctx as { before?: Field | null } | undefined)?.before
      if (before !== undefined) qc.setQueryData(fieldKey, before)
      void qc.invalidateQueries({ queryKey: fieldKey })
    },
  })
}

export function useUpdateField() {
  return useMutation<Field, Error, FieldInput>({ mutationKey: updateKey })
}

/** "1 px ≈ 0.48 m" style scale text (centimetres for very detailed photos). */
export function formatScale(metresPerUnit: number): string {
  if (metresPerUnit < 0.1) return `1 px ≈ ${formatNumber(Number((metresPerUnit * 100).toPrecision(2)))} cm`
  return `1 px ≈ ${formatNumber(Number(metresPerUnit.toPrecision(2)))} m`
}
