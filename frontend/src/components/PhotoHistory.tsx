import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { apiGet, apiSend } from '../api/client'
import { friendlyError } from '../api/errors'
import { fieldKey, photoUrl } from '../api/field'
import { fieldToday, formatDay } from '../domain/dates'
import { fitLabel, type PhotoInfo } from './photoFit'

/** Every photo of the field; the one shown under the drawings can be switched. */
export function PhotoHistory({ onMessage }: { onMessage: (m: string) => void }) {
  const qc = useQueryClient()
  const photos = useQuery({ queryKey: ['field-photos'], queryFn: ({ signal }) => apiGet<PhotoInfo[]>('/api/field/photos', { signal }) })
  const choose = useMutation({
    mutationFn: (id: string) => apiSend<PhotoInfo>('PUT', `/api/field/photos/${id}/current`),
    networkMode: 'always',
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: fieldKey })
      void qc.invalidateQueries({ queryKey: ['field-photos'] })
      onMessage('The map now shows the photo you chose.')
    },
  })
  const [open, setOpen] = useState(false)
  if (!photos.data || photos.data.length < 2) return null
  const day = (p: PhotoInfo) => (p.captured_on ? formatDay(p.captured_on) : `added ${formatDay(fieldToday(new Date(p.created_at)))}`)
  return (
    <section className="card" aria-labelledby="photos-t">
      <h2 id="photos-t">Photos of the field</h2>
      {/* collapsed: each thumbnail is a whole display copy, heavy on mobile data */}
      <button type="button" className="btn-link" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide' : 'Show'} the {photos.data.length} photos
      </button>
      {open && (
      <ul className="list">
        {photos.data.map((p) => (
          <li key={p.id} className="photo-row">
            <img src={photoUrl(p.key, 'display')} alt="" className="photo-row__thumb" loading="lazy" />
            <span className="photo-row__text">
              <b>{day(p)}</b>
              <span className="muted small">It {fitLabel(p)}</span>
            </span>
            {p.is_current ? (
              <span className="muted small">shown</span>
            ) : (
              <button
                type="button"
                className="btn btn-small"
                disabled={choose.isPending}
                onClick={() => choose.mutate(p.id)}
                aria-label={`Show the photo from ${day(p)}`}
              >
                Show this one
              </button>
            )}
          </li>
        ))}
      </ul>
      )}
      {choose.error && (
        <p className="form__error" role="alert">
          {friendlyError(choose.error)}
        </p>
      )}
    </section>
  )
}
