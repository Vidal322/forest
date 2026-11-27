export interface NavItem {
  to: string
  label: string
  /** a shorter label for the top bar, where every link has to fit on one line */
  short?: string
  icon: string
  /** Shown as a bottom tab on phones (the rest live under "Mais"). */
  tab?: boolean
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Mapa', icon: '🗺️', tab: true },
  { to: '/log', label: 'Registar', icon: '＋', tab: true },
  { to: '/tasks', label: 'Tarefas', icon: '✓', tab: true },
  { to: '/stats', label: 'Estatísticas', icon: '📊' },
  { to: '/species', label: 'Espécies', icon: '🌱' },
  { to: '/field', label: 'Configurar o terreno', short: 'Terreno', icon: '⚙️' },
]
