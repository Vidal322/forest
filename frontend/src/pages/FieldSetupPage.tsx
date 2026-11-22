import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { ApiError } from '../api/client'
import { friendlyError } from '../api/errors'
import {
  fieldPhoto,
  formatScale,
  lineLength,
  lineOf,
  useCreateField,
  useField,
  useUpdateField,
  type Field,
  type FieldInput,
} from '../api/field'
import { SAVED_ON_PHONE } from '../api/outbox'
import { Flash } from '../components/Flash'
import { FieldMap } from '../components/FieldMap'
import { useFlash, type FlashState } from '../hooks/useFlash'
import { useOutboxWrite } from '../hooks/useOutboxWrite'
import { CalibrationLine } from '../map/CalibrationLine'
import type { FramePoint } from '../map/frame'

/** Set up the field (name + first photo), then its scale and watering default. */
export function FieldSetupPage() {
  const field = useField()
  const flash = useFlash()
  const offline = field.isPending && field.fetchStatus === 'paused'

  return (
    <div className="page">
      <h1>Field setup</h1>
      <Flash flash={flash} />
      {offline && <p className="note">No connection. Field setup needs signal.</p>}
      {field.isPending && !offline && <p className="muted">Loading…</p>}
      {field.isError && (
        <div className="note warn" role="alert">
          {friendlyError(field.error)}{' '}
          <button type="button" className="btn" onClick={() => void field.refetch()}>
            Try again
          </button>
        </div>
      )}
      {field.data === null && <CreateFieldForm onCreated={() => flash.show('Field created. Now set the scale.')} />}
      {field.data && <FieldSettings field={field.data} flash={flash} />}
    </div>
  )
}

function CreateFieldForm({ onCreated }: { onCreated: () => void }) {
  const create = useCreateField()
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [localError, setLocalError] = useState<{ field: 'name' | 'photo'; text: string } | null>(null)
  const [preview, setPreview] = useFilePreview()
  const ids = { name: useId(), photo: useId(), err: useId(), title: useId() }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (create.isPending) return
    if (!name.trim()) return setLocalError({ field: 'name', text: 'Give the field a name.' })
    if (!file) return setLocalError({ field: 'photo', text: 'Choose the photo of your field.' })
    setLocalError(null)
    create.mutate({ name: name.trim(), photo: file }, { onSuccess: onCreated })
  }

  const error = localError?.text ?? (create.error ? friendlyError(create.error) : '')
  const blamed = localError?.field ?? (create.error instanceof ApiError ? create.error.field : null)
  const errorFor = (f: string) => (error && blamed === f ? ids.err : undefined)

  return (
    <form className="card" onSubmit={submit} noValidate aria-labelledby={ids.title}>
      <h2 id={ids.title}>1 · Your field and its photo</h2>
      <p className="muted">
        A satellite screenshot or a drone photo, cropped to your field. Everything you draw later sits on this
        picture.
      </p>

      <label htmlFor={ids.name}>Field name</label>
      <input
        id={ids.name}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Quinta do Vale"
        maxLength={100}
        aria-invalid={blamed === 'name' || undefined}
        aria-describedby={errorFor('name')}
      />

      <p className="label-like" aria-hidden="true">
        Photo
      </p>
      <label className="photo-pick">
        <input
          id={ids.photo}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null
            setFile(f)
            setPreview(f)
          }}
          aria-invalid={blamed === 'photo' || undefined}
          aria-describedby={errorFor('photo')}
        />
        <span aria-hidden="true">📷</span>
        <span>{file ? `${file.name} — tap to change` : 'Choose the field photo'}</span>
        <span className="muted small">
          {file ? `${(file.size / 1_048_576).toFixed(1)} MB` : 'PNG, JPG or WebP, up to 30 MB'}
        </span>
      </label>
      {preview && <img className="photo-preview" src={preview} alt="Preview of the field you chose" />}

      <p className="note privacy">
        🔒 The server keeps only the pixels: all EXIF / GPS data is removed on upload. Crop out any coordinates,
        place names or addresses shown <em>in</em> the picture before uploading.
      </p>

      {error && (
        <p id={ids.err} className="form__error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary btn-block" disabled={create.isPending}>
        {create.isPending ? 'Uploading…' : 'Create field'}
      </button>
    </form>
  )
}

/** A preview URL for the picked file, revoked when another is picked or the form goes away. */
function useFilePreview() {
  const current = useRef<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const pick = (file: File | null) => {
    if (current.current) URL.revokeObjectURL(current.current)
    current.current = file ? URL.createObjectURL(file) : null
    setUrl(current.current)
  }
  useEffect(
    () => () => {
      if (current.current) URL.revokeObjectURL(current.current)
      current.current = null
    },
    [],
  )
  return [url, pick] as const
}

function inputOf(field: Field): FieldInput {
  return {
    name: field.name,
    calibration_line: field.calibration_line,
    calibration_length_m: field.calibration_length_m,
    default_water_interval_days: field.default_water_interval_days,
  }
}

/** Where the scale line starts: the saved one, or across the middle third of the photo. */
function initialLine(field: Field): [FramePoint, FramePoint] {
  const c = field.calibration_line?.coordinates
  if (c?.[0] && c[1]) return [c[0], c[1]]
  const y = Math.round(field.frame_height / 2)
  return [
    [Math.round(field.frame_width / 3), y],
    [Math.round((field.frame_width * 2) / 3), y],
  ]
}

function FieldSettings({ field, flash }: { field: Field; flash: FlashState }) {
  const photo = fieldPhoto(field)
  return (
    <>
      <ScaleForm field={field} flash={flash} />
      <DetailsForm field={field} flash={flash} />
      <section className="card" aria-labelledby="frame-facts">
        <h2 id="frame-facts">What is stored</h2>
        <dl className="facts">
          <dt>Photo</dt>
          <dd>
            {field.frame_width} × {field.frame_height} pixels
          </dd>
          <dt>Positions</dt>
          <dd>pixels of this photo, from its top-left corner</dd>
          <dt>Scale</dt>
          <dd>{field.metres_per_unit ? formatScale(field.metres_per_unit) : 'not set'}</dd>
          <dt>GPS</dt>
          <dd>never stored</dd>
        </dl>
        <p className="muted small">Nobody can place this field on a real map from the data.</p>
        {photo && (
          <p>
            <Link to="/">Open the map →</Link>
          </p>
        )}
      </section>
    </>
  )
}

/** Save the whole field through the outbox; tells the user when it was kept on the phone. */
function useFieldSave(flash: FlashState, okMessage: string) {
  const update = useUpdateField()
  const state = useOutboxWrite(update)
  const { show, clear } = flash
  useEffect(() => {
    if (state.waiting) show(SAVED_ON_PHONE)
  }, [state.waiting, show])
  const save = (input: FieldInput) => {
    clear()
    update.mutate(input, { onSuccess: () => show(okMessage) })
  }
  return { ...state, save }
}

function parseMetres(text: string): number | null {
  const m = Number(text.trim().replace(',', '.'))
  return text.trim() !== '' && Number.isFinite(m) && m > 0 && m < 100_000 ? m : null
}

function ScaleForm({ field, flash }: { field: Field; flash: FlashState }) {
  const photo = fieldPhoto(field)
  const [line, setLine] = useState<[FramePoint, FramePoint]>(() => initialLine(field))
  // A never-calibrated field starts with a made-up line: it must be placed before saving.
  const [placed, setPlaced] = useState(field.calibration_line !== null)
  const [announced, setAnnounced] = useState(() => lineLength(lineOf(...initialLine(field))))
  const [metres, setMetres] = useState(field.calibration_length_m ? String(field.calibration_length_m) : '')
  const [localError, setLocalError] = useState('')
  const { busy, error: serverError, save } = useFieldSave(flash, 'Scale saved.')
  const ids = { metres: useId(), err: useId(), title: useId() }

  const units = lineLength(lineOf(line[0], line[1]))
  const m = parseMetres(metres)
  const preview = m !== null && units >= 1 ? m / units : null

  const moveTo = (next: [FramePoint, FramePoint]) => {
    setLine(next)
    setPlaced(true)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (!placed) return setLocalError('First move A and B onto the ends of something you know the length of.')
    if (m === null) return setLocalError('Type the real length of the line, in metres.')
    if (units < 1) return setLocalError('Drag the two ends of the line apart.')
    setLocalError('')
    save({ ...inputOf(field), calibration_line: lineOf(line[0], line[1]), calibration_length_m: m })
  }

  const error = localError || (serverError ? friendlyError(serverError) : '')

  return (
    <form className="card" onSubmit={submit} noValidate aria-labelledby={ids.title}>
      <h2 id={ids.title}>2 · Set the scale</h2>
      <p className="muted">
        Drag the handles <b>A</b> and <b>B</b> onto the ends of something whose length you know — a path, a wall, or
        the map’s own scale bar — then type that length. Zoom in for a precise fit.
      </p>
      {photo && (
        <div className="setup-map">
          <FieldMap key={`${photo.width}x${photo.height}`} photo={photo} wheelZoom={false}>
            <CalibrationLine value={line} onChange={moveTo} onDragEnd={() => setAnnounced(units)} />
          </FieldMap>
        </div>
      )}

      <details>
        <summary>Type the positions instead</summary>
        <p className="muted small">In pixels of the photo, from its top-left corner (x to the right, y down).</p>
        <div className="coords">
          {(['A', 'B'] as const).map((name, i) =>
            (['x', 'y'] as const).map((axis, j) => (
              <PointInput
                key={`${name}${axis}`}
                label={`${name} ${axis}`}
                value={line[i]![j]!}
                onChange={(v) => {
                  const p: [number, number] = [line[i]![0], line[i]![1]]
                  p[j] = v
                  const next: [FramePoint, FramePoint] = i === 0 ? [p, line[1]] : [line[0], p]
                  moveTo(next)
                  setAnnounced(lineLength(lineOf(next[0], next[1])))
                }}
              />
            )),
          )}
        </div>
      </details>

      <label htmlFor={ids.metres}>Real length of the line A–B</label>
      <div className="input-row">
        <input
          id={ids.metres}
          inputMode="decimal"
          value={metres}
          onChange={(e) => setMetres(e.target.value)}
          placeholder="100"
          aria-describedby={error ? ids.err : undefined}
          aria-invalid={(Boolean(localError) && m === null) || undefined}
        />
        <span>metres</span>
      </div>
      <p className="muted small">
        Line: {Math.round(units)} px{preview ? ` → ${formatScale(preview)}` : ''}
      </p>
      {/* announced only after a drag ends, not on every movement */}
      <p className="visually-hidden" aria-live="polite">
        Line is {Math.round(announced)} pixels long.
      </p>
      {error && (
        <p id={ids.err} className="form__error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? 'Saving…' : 'Save scale'}
      </button>
    </form>
  )
}

function PointInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const id = useId()
  const [text, setText] = useState(String(value))
  // follow drags made on the map while this box isn't being edited
  const [shown, setShown] = useState(value)
  if (shown !== value) {
    setShown(value)
    setText(String(value))
  }
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          const v = Number(e.target.value.replace(',', '.'))
          if (e.target.value.trim() !== '' && Number.isFinite(v)) {
            setShown(v)
            onChange(v)
          }
        }}
      />
    </div>
  )
}

function DetailsForm({ field, flash }: { field: Field; flash: FlashState }) {
  const [name, setName] = useState(field.name)
  const [days, setDays] = useState(String(field.default_water_interval_days))
  const [localError, setLocalError] = useState<{ field: 'name' | 'days'; text: string } | null>(null)
  const { busy, error: serverError, save } = useFieldSave(flash, 'Field saved.')
  const ids = { name: useId(), days: useId(), err: useId(), title: useId() }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const n = Number(days)
    if (!name.trim()) return setLocalError({ field: 'name', text: 'Give the field a name.' })
    if (!Number.isInteger(n) || n < 1 || n > 365) return setLocalError({ field: 'days', text: 'Water every 1 to 365 days.' })
    setLocalError(null)
    save({ ...inputOf(field), name: name.trim(), default_water_interval_days: n })
  }
  const error = localError?.text ?? (serverError ? friendlyError(serverError) : '')
  const serverField = serverError instanceof ApiError ? serverError.field : null
  const blamed = localError?.field ?? (serverField === 'default_water_interval_days' ? 'days' : serverField)
  const errorFor = (f: string) => (error && blamed === f ? ids.err : undefined)

  return (
    <form className="card" onSubmit={submit} noValidate aria-labelledby={ids.title}>
      <h2 id={ids.title}>Name and watering</h2>
      <label htmlFor={ids.name}>Field name</label>
      <input
        id={ids.name}
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={100}
        aria-invalid={blamed === 'name' || undefined}
        aria-describedby={errorFor('name')}
      />
      <label htmlFor={ids.days}>Zones need water every</label>
      <div className="input-row">
        <input
          id={ids.days}
          type="number"
          inputMode="numeric"
          min={1}
          max={365}
          value={days}
          onChange={(e) => setDays(e.target.value)}
          aria-invalid={blamed === 'days' || undefined}
          aria-describedby={errorFor('days')}
        />
        <span>days</span>
      </div>
      <p className="muted small">
        A zone “needs water” when nothing was watered, sown or planted there for this long. Seasonal rules come
        later.
      </p>
      {error && (
        <p id={ids.err} className="form__error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </form>
  )
}
