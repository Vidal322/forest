import { useIsRestoring } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { Link, matchPath, NavLink, Outlet, useLocation } from 'react-router'
import { isLate, tasks as taskEntity } from '../api/tasks'
import { Icon } from '../components/Icon'
import { ServerStatus } from '../components/ServerStatus'
import { SyncStatus } from '../components/SyncStatus'
import { useFieldToday } from '../hooks/useFieldToday'
import { NAV, type NavItem } from './nav'

/** Top bar (all links on wide screens) + bottom tabs on phones, around the current page. */
export function Layout() {
  const tabs = NAV.filter((n) => n.tab)
  const restoring = useIsRestoring()
  const { pathname } = useLocation()
  const main = useRef<HTMLElement>(null)
  const late = useLateCount()
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
          Forest
        </Link>
        <nav className="topnav" aria-label="Principal">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className="topnav__link">
              {n.short ?? n.label}
              <Late item={n} late={late} short />
            </NavLink>
          ))}
          {/* the export (and anything else only on More) must be reachable on desktop too */}
          <NavLink to="/more" className="topnav__link">
            Mais
          </NavLink>
        </nav>
        <span className="spacer" />
        <ServerStatus />
      </header>
      <SyncStatus />
      <main className="main" ref={main}>
        {/* saved data and queued changes come back first: no screen runs before (no write can jump the queue) */}
        {restoring ? <p className="page muted">A abrir…</p> : <Outlet />}
      </main>
      <nav className="tabs" aria-label="Principal">
        {tabs.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'}>
            <Icon name={n.icon} size={22} />
            <span className="tabs__label">{n.label}</span>
            <Late item={n} late={late} />
          </NavLink>
        ))}
        {/* a plain Link: NavLink would only mark /more itself as current */}
        <Link to="/more" className={underMore ? 'active' : undefined} aria-current={underMore ? 'page' : undefined}>
          <Icon name="more" size={22} />
          <span className="tabs__label">Mais</span>
        </Link>
      </nav>
    </>
  )
}

/**
 * The late count after the Tasks label: "(1 atrasada)" on the phone tabs, as the mockup reads; in the top bar, where
 * every link must fit on one line, a "1" badge that still reads "1 atrasada".
 */
function Late({ item, late, short = false }: { item: NavItem; late: number; short?: boolean }) {
  if (item.to !== '/tasks' || late === 0) return null
  const words = late === 1 ? '1 atrasada' : `${late} atrasadas`
  if (short)
    return (
      <span className="nav__late nav__late--badge">
        {late}
        <span className="visually-hidden">{late === 1 ? ' atrasada' : ' atrasadas'}</span>
      </span>
    )
  return <span className="nav__late">({words})</span>
}

/** Open tasks past their day: the count the Tasks tab shows. */
function useLateCount(): number {
  const today = useFieldToday()
  const list = taskEntity.useList()
  return (list.data ?? []).filter((t) => isLate(t, today)).length
}
