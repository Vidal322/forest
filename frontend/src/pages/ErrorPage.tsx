import { useRouteError } from 'react-router'

/** Shown when a page crashes: calm words and a way out, never a stack trace. */
export function ErrorPage() {
  const error = useRouteError()
  console.error(error)
  return (
    <div className="page">
      <h1>Something went wrong</h1>
      <p>This screen hit an unexpected problem. Your saved entries are safe.</p>
      <div className="row">
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          Reload
        </button>
        <a className="btn" href="/">
          Back to the map
        </a>
      </div>
    </div>
  )
}
