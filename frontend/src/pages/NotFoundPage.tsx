import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <div className="page">
      <h1>Page not found</h1>
      <p>
        <Link to="/">Back to the map</Link>
      </p>
    </div>
  )
}
