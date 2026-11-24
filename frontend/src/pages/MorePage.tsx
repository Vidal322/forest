import { useMutationState } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { apiDownload } from '../api/client'
import { friendlyError } from '../api/errors'
import { OUTBOX_SCOPE } from '../api/outbox'
import { NAV } from '../app/nav'

/** Phones: everything that isn't a bottom tab, and the export. */
export function MorePage() {
  return (
    <div className="page">
      <h1>More</h1>
      <ul className="menu">
        {NAV.filter((n) => !n.tab).map((n) => (
          <li key={n.to}>
            <Link to={n.to}>
              <span aria-hidden="true">{n.icon}</span> {n.label}
            </Link>
          </li>
        ))}
      </ul>
      <ExportCard />
    </div>
  )
}

const EXPORT_PATH = '/api/export/activities.csv'

/** The whole activity log as a CSV file, for a spreadsheet. */
function ExportCard() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // changes still on this phone aren't on the server yet, so not in the file
  const unsent = useMutationState({ filters: { status: 'pending', predicate: (m) => m.options.scope?.id === OUTBOX_SCOPE.id } }).length

  async function download() {
    setBusy(true)
    setError(null)
    try {
      const { blob, filename } = await apiDownload(EXPORT_PATH, 'text/csv')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename ?? 'forest-activities.csv'
      document.body.append(a)
      a.click()
      a.remove()
      // some browsers read the file after click() returns
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card" aria-labelledby="export-title">
      <h2 id="export-title">Export</h2>
      <p className="muted">Every logged activity — date, type, zones, plots, species, quantity and notes — as a file for a spreadsheet.</p>
      {unsent > 0 && (
        <p className="note">
          {unsent === 1 ? '1 change' : `${unsent} changes`} saved on this phone {unsent === 1 ? 'is' : 'are'} not sent yet, so{' '}
          {unsent === 1 ? 'it' : 'they'} won’t be in the file.
        </p>
      )}
      <button type="button" className="btn btn-primary btn-block" onClick={() => void download()} disabled={busy}>
        <span aria-hidden="true">⬇</span> {busy ? 'Preparing…' : 'Download CSV'}
      </button>
      {error && (
        <p className="note warn" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
