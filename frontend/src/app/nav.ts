export interface NavItem {
  to: string
  label: string
  icon: string
  /** Shown as a bottom tab on phones (the rest live under "More"). */
  tab?: boolean
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Map', icon: '🗺️', tab: true },
  { to: '/log', label: 'Log', icon: '＋', tab: true },
  { to: '/tasks', label: 'Tasks', icon: '✓', tab: true },
  { to: '/stats', label: 'Plot stats', icon: '📊' },
  { to: '/species', label: 'Species', icon: '🌱' },
  { to: '/field', label: 'Field setup', icon: '⚙️' },
]
