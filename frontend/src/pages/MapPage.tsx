import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { friendlyError } from '../api/errors'
import { fieldPhoto, useField } from '../api/field'
import { plots as plotsApi, useZonesAsOf, withStateOf, zones as zonesApi } from '../api/plots'
import { tasks as tasksApi } from '../api/tasks'
import { useDeviceSetting } from '../app/device'
import { AsOfBanner, AsOfControl } from '../components/AsOf'
import { FieldMap } from '../components/FieldMap'
import { DrawMenu } from '../components/DrawMenu'
import { Legend } from '../components/Legend'
import { NeedsAttention } from '../components/NeedsAttention'
import { ShapeEditor } from '../components/ShapeEditor'
import { TaskSheet } from '../components/TaskSheet'
import { ZoneList } from '../components/ZoneList'
import { ZoneSheet } from '../components/ZoneSheet'
import { attention, attentionLabel } from '../domain/attention'
import { useDebounced } from '../hooks/useDebounced'
import { useFieldToday } from '../hooks/useFieldToday'
import { checkDraft, editDraft, withCorners, type Draft } from '../map/draft'
import { DrawLayer } from '../map/DrawLayer'
import { FieldLayers } from '../map/FieldLayers'
import { LAYER_LABEL, parseLayers, type MapLayers } from '../map/layers'
import { TaskPins } from '../map/TaskPins'
import { taskSpots } from '../map/taskSpots'
import { Icon } from '../components/Icon'

export function MapPage() {
  const field = useField()
  const plots = plotsApi.useList()
  const zones = zonesApi.useList()
  const tasks = tasksApi.useList()
  const [layers, setLayers] = useDeviceSetting<MapLayers>('map.layers', parseLayers)
  // the task pin whose sheet is open: "zone:<id>" or "plot:<id>"
  const [taskAt, setTaskAt] = useState<string | null>(null)
  // ?zone=<id> opens a zone's sheet, ?edit=<id> its outline editor (links from the zone page)
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const [selectedId, setSelectedId] = useState<string | null>(() => params.get('zone'))
  // a zone opened from a list or a link is centred on the map; a tapped one is already in sight
  const [centreSelected, setCentreSelected] = useState(true)
  const [panel, setPanel] = useState<'zones' | 'layers' | 'attention' | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null)
  const photo = field.data ? fieldPhoto(field.data) : null
  const today = useFieldToday()
  // "show state as of": a past day whose colours the map shows (null = today)
  const [asOf, setAsOf] = useState<string | null>(null)
  const viewing = asOf !== null && asOf < today ? asOf : null
  const past = useZonesAsOf(useDebounced(viewing, 250)) // not one request per step of a dragged slider
  const pastExact = viewing !== null && past.data?.day === viewing
  const pastFailed =
    viewing !== null && !pastExact && (past.isError || past.fetchStatus === 'paused')
      ? past.isError
        ? friendlyError(past.error)
        : 'Sem rede: até haver, o mapa mostra hoje.'
      : null
  // while the next day loads, the last one stays; if it can't load, today's colours (the banner says so)
  const pastState = viewing !== null && !pastFailed ? (past.data ?? null) : null
  const mapZones = zones.data && pastState ? withStateOf(zones.data, pastState.zones) : zones.data
  const statusDay = pastState?.day ?? today

  const editId = params.get('edit')
  const [handledEdit, setHandledEdit] = useState<string | null>(null)
  if (editId && editId !== handledEdit && zones.data) {
    // adjusting state during render (React's pattern for reacting to a changed input)
    setHandledEdit(editId)
    const z = zones.data.find((x) => x.id === editId)
    if (z) setDraft(editDraft('zone', z))
  }
  useEffect(() => {
    if (editId && handledEdit === editId) setParams({}, { replace: true })
  }, [editId, handledEdit, setParams])

  // short confirmations ("Parcela 1 acrescentada.") fade after a few seconds
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const startDraft = (d: Draft) => {
    setAsOf(null) // drawing is about the field now
    setMenuOpen(false)
    setPanel(null)
    setSelectedId(null)
    setTaskAt(null)
    setDraft(d)
  }
  const finishDraft = useCallback((message: string, selectZoneId?: string) => {
    setDraft(null)
    setToast((t) => ({ text: message, n: (t?.n ?? 0) + 1 }))
    if (selectZoneId) {
      setCentreSelected(false)
      setSelectedId(selectZoneId)
    }
  }, [])

  const select = useCallback((z: { id: string }, centre = false) => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setTaskAt(null)
    setCentreSelected(centre)
    setSelectedId(z.id)
  }, [])
  const tapZone = useCallback((z: { id: string }) => select(z), [select])
  const dropZone = useCallback(() => {
    setSelectedId(null)
    // a closed sheet must not come back on reload or Back
    setParams((p) => {
      if (!p.has('zone')) return p
      const next = new URLSearchParams(p)
      next.delete('zone')
      return next
    }, { replace: true })
  }, [setParams])
  const closeSheet = useCallback(() => {
    dropZone()
    const back = returnFocus.current
    if (back?.isConnected) requestAnimationFrame(() => back.focus())
  }, [dropZone])
  const pickTasks = useCallback(
    (spot: { key: string }) => {
      // a pin tapped while a zone's sheet is open: focus goes back where it was before that sheet
      if (!selectedId) returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      dropZone()
      setPanel(null)
      setTaskAt(spot.key)
    },
    [selectedId, dropZone],
  )
  const closeTasks = useCallback(() => {
    setTaskAt(null)
    const back = returnFocus.current
    if (back?.isConnected) requestAnimationFrame(() => back.focus())
  }, [])
  const tapBackground = useCallback(() => {
    if (taskAt) closeTasks()
    else closeSheet()
  }, [taskAt, closeTasks, closeSheet])

  if (photo) {
    const selected = mapZones?.find((z) => z.id === selectedId)
    const empty = plots.data?.length === 0
    const failed = (plots.isError && !plots.data) || (zones.isError && !zones.data)
    const needs = zones.data?.length ? attention(zones.data, today) : null
    // while drawing, every outline is shown (to see what the new one may overlap) and no pins (taps place corners)
    const show: MapLayers = draft ? { plots: true, zones: true, tasks: false } : layers
    const spots = show.tasks ? taskSpots(tasks.data ?? [], plots.data ?? [], zones.data ?? []) : []
    const hidden = (Object.keys(layers) as (keyof MapLayers)[]).filter((k) => !layers[k]).length
    const sheetOpen = Boolean(selected) || taskAt !== null
    return (
      <div className="fieldmap-page">
        <h1 className="visually-hidden">Mapa do terreno</h1>
        <FieldMap key={`${photo.width}x${photo.height}`} photo={photo}>
          <FieldLayers
            plots={show.plots ? (plots.data ?? []).filter((p) => !(draft?.kind === 'plot' && p.id === draft.id)) : []}
            // with zones switched off, the one whose sheet is open still shows
            zones={(mapZones ?? []).filter(
              (z) => !(draft?.kind === 'zone' && z.id === draft.id) && (show.zones || z.id === selectedId),
            )}
            today={statusDay}
            selectedId={draft ? null : selectedId}
            centreSelected={centreSelected}
            onSelectZone={draft ? undefined : tapZone}
            onSelectPlot={draft ? undefined : (p) => navigate(`/plots/${p.id}`)}
            onBackgroundClick={draft ? undefined : tapBackground}
            interactive={!draft}
          />
          {spots.length > 0 && <TaskPins spots={spots} selectedKey={taskAt} onPick={pickTasks} />}
          {draft && (
            <DrawLayer
              corners={draft.corners}
              readOnly={draft.step === 'details'}
              valid={checkDraft(draft, plots.data ?? [], zones.data ?? []).ok || draft.corners.length < 3}
              liveValid={(c) => c.length < 3 || checkDraft({ ...draft, corners: c }, plots.data ?? [], zones.data ?? []).ok}
              selected={draft.selectedCorner}
              onSelect={(i) => setDraft({ ...draft, selectedCorner: i })}
              onChange={(corners) => setDraft(withCorners(draft, corners))}
            />
          )}
        </FieldMap>
        {!draft && (
        <div className="map-overlay map-overlay--bottom-left">
          <div className="row">
            {/* what is shown and what the colours mean, in one panel: two buttons stay clear of “Desenhar” on a phone */}
            <button
              type="button"
              className="map-btn"
              aria-expanded={panel === 'layers'}
              aria-controls="map-layers"
              aria-label={hidden > 0 ? `Camadas, ${hidden} ${hidden === 1 ? 'escondida' : 'escondidas'}` : undefined}
              onClick={() => setPanel((p) => (p === 'layers' ? null : 'layers'))}
            >
              Camadas
              {hidden > 0 && <span className="map-btn__dot" aria-hidden="true" />}
            </button>
            <button
              type="button"
              className="map-btn"
              aria-expanded={panel === 'zones'}
              aria-controls="map-zone-list"
              onClick={() => setPanel((p) => (p === 'zones' ? null : 'zones'))}
            >
              Zonas
            </button>
          </div>
          {panel === 'layers' && (
            <div id="map-layers" className="map-panel map-panel--scroll">
              <fieldset className="layers">
                <legend>Mostrar no mapa</legend>
                {(Object.keys(LAYER_LABEL) as (keyof MapLayers)[]).map((k) => (
                  <label key={k} className="layers__opt">
                    <input
                      type="checkbox"
                      checked={layers[k]}
                      onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })}
                    />
                    {LAYER_LABEL[k]}
                  </label>
                ))}
              </fieldset>
              <AsOfControl asOf={viewing} today={today} onChange={setAsOf} />
              <h3 className="layers__key">Legenda</h3>
              <Legend />
            </div>
          )}
          {panel === 'zones' && (
            <div className="map-panel map-panel--scroll">
              <ZoneList
                id="map-zone-list"
                plots={plots.data ?? []}
                zones={zones.data ?? []}
                today={today}
                onPick={(z) => {
                  setPanel(null)
                  select(z, true)
                }}
              />
            </div>
          )}
        </div>
        )}
        {/* a past day replaces "needs attention" (which is about today): which day, and the way back */}
        {viewing && !draft && (
          <div className="map-overlay map-overlay--attention">
            <AsOfBanner
              asOf={viewing}
              today={today}
              loading={!pastExact}
              failed={pastFailed}
              onToday={() => setAsOf(null)}
            />
          </div>
        )}
        {/* not over the zone's sheet (its list would run under it), nor over the error note */}
        {!viewing && !draft && !sheetOpen && !failed && needs && (
          <div className="map-overlay map-overlay--attention">
            <button
              type="button"
              className={`map-btn${needs.total > 0 ? ' map-btn--attention' : ''}`}
              aria-expanded={panel === 'attention'}
              aria-controls="map-attention"
              onClick={() => setPanel((p) => (p === 'attention' ? null : 'attention'))}
            >
              {attentionLabel(needs.total)}
              <Icon className="map-btn__chevron" name={panel === 'attention' ? 'up' : 'down'} size={18} />
            </button>
            {panel === 'attention' && (
              <div className="map-panel map-panel--scroll">
                <NeedsAttention
                  id="map-attention"
                  plots={plots.data ?? []}
                  summary={needs}
                  today={today}
                  onPick={(z) => {
                    setPanel(null)
                    select(z, true)
                  }}
                />
              </div>
            )}
          </div>
        )}
        {failed && (
          <div className="map-overlay map-overlay--top note warn" role="alert">
            {friendlyError(plots.error ?? zones.error)}{' '}
            <button
              type="button"
              className="btn"
              onClick={() => {
                void plots.refetch()
                void zones.refetch()
              }}
            >
              Tentar outra vez
            </button>
          </div>
        )}
        {empty && !sheetOpen && !draft && (
          <p className="map-overlay map-overlay--top note">Ainda não há parcelas. Toca em “Desenhar” para marcar a primeira.</p>
        )}
        {/* always present, so screen readers hear each new message */}
        <output className="map-overlay map-overlay--toast map-toast-region" aria-live="polite">
          {toast && (
            <span key={toast.n} className="map-toast">
              {toast.text}
            </span>
          )}
        </output>
        {selected && !draft && (
          <ZoneSheet
            zone={selected}
            plot={plots.data?.find((p) => p.id === selected.plot_id)}
            today={statusDay}
            asOf={pastState ? statusDay : undefined}
            onClose={closeSheet}
          >
            {/* looking back: logging and editing still act on today, so they say so */}
            {pastState && <p className="muted">O que registares ou editares fica com o dia de hoje.</p>}
            <div className="row form__actions">
              <Link className="btn btn-primary" to={`/log?zone=${selected.id}`}>
                <Icon name="add" /> {pastState ? 'Registar hoje' : 'Registar'}
              </Link>
              <Link className="btn" to={`/zones/${selected.id}`}>
                Histórico e tarefas
              </Link>
              <button type="button" className="btn" onClick={() => startDraft(editDraft('zone', selected))}>
                <Icon name="edit" /> {pastState ? 'Editar a zona hoje' : 'Editar a zona'}
              </button>
            </div>
          </ZoneSheet>
        )}
        {taskAt && !selected && !draft && (
          <TaskSheet
            // ticked tasks stay listed until the sheet closes or another pin is tapped
            key={taskAt}
            at={taskAt}
            tasks={tasks.data ?? []}
            plots={plots.data ?? []}
            zones={zones.data ?? []}
            today={today}
            onClose={closeTasks}
          />
        )}
        {draft && (
          <ShapeEditor
            draft={draft}
            setDraft={setDraft}
            plots={plots.data ?? []}
            zones={zones.data ?? []}
            metresPerUnit={field.data?.metres_per_unit ?? null}
            onDone={finishDraft}
          />
        )}
        {!draft && !sheetOpen && !menuOpen && (
          <button type="button" className="fab" onClick={() => setMenuOpen(true)}>
            <Icon name="add" /> Desenhar
          </button>
        )}
        {menuOpen && (
          <DrawMenu
            plots={plots.data ?? []}
            onPick={startDraft}
            onClose={() => setMenuOpen(false)}
          />
        )}
      </div>
    )
  }
  return (
    <div className="page">
      <h1 className="visually-hidden">Mapa do terreno</h1>
      {field.isPending && field.fetchStatus === 'paused' && (
        <p className="note">Sem rede. O mapa aparece assim que houver rede.</p>
      )}
      {field.isPending && field.fetchStatus !== 'paused' && <p className="muted">A carregar o mapa…</p>}
      {field.isError && (
        <div className="note warn" role="alert">
          {friendlyError(field.error)}{' '}
          <button type="button" className="btn" onClick={() => void field.refetch()}>
            Tentar outra vez
          </button>
        </div>
      )}
      {field.data && !photo && (
        <p className="note">
          O terreno não tem fotografia. <Link to="/field">Abrir Configurar o terreno</Link>
        </p>
      )}
      {field.data === null && (
        <div className="welcome card">
          <h2>Bem-vindo ao Forest</h2>
          <p>Começa por acrescentar uma fotografia do teu terreno. Tudo o que plantas, semeias e regas fica desenhado nela.</p>
          <Link className="btn btn-primary" to="/field">
            Configurar o teu terreno
          </Link>
        </div>
      )}
    </div>
  )
}
