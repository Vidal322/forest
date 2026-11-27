import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <div className="page">
      <h1>Página não encontrada</h1>
      <p>
        <Link className="link-tap" to="/">Voltar ao mapa</Link>
      </p>
    </div>
  )
}
