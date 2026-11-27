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
import { formatNumber } from '../domain/numbers'
import { FieldMap } from '../components/FieldMap'
import { useFlash, type FlashState } from '../hooks/useFlash'
import { PhotoAlignment } from '../components/PhotoAlignment'
import { PhotoHistory } from '../components/PhotoHistory'
import { WateringRules } from '../components/WateringRules'
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
      <h1>Configurar o terreno</h1>
      <Flash flash={flash} />
      {offline && <p className="note">Sem rede. Para configurar o terreno é preciso rede.</p>}
      {field.isPending && !offline && <p className="muted">A carregar…</p>}
      {field.isError && (
        <div className="note warn" role="alert">
          {friendlyError(field.error)}{' '}
          <button type="button" className="btn" onClick={() => void field.refetch()}>
            Tentar outra vez
          </button>
        </div>
      )}
      {field.data === null && <CreateFieldForm onCreated={() => flash.show('Terreno criado. Agora marca a escala.')} />}
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
    if (!name.trim()) return setLocalError({ field: 'name', text: 'Dá um nome ao terreno.' })
    if (!file) return setLocalError({ field: 'photo', text: 'Escolhe a fotografia do teu terreno.' })
    setLocalError(null)
    create.mutate({ name: name.trim(), photo: file }, { onSuccess: onCreated })
  }

  const error = localError?.text ?? (create.error ? friendlyError(create.error) : '')
  const blamed = localError?.field ?? (create.error instanceof ApiError ? create.error.field : null)
  const errorFor = (f: string) => (error && blamed === f ? ids.err : undefined)

  return (
    <form className="card" onSubmit={submit} noValidate aria-labelledby={ids.title}>
      <h2 id={ids.title}>1 · O teu terreno e a fotografia</h2>
      <p className="muted">
        Uma captura de ecrã de satélite ou uma fotografia de drone, cortada à volta do teu terreno. Tudo o que
        desenhares depois fica por cima desta imagem.
      </p>

      <label htmlFor={ids.name}>Nome do terreno</label>
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
        Fotografia
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
        <span>{file ? `${file.name} (toca para mudar)` : 'Escolher a fotografia do terreno'}</span>
        <span className="muted small">
          {file ? `${formatNumber(Math.round((file.size / 1_048_576) * 10) / 10)} MB` : 'PNG, JPG ou WebP, até 30 MB'}
        </span>
      </label>
      {preview && <img className="photo-preview" src={preview} alt="Pré-visualização do terreno que escolheste" />}

      <p className="note privacy">
        🔒 O servidor guarda só os píxeis: todos os dados EXIF e de GPS são apagados no envio. Antes de enviares, corta
        as coordenadas, nomes de sítios ou moradas que apareçam <em>dentro</em> da imagem.
      </p>

      {error && (
        <p id={ids.err} className="form__error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary btn-block" disabled={create.isPending}>
        {create.isPending ? 'A enviar…' : 'Criar o terreno'}
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
      <WateringRules defaultDays={field.default_water_interval_days} onMessage={flash.show} />
      <PhotoAlignment field={field} onDone={flash.show} />
      <PhotoHistory onMessage={flash.show} />
      <section className="card" aria-labelledby="frame-facts">
        <h2 id="frame-facts">O que fica guardado</h2>
        <dl className="facts">
          <dt>Fotografia</dt>
          <dd>
            {field.frame_width} × {field.frame_height} píxeis
          </dd>
          <dt>Posições</dt>
          <dd>píxeis desta fotografia, a contar do canto superior esquerdo</dd>
          <dt>Escala</dt>
          <dd>{field.metres_per_unit ? formatScale(field.metres_per_unit) : 'por marcar'}</dd>
          <dt>GPS</dt>
          <dd>nunca é guardado</dd>
        </dl>
        <p className="muted small">Com estes dados, ninguém consegue pôr este terreno num mapa real.</p>
        {photo && (
          <p>
            <Link to="/">Abrir o mapa →</Link>
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
  const photo = fieldPhoto(field, 'original')
  const [line, setLine] = useState<[FramePoint, FramePoint]>(() => initialLine(field))
  // A never-calibrated field starts with a made-up line: it must be placed before saving.
  const [placed, setPlaced] = useState(field.calibration_line !== null)
  const [announced, setAnnounced] = useState(() => lineLength(lineOf(...initialLine(field))))
  const [metres, setMetres] = useState(field.calibration_length_m ? String(field.calibration_length_m).replace('.', ',') : '')
  const [localError, setLocalError] = useState('')
  const { busy, error: serverError, save } = useFieldSave(flash, 'Escala guardada.')
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
    if (!placed) return setLocalError('Primeiro põe A e B nas pontas de uma coisa cujo comprimento conheças.')
    if (m === null) return setLocalError('Escreve o comprimento real da linha, em metros.')
    if (units < 1) return setLocalError('Afasta as duas pontas da linha.')
    setLocalError('')
    save({ ...inputOf(field), calibration_line: lineOf(line[0], line[1]), calibration_length_m: m })
  }

  const error = localError || (serverError ? friendlyError(serverError) : '')

  return (
    <form className="card" onSubmit={submit} noValidate aria-labelledby={ids.title}>
      <h2 id={ids.title}>2 · Marcar a escala</h2>
      <p className="muted">
        Arrasta as pegas <b>A</b> e <b>B</b> para as pontas de uma coisa cujo comprimento conheças (um caminho, um muro
        ou a própria barra de escala do mapa) e depois escreve esse comprimento. Aproxima o mapa para acertar bem.
      </p>
      {photo && (
        <div className="setup-map">
          <FieldMap key={`${photo.width}x${photo.height}`} photo={photo} wheelZoom={false}>
            <CalibrationLine value={line} onChange={moveTo} onDragEnd={() => setAnnounced(units)} />
          </FieldMap>
        </div>
      )}

      <details>
        <summary>Escrever as posições à mão</summary>
        <p className="muted small">Em píxeis da fotografia, a contar do canto superior esquerdo (x para a direita, y para baixo).</p>
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

      <label htmlFor={ids.metres}>Comprimento real da linha A–B</label>
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
        <span>metros</span>
      </div>
      <p className="muted small">
        Linha: {Math.round(units)} px{preview ? ` → ${formatScale(preview)}` : ''}
      </p>
      {/* announced only after a drag ends, not on every movement */}
      <p className="visually-hidden" aria-live="polite">
        A linha tem {Math.round(announced)} píxeis.
      </p>
      {error && (
        <p id={ids.err} className="form__error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? 'A guardar…' : 'Guardar a escala'}
      </button>
    </form>
  )
}

function PointInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const id = useId()
  const [text, setText] = useState(String(value).replace('.', ','))
  // follow drags made on the map while this box isn't being edited
  const [shown, setShown] = useState(value)
  if (shown !== value) {
    setShown(value)
    setText(String(value).replace('.', ','))
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
  const { busy, error: serverError, save } = useFieldSave(flash, 'Terreno guardado.')
  const ids = { name: useId(), days: useId(), err: useId(), title: useId() }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const n = Number(days)
    if (!name.trim()) return setLocalError({ field: 'name', text: 'Dá um nome ao terreno.' })
    if (!Number.isInteger(n) || n < 1 || n > 365) return setLocalError({ field: 'days', text: 'A rega é de 1 em 1 dia até de 365 em 365 dias.' })
    setLocalError(null)
    save({ ...inputOf(field), name: name.trim(), default_water_interval_days: n })
  }
  const error = localError?.text ?? (serverError ? friendlyError(serverError) : '')
  const serverField = serverError instanceof ApiError ? serverError.field : null
  const blamed = localError?.field ?? (serverField === 'default_water_interval_days' ? 'days' : serverField)
  const errorFor = (f: string) => (error && blamed === f ? ids.err : undefined)

  return (
    <form className="card" onSubmit={submit} noValidate aria-labelledby={ids.title}>
      <h2 id={ids.title}>Nome e rega</h2>
      <label htmlFor={ids.name}>Nome do terreno</label>
      <input
        id={ids.name}
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={100}
        aria-invalid={blamed === 'name' || undefined}
        aria-describedby={errorFor('name')}
      />
      <label htmlFor={ids.days}>As zonas precisam de rega de quantos em quantos dias</label>
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
        <span>dias</span>
      </div>
      <p className="muted small">
        Uma zona fica “por regar” quando ninguém a regou, semeou ou plantou durante este tempo, a não ser que uma
        estação abaixo diga outra coisa.
      </p>
      {error && (
        <p id={ids.err} className="form__error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? 'A guardar…' : 'Guardar'}
      </button>
    </form>
  )
}
