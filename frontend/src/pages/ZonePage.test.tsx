import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Activity } from '../api/activities'
import type { Task } from '../api/tasks'
import { addDays, fieldToday } from '../domain/dates'
import { fakeApi } from '../test/fakeApi'
import { testPlot, testZone } from '../test/fixtures'
import { renderApp } from '../test/render'

const today = fieldToday()
const sowing: Activity = {
  id: '50000000-0000-4000-8000-000000000001',
  type: 'sowing',
  performed_on: addDays(today, -3),
  notes: 'Ninhos feitos',
  zones: [
    { zone_id: testZone.id, quantity: 100, unit: 'holes' },
    { zone_id: '20000000-0000-4000-8000-0000000000ff', quantity: 80, unit: 'holes' },
  ],
  species: [{ species_id: 's1', quantity: null, unit: null, notes: null }],
  version: 2,
  created_at: 'x',
  updated_at: 'x',
}

function zoneApi(taskList: Task[] = []) {
  let entries = [sowing]
  let trees: { zone_id: string; species_id: string; alive: number; dead: number }[] = []
  return fakeApi({
    'DELETE /api/activities/[^/]+': ({ path }) => {
      entries = entries.filter((a) => a.id !== path.split('/').pop())
      return { status: 204 }
    },
    'GET /api/zones': () => ({ status: 200, body: [testZone] }),
    'GET /api/plots': () => ({ status: 200, body: [testPlot] }),
    'GET /api/activities.*': () => ({ status: 200, body: entries }),
    'GET /api/tasks': () => ({ status: 200, body: taskList }),
    'GET /api/species': () => ({ status: 200, body: [{ id: 's1', scientific_name: 'Quercus suber', common_name: 'sobreiro', notes: null, updated_at: 'x' }] }),
    'GET /api/tree-counts': () => ({ status: 200, body: trees }),
    'PUT /api/zones/[^/]+/trees/[^/]+': ({ path, body }) => {
      const [, , , zone_id, , species_id] = path.split('/')
      const c = { zone_id: zone_id!, species_id: species_id!, ...(body as { alive: number; dead: number }) }
      trees = [...trees.filter((t) => t.species_id !== species_id), c]
      return { status: 200, body: c }
    },
    'PUT /api/activities/[^/]+': ({ body }) => ({ status: 200, body: { ...sowing, ...(body as object), version: 3 } }),
    'PUT /api/tasks/[^/]+': ({ path, body }) => ({ status: 201, body: { ...(body as object), id: path.split('/').pop(), version: 1, completed_at: null, created_at: 'x', updated_at: 'x' } }),
  })
}

describe('ZonePage', () => {
  it('shows the zone’s history with quantities, species and notes', async () => {
    zoneApi()
    renderApp(`/zones/${testZone.id}`)
    expect(await screen.findByRole('heading', { name: 'Clareira' })).toBeInTheDocument()
    const history = await screen.findByRole('button', { name: /Edit: .*Sowed/ })
    expect(history).toHaveTextContent('Sowed · 100 covas')
    expect(history).toHaveTextContent('3 days ago')
    expect(history).toHaveTextContent('with 1 other zone')
    expect(history).toHaveTextContent('sobreiro')
    expect(history).toHaveTextContent('Ninhos feitos')
  })

  it('edits an entry from its version', async () => {
    const api = zoneApi()
    renderApp(`/zones/${testZone.id}`)
    await userEvent.click(await screen.findByRole('button', { name: /Edit: .*Sowed/ }))
    expect(screen.getByText(/1 deleted zone will be left out/)).toBeInTheDocument()
    const qty = screen.getByRole('textbox', { name: /Clareira, covas/ })
    await userEvent.clear(qty)
    await userEvent.type(qty, '120')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Entry saved.')).toBeInTheDocument()
    const body = api.calls.find((c) => c.method === 'PUT')!.body as Record<string, unknown>
    expect(body.base_version).toBe(2)
    // the entry's other zone was deleted meanwhile: left out (the server would refuse it)
    expect(body.zones).toEqual([{ zone_id: testZone.id, quantity: 120, unit: 'holes' }])
    expect(body.species).toEqual([{ species_id: 's1', quantity: null, unit: null, notes: null }])
  })

  it('adds a task to this zone', async () => {
    const api = zoneApi()
    renderApp(`/zones/${testZone.id}`)
    await userEvent.click(await screen.findByRole('button', { name: /Add task/ }))
    expect(screen.queryByLabelText('Where')).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('What needs doing?'), 'Regar')
    await userEvent.click(within(screen.getByRole('form')).getByRole('button', { name: 'Add task' }))
    expect(await screen.findByText('Added “Regar”.')).toBeInTheDocument()
    expect(api.calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ zone_id: testZone.id, plot_id: null, title: 'Regar' })
  })

  it('says so when the zone is gone', async () => {
    zoneApi()
    renderApp('/zones/20000000-0000-4000-8000-000000000999')
    expect(await screen.findByRole('heading', { name: 'Zone not found' })).toBeInTheDocument()
  })

  it('keeps the version the form opened with, even if the list refreshes meanwhile', async () => {
    const api = zoneApi()
    const { queryClient } = renderApp(`/zones/${testZone.id}`)
    await userEvent.click(await screen.findByRole('button', { name: /Edit: .*Sowed/ }))
    // another phone changed it: the list now says version 5
    queryClient.setQueryData<Activity[]>(['activities'], (l) => l?.map((a) => ({ ...a, version: 5 })))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Entry saved.')
    expect((api.calls.find((c) => c.method === 'PUT')!.body as { base_version: number }).base_version).toBe(2)
  })

  it('closes and confirms when an entry is deleted', async () => {
    zoneApi()
    renderApp(`/zones/${testZone.id}`)
    await userEvent.click(await screen.findByRole('button', { name: /Edit: .*Sowed/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await userEvent.click(within(screen.getByRole('group', { name: 'Confirm delete' })).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Entry deleted.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit: .*Sowed/ })).not.toBeInTheDocument()
  })

  it('counts trees by species, and records deaths', async () => {
    const api = zoneApi()
    renderApp(`/zones/${testZone.id}`)
    expect(await screen.findByText('No trees counted here yet.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Count trees/ }))
    await userEvent.selectOptions(screen.getByLabelText('Add a species'), 's1')
    await userEvent.click(screen.getByRole('button', { name: 'One alive sobreiro more' }))
    await userEvent.click(screen.getByRole('button', { name: 'One alive sobreiro more' }))
    await userEvent.click(within(screen.getByRole('form', { name: 'Count trees' })).getByRole('button', { name: 'Save' }))
    const table = await screen.findByRole('table')
    expect(within(table).getByRole('row', { name: /sobreiro 2 0/ })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Count trees/ }))
    await userEvent.click(screen.getByRole('button', { name: 'One alive sobreiro less' }))
    await userEvent.click(screen.getByRole('button', { name: 'One dead sobreiro more' }))
    await userEvent.click(within(screen.getByRole('form', { name: 'Count trees' })).getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('row', { name: /sobreiro 1 1/ })).toBeInTheDocument()
    const puts = api.calls.filter((c) => c.path.includes('/trees/'))
    expect(puts.map((c) => c.body)).toEqual([{ alive: 2, dead: 0 }, { alive: 1, dead: 1 }])
  })

  it('refuses tree counts the server would refuse', async () => {
    const api = zoneApi()
    renderApp(`/zones/${testZone.id}`)
    await userEvent.click(await screen.findByRole('button', { name: /Count trees/ }))
    await userEvent.selectOptions(screen.getByLabelText('Add a species'), 's1')
    const alive = screen.getByRole('textbox', { name: 'sobreiro, alive' })
    await userEvent.clear(alive)
    await userEvent.type(alive, '20000')
    await userEvent.click(within(screen.getByRole('form', { name: 'Count trees' })).getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Counts are whole numbers from 0 to 10,000.')
    expect(api.calls.some((c) => c.path.includes('/trees/'))).toBe(false)
  })

  it('shows a task done by a log entry, with a link to that entry', async () => {
    const sown: Task = {
      id: '40000000-0000-4000-8000-000000000001',
      plot_id: null,
      zone_id: testZone.id,
      title: 'Falta semear',
      description: null,
      kind: 'sow',
      status: 'done',
      due_on: null,
      completed_at: new Date().toISOString(),
      resolved_by_activity_id: sowing.id,
      version: 2,
      created_at: 'x',
      updated_at: 'x',
    }
    zoneApi([sown])
    renderApp(`/zones/${testZone.id}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Show done (1)' }))
    const link = await screen.findByRole('link', { name: /Done by the log entry: .*Sowed/ })
    await userEvent.click(link)
    const entry = await screen.findByRole('button', { name: /Edit: .*Sowed/ })
    await waitFor(() => expect(entry).toHaveFocus())
    expect(entry).toHaveClass('is-target')
  })
})
