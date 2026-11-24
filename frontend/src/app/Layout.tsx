import { useIsRestoring } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { Link, matchPath, NavLink, Outlet, useLocation } from 'react-router'
import { ServerStatus } from '../components/ServerStatus'
import { SyncStatus } from '../components/SyncStatus'
import { NAV } from './nav'

/** Top bar (all links on wide screens) + bottom tabs on phones, around the current page. */
export function Layout() {
  const tabs = NAV.filter((n) => n.tab)
  const restoring = useIsRestoring()
  const { pathname } = useLocation()
  const main = useRef<HTMLElement>(null)
  // <main> is the scroller and outlives page changes: start every page at the top.
  useEffect(() => {
    main.current?.scrollTo?.(0, 0)
  }, [pathname])
  // Pages without a tab of their own (Species, …) are reached through More: keep it lit there.
  const underMore = !tabs.some((t) => matchPath({ path: t.to, end: t.to === '/' }, pathname))
  return (
    <>
      <header className="topbar">
        <Link to="/" className="topbar__brand">
          <span aria-hidden="true">🌳</span> Forest
        </Link>
        <nav className="topnav" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className="topnav__link">
              {n.label}
            </NavLink>
          ))}
          {/* the export (and anything else only on More) must be reachable on desktop too */}
          <NavLink to="/more" className="topnav__link">
            More
          </NavLink>
        </nav>
        <span className="spacer" />
        <ServerStatus />
      </header>
      <SyncStatus />
      <main className="main" ref={main}>
        {/* saved data and queued changes come back first: no screen runs before (no write can jump the queue) */}
        {restoring ? <p className="page muted">Opening…</p> : <Outlet />}
      </main>
      <nav className="tabs" aria-label="Main">
        {tabs.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'}>
            <span className="tabs__icon" aria-hidden="true">
              {n.icon}
            </span>
            {n.label}
          </NavLink>
        ))}
        {/* a plain Link: NavLink would only mark /more itself as current */}
        <Link to="/more" className={underMore ? 'active' : undefined} aria-current={underMore ? 'page' : undefined}>
          <span className="tabs__icon" aria-hidden="true">
            ☰
          </span>
          More
        </Link>
      </nav>
    </>
  )
}
