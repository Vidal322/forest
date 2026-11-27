import type { ZoneStatus } from '../domain/zoneStatus'

// The paint colours on the photo, as the --paint-* tokens in styles.css (Leaflet paths need real colours).
export const STATUS_COLOR: Record<ZoneStatus, string> = {
  'needs-water': '#F26B1D',
  watered: '#6FB2F2',
  planted: '#9BD06A',
  sown: '#F2D14A',
  unsown: '#FFFFFF',
  path: '#B8B4A8',
}

export const PLOT_COLOR = '#7fd36f'
