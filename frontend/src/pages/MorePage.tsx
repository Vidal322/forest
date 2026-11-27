import { useMutationState } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { apiDownload } from '../api/client'
import { friendlyError } from '../api/errors'
import { OUTBOX_SCOPE } from '../api/outbox'
import { NAV } from '../app/nav'
import { Icon } from '../components/Icon'

/** Everything that isn't a bottom tab on phones, and the export (also in the top bar on wide screens). */
export function MorePage() {
  return (
    <div className="page">
      <h1>Mais</h1>
      <ul className="menu">
        {NAV.filter((n) => !n.tab).map((n) => (
          <li key={n.to}>
            <Link to={n.to}>
              <Icon name={n.icon} /> {n.label}
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
      a.download = filename ?? 'forest-atividades.csv'
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
      <h2 id="export-title">Exportar</h2>
      <p className="muted">Tudo o que registaste (dia, tipo, zonas, parcelas, espécies, quantidade e notas) num ficheiro para uma folha de cálculo.</p>
      {unsent > 0 && (
        <p className="note">
          {unsent === 1
            ? '1 alteração guardada neste telemóvel ainda não foi enviada, por isso não vai estar no ficheiro.'
            : `${unsent} alterações guardadas neste telemóvel ainda não foram enviadas, por isso não vão estar no ficheiro.`}
        </p>
      )}
      <button type="button" className="btn btn-primary btn-block" onClick={() => void download()} disabled={busy}>
        <Icon name="download" /> {busy ? 'A preparar…' : 'Descarregar CSV'}
      </button>
      {error && (
        <p className="note warn" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
