import { useMutation, useQueryClient } from '@tanstack/react-query'
import { divIcon } from 'leaflet'
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { Marker, useMapEvents } from 'react-leaflet'
import { apiRequest } from '../api/client'
import { friendlyError } from '../api/errors'
import { fieldKey, fieldPhoto, type Field } from '../api/field'
import { toFramePoint, toLatLng, type FramePoint } from '../map/frame'
import { FieldMap } from './FieldMap'
import { fitLabel, type PhotoInfo } from './photoFit'

interface Pair {
  photo: FramePoint
  frame: FramePoint | null
}

// the server's limits, checked here before a long upload over mobile data
const MAX_BYTES = 30 * 1024 * 1024
const MAX_SIDE = 12_000
const MAX_PIXELS = 40_000_000

const icons = new Map<string, ReturnType<typeof divIcon>>()
function pinIcon(n: number, open: boolean) {
  const key = `${n}:${open}`
  let icon = icons.get(key)
  if (!icon) {
    icon = divIcon({ className: `map-pin${open ? ' is-open' : ''}`, html: `<span>${n}</span>`, iconSize: [32, 32], iconAnchor: [16, 16] })
    icons.set(key, icon)
  }
  return icon
}

const round = (p: FramePoint): FramePoint => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]

/** Tap on a map to place the next point; shows the numbered pins already placed. */
function PinLayer({
  points,
  openIndex,
  bounds,
  onTap,
  onOutside,
}: {
  points: (FramePoint | null)[]
  openIndex: number
  bounds: { width: number; height: number }
  onTap: (p: FramePoint) => void
  onOutside: () => void
}) {
  useMapEvents({
    click: (e) => {
      const p = round(toFramePoint(e.latlng))
      if (p[0] < 0 || p[1] < 0 || p[0] > bounds.width || p[1] > bounds.height) onOutside()
      else onTap(p)
    },
  })
  return (
    <>
      {points.map((p, i) =>
        p ? <Marker key={i} position={toLatLng(p)} icon={pinIcon(i + 1, i === openIndex)} interactive={false} keyboard={false} /> : null,
      )}
    </>
  )
}

/** The natural (upright) size of a picked image, or an error if the browser can't read it. */
function useImageSize(url: string | null): { width: number; height: number } | 'unreadable' | null {
  const [size, setSize] = useState<{ url: string; value: { width: number; height: number } | 'unreadable' } | null>(null)
  useEffect(() => {
    if (!url) return
    const img = new Image()
    img.onload = () => setSize({ url, value: { width: img.naturalWidth, height: img.naturalHeight } })
    img.onerror = () => setSize({ url, value: 'unreadable' })
    img.src = url
  }, [url])
  return size && size.url === url ? size.value : null
}

/**
 * Newer photo: tap the same landmark (a rock, a path bend, a building corner) on
 * the new photo and on the current map, at least 3 times — 4 or more spread over
 * the field is better. The server fits the transform; drawings stay where they are.
 * One map is shown at a time and it switches after each tap.
 */
export function PhotoAlignment({ field, onDone }: { field: Field; onDone: (message: string) => void }) {
  const qc = useQueryClient()
  const current = fieldPhoto(field, 'original')
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [inputKey, setInputKey] = useState(0)
  const urlRef = useRef<string | null>(null)
  const size = useImageSize(url)
  const [pairs, setPairs] = useState<Pair[]>([])
  const [view, setView] = useState<'photo' | 'frame'>('photo')
  const [captured, setCaptured] = useState('')
  const [localError, setLocalError] = useState('')
  const ids = { file: useId(), date: useId(), err: useId(), head: useId(), step: useId() }

  useEffect(() => () => void (urlRef.current && URL.revokeObjectURL(urlRef.current)), [])
  const pick = (f: File | null) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = f ? URL.createObjectURL(f) : null
    setFile(f)
    setUrl(urlRef.current)
    setPairs([])
    setView('photo')
    setLocalError(f && f.size > MAX_BYTES ? 'The photo is too big to upload (max 30 MB).' : '')
  }

  const upload = useMutation({
    mutationFn: (body: FormData) => apiRequest<PhotoInfo>('/api/field/photos', { method: 'POST', body, timeoutMs: 5 * 60_000 }),
    networkMode: 'always',
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: fieldKey })
      void qc.invalidateQueries({ queryKey: ['field-photos'] })
    },
  })

  const open = pairs.findIndex((p) => !p.frame)
  const waitingFor: 'photo' | 'frame' = open >= 0 ? 'frame' : 'photo'
  const complete = pairs.filter((p): p is { photo: FramePoint; frame: FramePoint } => p.frame !== null)
  const imageSize = size && size !== 'unreadable' ? size : null
  const tooManyPixels = imageSize !== null && (imageSize.width > MAX_SIDE || imageSize.height > MAX_SIDE || imageSize.width * imageSize.height > MAX_PIXELS)

  const tap = (side: 'photo' | 'frame', p: FramePoint) => {
    setLocalError('')
    if (side !== waitingFor) return // the other map is hidden: can't happen
    setPairs((cur) => (side === 'photo' ? [...cur, { photo: p, frame: null }] : cur.map((x, i) => (i === open ? { ...x, frame: p } : x))))
    setView(side === 'photo' ? 'frame' : 'photo') // on to the other picture
  }
  const removePair = (i: number) => {
    setPairs((cur) => cur.filter((_, j) => j !== i))
    setView(pairs[i] && !pairs[i]!.frame ? 'photo' : view)
  }

  const photoPoints = useMemo(() => pairs.map((p) => p.photo), [pairs])
  const framePoints = useMemo(() => pairs.map((p) => p.frame), [pairs])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (upload.isPending) return
    if (!file) return setLocalError('Choose the new photo.')
    if (file.size > MAX_BYTES) return setLocalError('The photo is too big to upload (max 30 MB).')
    if (tooManyPixels) return setLocalError('The photo has too many pixels (max 12 000 per side, 40 megapixels). Make it smaller first.')
    if (complete.length < 3) return setLocalError(`Match at least 3 landmarks (${complete.length} so far).`)
    setLocalError('')
    const body = new FormData()
    body.append('photo', file)
    body.append('alignment', JSON.stringify(complete))
    if (captured) body.append('captured_on', captured)
    upload.mutate(body, {
      onSuccess: (p) => {
        // ready for another photo; the same one can't be sent twice by accident
        pick(null)
        setCaptured('')
        setInputKey((k) => k + 1)
        upload.reset()
        onDone(`New photo aligned: it ${fitLabel(p)}. The map now shows it under your drawings.`)
      },
    })
  }

  const error = localError || (upload.error ? friendlyError(upload.error) : '')
  const step =
    waitingFor === 'photo'
      ? `Landmark ${pairs.length + 1}: tap it on the new photo.`
      : `Landmark ${open + 1}: now tap the same spot on the current map.`

  return (
    <form className="card" onSubmit={submit} noValidate aria-labelledby={ids.head}>
      <h2 id={ids.head}>Newer photo? Align it</h2>
      <p className="muted small">
        Plots and zones stay where they are. Tap the same landmark — a rock, a path bend, a building corner — first on the
        new photo, then on the current map. Do this at least 3 times, spread over the field. (This needs pointing at the
        pictures; it can't be done by keyboard.)
      </p>
      <label className="photo-pick">
        <input key={inputKey} id={ids.file} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
        <span aria-hidden="true">📷</span>
        <span>{file ? `${file.name} — tap to change` : 'Choose the newer photo'}</span>
      </label>

      {size === 'unreadable' && (
        <p className="form__error" role="alert">
          That file isn't a photo the app can read. Use a PNG, JPG or WebP image.
        </p>
      )}

      {imageSize && current && (
        <>
          <p id={ids.step} className="align-step" aria-live="polite">
            {step}
          </p>
          <fieldset className="row align-switch">
            <legend className="visually-hidden">Show</legend>
            {(['photo', 'frame'] as const).map((v) => (
              <button key={v} type="button" className={`chip${view === v ? ' is-on' : ''}`} aria-pressed={view === v} onClick={() => setView(v)}>
                {v === 'photo' ? 'New photo' : 'Current map'}
              </button>
            ))}
          </fieldset>
          {/* one map at a time: on a phone two stacked maps leave no room to scroll */}
          <div className={`setup-map${view === waitingFor ? ' is-active' : ''}`} aria-describedby={ids.step}>
            {view === 'photo' ? (
              <FieldMap key={`photo:${url}`} photo={{ url: url!, width: imageSize.width, height: imageSize.height }} wheelZoom={false} doubleTapZoom={false}>
                <PinLayer
                  points={photoPoints}
                  openIndex={open}
                  bounds={imageSize}
                  onTap={(p) => (waitingFor === 'photo' ? tap('photo', p) : setLocalError('Switch to the current map to place this landmark there.'))}
                  onOutside={() => setLocalError('Tap on the photo itself.')}
                />
              </FieldMap>
            ) : (
              <FieldMap key="frame" photo={current} wheelZoom={false} doubleTapZoom={false}>
                <PinLayer
                  points={framePoints}
                  openIndex={open}
                  bounds={{ width: current.width, height: current.height }}
                  onTap={(p) => (waitingFor === 'frame' ? tap('frame', p) : setLocalError('First tap the landmark on the new photo.'))}
                  onOutside={() => setLocalError('Tap on the map itself.')}
                />
              </FieldMap>
            )}
          </div>
          <div className="row" aria-live="polite">
            <span className="muted">
              {complete.length} landmark{complete.length === 1 ? '' : 's'} matched
              {complete.length < 3 ? ' — at least 3 needed' : complete.length < 4 ? ' — a 4th makes it more precise' : ''}
            </span>
          </div>
          {pairs.length > 0 && (
            <ul className="pair-chips" aria-label="Landmarks">
              {pairs.map((p, i) => (
                <li key={i}>
                  <button type="button" className="chip" onClick={() => removePair(i)} aria-label={`Remove landmark ${i + 1}`}>
                    {i + 1}
                    {p.frame ? '' : ' (half)'} ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label htmlFor={ids.date}>
            When was the photo taken? <span className="muted">(optional)</span>
          </label>
          <input id={ids.date} type="date" value={captured} onChange={(e) => setCaptured(e.target.value)} />
        </>
      )}

      {error && (
        <p id={ids.err} className="form__error" role="alert">
          {error}
        </p>
      )}
      {file && size !== 'unreadable' && (
        <button type="submit" className="btn btn-primary" disabled={upload.isPending}>
          {upload.isPending ? 'Uploading…' : 'Use the new photo'}
        </button>
      )}
    </form>
  )
}
