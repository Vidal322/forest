import { useRouteError } from 'react-router'

/** Shown when a page crashes: calm words and a way out, never a stack trace. */
export function ErrorPage() {
  const error = useRouteError()
  console.error(error)
  return (
    <div className="page">
      <h1>Algo correu mal</h1>
      <p>Este ecrã teve um problema inesperado. O que já guardaste está a salvo.</p>
      <div className="row">
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          Recarregar
        </button>
        <a className="btn" href="/">
          Voltar ao mapa
        </a>
      </div>
    </div>
  )
}
