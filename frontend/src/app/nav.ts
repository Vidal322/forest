export interface NavItem {
  to: string
  label: string
  icon: string
  /** Shown as a bottom tab on phones (the rest live under "More"). */
  tab?: boolean
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Map', icon: '🗺️', tab: true },
  { to: '/species', label: 'Species', icon: '🌱' },
]
