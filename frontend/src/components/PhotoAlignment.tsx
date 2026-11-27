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
import { Icon } from './Icon'

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
    setLocalError(f && f.size > MAX_BYTES ? 'A fotografia é grande demais para enviar (máximo 30 MB).' : '')
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
    if (!file) return setLocalError('Escolhe a fotografia nova.')
    if (file.size > MAX_BYTES) return setLocalError('A fotografia é grande demais para enviar (máximo 30 MB).')
    if (tooManyPixels) return setLocalError('A fotografia tem píxeis a mais (máximo 12 000 por lado, 40 megapíxeis). Reduz primeiro o tamanho.')
    if (complete.length < 3) return setLocalError(`Marca pelo menos 3 pontos de referência (para já, ${complete.length}).`)
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
        onDone(`Fotografia nova alinhada. ${fitLabel(p)}. O mapa mostra-a agora por baixo dos teus desenhos.`)
      },
    })
  }

  const error = localError || (upload.error ? friendlyError(upload.error) : '')
  const step =
    waitingFor === 'photo'
      ? `Ponto ${pairs.length + 1}: toca nele na fotografia nova.`
      : `Ponto ${open + 1}: agora toca no mesmo sítio no mapa atual.`

  return (
    <form className="card" onSubmit={submit} noValidate aria-labelledby={ids.head}>
      <h2 id={ids.head}>Fotografia mais recente? Alinha-a</h2>
      <p className="muted small">
        As parcelas e as zonas ficam onde estão. Toca no mesmo ponto de referência (uma pedra, uma curva do caminho, o canto
        de um edifício) primeiro na fotografia nova e depois no mapa atual. Faz isto pelo menos 3 vezes, espalhadas pelo
        terreno. (É preciso apontar nas imagens; não dá para fazer com o teclado.)
      </p>
      <label className="photo-pick">
        <input key={inputKey} id={ids.file} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
        <Icon name="camera" size={28} />
        <span>{file ? `${file.name} (toca para mudar)` : 'Escolher a fotografia mais recente'}</span>
      </label>

      {size === 'unreadable' && (
        <p className="form__error" role="alert">
          Esse ficheiro não é uma fotografia que a aplicação consiga ler. Usa uma imagem PNG, JPG ou WebP.
        </p>
      )}

      {imageSize && current && (
        <>
          <p id={ids.step} className="align-step" aria-live="polite">
            {step}
          </p>
          <fieldset className="row align-switch">
            <legend className="visually-hidden">Mostrar</legend>
            {(['photo', 'frame'] as const).map((v) => (
              <button key={v} type="button" className={`chip${view === v ? ' is-on' : ''}`} aria-pressed={view === v} onClick={() => setView(v)}>
                {v === 'photo' ? 'Fotografia nova' : 'Mapa atual'}
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
                  onTap={(p) => (waitingFor === 'photo' ? tap('photo', p) : setLocalError('Passa para o mapa atual para marcar lá este ponto.'))}
                  onOutside={() => setLocalError('Toca dentro da fotografia.')}
                />
              </FieldMap>
            ) : (
              <FieldMap key="frame" photo={current} wheelZoom={false} doubleTapZoom={false}>
                <PinLayer
                  points={framePoints}
                  openIndex={open}
                  bounds={{ width: current.width, height: current.height }}
                  onTap={(p) => (waitingFor === 'frame' ? tap('frame', p) : setLocalError('Primeiro toca no ponto na fotografia nova.'))}
                  onOutside={() => setLocalError('Toca dentro do mapa.')}
                />
              </FieldMap>
            )}
          </div>
          <div className="row" aria-live="polite">
            <span className="muted">
              {complete.length === 1 ? '1 ponto de referência marcado' : `${complete.length} pontos de referência marcados`}
              {complete.length < 3 ? ' (são precisos pelo menos 3)' : complete.length < 4 ? ' (um 4.º torna-o mais preciso)' : ''}
            </span>
          </div>
          {pairs.length > 0 && (
            <ul className="pair-chips" aria-label="Pontos de referência">
              {pairs.map((p, i) => (
                <li key={i}>
                  <button type="button" className="chip" onClick={() => removePair(i)} aria-label={`Tirar o ponto ${i + 1}`}>
                    {i + 1}
                    {p.frame ? '' : ' (só num)'} <Icon name="close" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label htmlFor={ids.date}>
            Quando foi tirada a fotografia? <span className="muted">(opcional)</span>
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
          {upload.isPending ? 'A enviar…' : 'Usar a fotografia nova'}
        </button>
      )}
    </form>
  )
}
