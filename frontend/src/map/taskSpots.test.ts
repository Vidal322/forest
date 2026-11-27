import { describe, expect, it } from 'vitest'
import type { Task } from '../api/tasks'
import { testPlot, testZone } from '../test/fixtures'
import { parseLayers } from './layers'
import { pinTitle, taskSpots } from './taskSpots'

const task = (over: Partial<Task>): Task => ({
  id: 't',
  plot_id: null,
  zone_id: testZone.id,
  title: 'Regar',
  description: null,
  kind: 'water',
  status: 'open',
  due_on: null,
  completed_at: null,
  resolved_by_activity_id: null,
  version: 1,
  created_at: '2026-11-01T10:00:00Z',
  updated_at: '2026-11-01T10:00:00Z',
  ...over,
})

describe('taskSpots', () => {
  it('pins open tasks at the centre of their zone, or of their plot', () => {
    const spots = taskSpots(
      [
        task({ id: 'a' }),
        task({ id: 'b', status: 'in_progress', title: 'Semear' }),
        task({ id: 'c', status: 'done' }),
        task({ id: 'd', zone_id: null, plot_id: testPlot.id, title: 'Caminho' }),
      ],
      [testPlot],
      [testZone],
    )
    expect(spots.map((s) => [s.key, s.at, s.tasks.map((t) => t.id)])).toEqual([
      [`zone:${testZone.id}`, [125, 125], ['a', 'b']],
      [`plot:${testPlot.id}`, [200, 200], ['d']],
    ])
    expect(spots.map(pinTitle)).toEqual(['2 tarefas: Clareira', 'Tarefa: Caminho'])
  })

  it('leaves out tasks whose place is not known here', () => {
    expect(taskSpots([task({ zone_id: 'gone' }), task({ zone_id: null, plot_id: 'gone' })], [testPlot], [testZone])).toEqual([])
  })
})

describe('parseLayers', () => {
  it('keeps what was stored and shows anything missing or odd', () => {
    expect(parseLayers({ plots: false, zones: 'no', extra: 1 })).toEqual({ plots: false, zones: true, tasks: true })
    expect(parseLayers(undefined)).toEqual({ plots: true, zones: true, tasks: true })
    expect(parseLayers(null)).toEqual({ plots: true, zones: true, tasks: true })
  })
})
