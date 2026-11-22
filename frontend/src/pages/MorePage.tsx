import { Link } from 'react-router'
import { NAV } from '../app/nav'

/** Phones: everything that isn't a bottom tab. */
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
    </div>
  )
}
