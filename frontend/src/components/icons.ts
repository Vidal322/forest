/**
 * Line icons (24 × 24, drawn in the text colour). Each one only says what the word next to it says, so it is hidden
 * from screen readers. The markup is static and ours: the map's HTML markers use `iconSvg` too.
 */
export const PATHS = {
  // activities, task kinds and the map tools
  water: '<path d="M12 3C9 8 6 11 6 14.5a6 6 0 0 0 12 0C18 11 15 8 12 3z"/>',
  plant: '<path d="M12 21v-9M12 12c0-4 3-7 7-7 0 4-3 7-7 7zM12 14c0-3-2.5-5.5-6-5.5 0 3 2.5 5.5 6 5.5z"/>',
  sow:
    '<g fill="currentColor" stroke="none"><circle cx="7" cy="9" r="1.8"/><circle cx="13" cy="7" r="1.8"/>' +
    '<circle cx="17" cy="12" r="1.8"/><circle cx="10" cy="14" r="1.8"/><circle cx="15" cy="17" r="1.8"/>' +
    '<circle cx="7" cy="18" r="1.8"/></g>',
  fertilize: '<path d="M6 8h12l1.5 12h-15zM9 8l1-4h4l1 4M10 13h4"/>',
  nests: '<path d="M3 12h18c-1 5-4.5 8-9 8s-8-3-9-8z"/><ellipse cx="9.5" cy="9" rx="2.2" ry="2.8"/><ellipse cx="14.5" cy="9" rx="2.2" ry="2.8"/>',
  path: '<path d="M8 21l2.5-18M16 21l-2.5-18M12 6.5v1.5M12 11v2M12 16.5v2"/>',
  other: '<g fill="currentColor" stroke="none"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></g>',
  // navigation
  map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14"/>',
  log: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  tasks: '<path d="M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17M11 6h9M11 12h9M11 18h9"/>',
  more: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  stats: '<path d="M4 20V11M10 20V5M16 20v-6M3 20h18"/>',
  species: '<path d="M5 19C5 11 10 5 19 5c0 9-6 14-14 14zM5 19l7-7"/>',
  field: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  // actions
  add: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M15 4l-8 8 8 8"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  undo: '<path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13.5" r="3.5"/>',
  zone: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  plot: '<path d="M4 6l8-3 8 3v12l-8 3-8-3z"/>',
} as const

export type IconName = keyof typeof PATHS

const OPEN = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'

/** The icon as an SVG string, for HTML that Leaflet places (markers). */
export function iconSvg(name: IconName, size = 20): string {
  return `<svg width="${size}" height="${size}" ${OPEN} aria-hidden="true" focusable="false">${PATHS[name]}</svg>`
}
