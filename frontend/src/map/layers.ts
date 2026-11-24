/** What the field map shows; each can be switched off (remembered on the phone). */
export interface MapLayers {
  plots: boolean
  zones: boolean
  tasks: boolean
}

export const ALL_LAYERS: MapLayers = { plots: true, zones: true, tasks: true }

export const LAYER_LABEL: Record<keyof MapLayers, string> = { plots: 'Plots', zones: 'Zones', tasks: 'Tasks' }

/** The stored choice, or everything shown for anything missing or unreadable. */
export function parseLayers(stored: unknown): MapLayers {
  const s = typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {}
  const pick = (k: keyof MapLayers) => (typeof s[k] === 'boolean' ? (s[k] as boolean) : ALL_LAYERS[k])
  return { plots: pick('plots'), zones: pick('zones'), tasks: pick('tasks') }
}
