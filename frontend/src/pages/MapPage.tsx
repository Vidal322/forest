import { Link } from 'react-router'
import { friendlyError } from '../api/errors'
import { fieldPhoto, useField } from '../api/field'
import { FieldMap } from '../components/FieldMap'

export function MapPage() {
  const field = useField()
  const photo = field.data ? fieldPhoto(field.data) : null

  if (photo) {
    return (
      <div className="fieldmap-page">
        <h1 className="visually-hidden">Field map</h1>
        <FieldMap key={`${photo.width}x${photo.height}`} photo={photo} />
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
