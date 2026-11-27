import type { IconName } from '../components/icons'

export interface NavItem {
  to: string
  label: string
  /** a shorter label for the top bar, where every link has to fit on one line */
  short?: string
  icon: IconName
  /** Shown as a bottom tab on phones (the rest live under "Mais"). */
  tab?: boolean
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Mapa', icon: 'map', tab: true },
  // (the Log tab goes once logging lives in the map's tools, P4c)
  { to: '/log', label: 'Registar', icon: 'log', tab: true },
  { to: '/tasks', label: 'Tarefas', icon: 'tasks', tab: true },
  { to: '/stats', label: 'Estatísticas', icon: 'stats' },
  { to: '/species', label: 'Espécies', icon: 'species' },
  { to: '/field', label: 'Configurar o terreno', short: 'Terreno', icon: 'field' },
]
