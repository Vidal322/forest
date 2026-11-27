import type { Field } from '../api/field'
import type { Plot, Zone } from '../api/plots'

export const testField: Field = {
  id: 'f1',
  name: 'Quinta',
  frame_width: 1000,
  frame_height: 700,
  calibration_line: { type: 'LineString', coordinates: [[0, 0], [100, 0]] },
  calibration_length_m: 48,
  metres_per_unit: 0.48,
  default_water_interval_days: 7,
  photo: {
    id: 'p1',
    key: '0f0e0d0c-0b0a-4908-8706-050403020100.jpg',
    width: 1000,
    height: 700,
    affine_to_frame: [1, 0, 0, 0, 1, 0],
    captured_on: null,
    created_at: '2026-11-22T10:00:00Z',
  },
  updated_at: '2026-11-22T10:00:00Z',
}

const ring = (x: number, y: number, s: number): [number, number][] => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
  [x, y],
]

export const testPlot: Plot = {
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Plot 1',
  geom: { type: 'Polygon', coordinates: [ring(0, 0, 400)] },
  declared_area_ha: 6.2,
  notes: null,
  area_ha: 3.69,
  updated_at: '2026-11-22T10:00:00Z',
}

export const testZone: Zone = {
  id: '20000000-0000-4000-8000-000000000001',
  plot_id: testPlot.id,
  code: 'Z1',
  label: 'Clareira',
  kind: 'cultivation',
  geom: { type: 'Polygon', coordinates: [ring(50, 50, 150)] },
  notes: null,
  area_ha: 0.23,
  updated_at: '2026-11-22T10:00:00Z',
  last_sown_on: '2026-09-28',
  last_planted_on: null,
  last_watered_on: null,
  current_interval_days: 7,
  open_task_count: 0,
  needs_water: true,
}
