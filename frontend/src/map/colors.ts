import type { ZoneStatus } from '../domain/zoneStatus'

// Same values as the CSS tokens in styles.css (Leaflet paths need real colours).
export const STATUS_COLOR: Record<ZoneStatus, string> = {
  'needs-water': '#d9822b',
  watered: '#3a7fc1',
  planted: '#2e6b3f',
  sown: '#c9a227',
  unsown: '#efe7d6',
  path: '#8a867c',
}

export const PLOT_COLOR = '#7fd36f'
