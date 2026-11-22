import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { friendlyError } from '../api/errors'
import { fieldPhoto, useField } from '../api/field'
import { plots as plotsApi, zones as zonesApi } from '../api/plots'
import { FieldMap } from '../components/FieldMap'
import { DrawMenu } from '../components/DrawMenu'
import { Legend } from '../components/Legend'
import { ShapeEditor } from '../components/ShapeEditor'
import { ZoneList } from '../components/ZoneList'
import { ZoneSheet } from '../components/ZoneSheet'
import { useFieldToday } from '../hooks/useFieldToday'
import { checkDraft, editDraft, withCorners, type Draft } from '../map/draft'
import { DrawLayer } from '../map/DrawLayer'
import { FieldLayers } from '../map/FieldLayers'

export function MapPage() {
  const field = useField()
  const plots = plotsApi.useList()
  const zones = zonesApi.useList()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [panel, setPanel] = useState<'legend' | 'zones' | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null)
  const photo = field.data ? fieldPhoto(field.data) : null
  const today = useFieldToday()

  // short confirmations ("Added Plot 1.") fade after a few seconds
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const startDraft = (d: Draft) => {
    setMenuOpen(false)
    setPanel(null)
    setSelectedId(null)
    setDraft(d)
  }
  const finishDraft = useCallback((message: string, selectZoneId?: string) => {
    setDraft(null)
    setToast((t) => ({ text: message, n: (t?.n ?? 0) + 1 }))
    if (selectZoneId) setSelectedId(selectZoneId)
  }, [])

  const select = useCallback((z: { id: string }) => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setSelectedId(z.id)
  }, [])
  const closeSheet = useCallback(() => {
    setSelectedId(null)
    const back = returnFocus.current
    if (back?.isConnected) requestAnimationFrame(() => back.focus())
  }, [])

  if (photo) {
    const selected = zones.data?.find((z) => z.id === selectedId)
    const empty = plots.data?.length === 0
    const failed = (plots.isError && !plots.data) || (zones.isError && !zones.data)
    return (
      <div className="fieldmap-page">
        <h1 className="visually-hidden">Field map</h1>
        <FieldMap key={`${photo.width}x${photo.height}`} photo={photo}>
          <FieldLayers
            plots={(plots.data ?? []).filter((p) => !(draft?.kind === 'plot' && p.id === draft.id))}
            zones={(zones.data ?? []).filter((z) => !(draft?.kind === 'zone' && z.id === draft.id))}
            today={today}
            selectedId={draft ? null : selectedId}
            onSelectZone={draft ? undefined : select}
            onBackgroundClick={draft ? undefined : closeSheet}
            interactive={!draft}
          />
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
            <button
              type="button"
              className="map-btn"
              aria-expanded={panel === 'legend'}
              aria-controls="map-legend"
              onClick={() => setPanel((p) => (p === 'legend' ? null : 'legend'))}
            >
              Legend
            </button>
            <button
              type="button"
              className="map-btn"
              aria-expanded={panel === 'zones'}
              aria-controls="map-zone-list"
              onClick={() => setPanel((p) => (p === 'zones' ? null : 'zones'))}
            >
              Zones
            </button>
          </div>
          {panel === 'legend' && (
            <div className="map-panel">
              <Legend id="map-legend" />
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
                  select(z)
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
              Try again
            </button>
          </div>
        )}
        {empty && !selected && !draft && (
          <p className="map-overlay map-overlay--top note">No plots yet. Tap “＋ Draw” to outline your first plot.</p>
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
            today={today}
            onClose={closeSheet}
          >
            <div className="row form__actions">
              <button type="button" className="btn" onClick={() => startDraft(editDraft('zone', selected))}>
                ✎ Edit zone
              </button>
            </div>
          </ZoneSheet>
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
        {!draft && !selected && !menuOpen && (
          <button type="button" className="fab" onClick={() => setMenuOpen(true)}>
            ＋ Draw
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
      <h1 className="visually-hidden">Field map</h1>
      {field.isPending && field.fetchStatus === 'paused' && (
        <p className="note">No connection. The map will appear as soon as there is signal.</p>
      )}
      {field.isPending && field.fetchStatus !== 'paused' && <p className="muted">Loading the map…</p>}
      {field.isError && (
        <div className="note warn" role="alert">
          {friendlyError(field.error)}{' '}
          <button type="button" className="btn" onClick={() => void field.refetch()}>
            Try again
          </button>
        </div>
      )}
      {field.data && !photo && (
        <p className="note">
          The field has no photo. <Link to="/field">Open field setup</Link>
        </p>
      )}
      {field.data === null && (
        <div className="welcome card">
          <p style={{ fontSize: '2.5rem', margin: 0 }} aria-hidden="true">
            🌳
          </p>
          <h2>Welcome to Forest</h2>
          <p>Start by adding a photo of your field. Everything you plant, sow and water is drawn on it.</p>
          <Link className="btn btn-primary" to="/field">
            Set up your field
          </Link>
        </div>
      )}
    </div>
  )
}
