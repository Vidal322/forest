import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Species } from '../api/species'
import { fakeApi } from '../test/fakeApi'
import { SAVED_ON_PHONE } from './SpeciesPage'
import { renderApp } from '../test/render'

const suber: Species = {
  id: '11111111-1111-4111-8111-111111111111',
  scientific_name: 'Quercus suber',
  common_name: 'sobreiro',
  notes: null,
  updated_at: '2026-11-22T10:00:00Z',
}

/** A fake species API backed by an array, like the real one (PUT by id, soft delete). */
function speciesApi(initial: Species[] = []) {
  let db = [...initial]
  return fakeApi({
    'GET /api/species': () => ({ status: 200, body: db }),
    'PUT /api/species/[^/]+': ({ path, body }) => {
      const id = path.split('/').pop()!
      const input = body as Omit<Species, 'id' | 'updated_at'>
      const clash = db.find((s) => s.id !== id && s.scientific_name.toLowerCase() === input.scientific_name.toLowerCase())
      if (clash) return { status: 409, body: { error: { code: 'duplicate', field: 'scientific_name' } } }
      const existed = db.some((s) => s.id === id)
      const saved = { id, ...input, updated_at: '2026-11-22T12:00:00Z' }
      db = [...db.filter((s) => s.id !== id), saved]
      return { status: existed ? 200 : 201, body: saved }
    },
    'DELETE /api/species/[^/]+': ({ path }) => {
      const id = path.split('/').pop()
      db = db.filter((s) => s.id !== id)
      return { status: 204 }
    },
  })
}

describe('SpeciesPage', () => {
  it('invites you to add the first species when the catalogue is empty', async () => {
    speciesApi()
    renderApp('/species')
    expect(await screen.findByText('No species yet.')).toBeInTheDocument()
  })

  it('adds a species with an id made on the device', async () => {
    const api = speciesApi()
    renderApp('/species')
    await userEvent.click(await screen.findByRole('button', { name: /add species/i }))
    await userEvent.type(screen.getByLabelText('Scientific name'), '  Arbutus unedo ')
    await userEvent.type(screen.getByLabelText(/common name/i), 'medronheiro')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByText('Added Arbutus unedo.')).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Species' })
    expect(within(list).getByText('Arbutus unedo')).toBeInTheDocument()
    const put = api.calls.find((c) => c.method === 'PUT')!
    expect(put.path).toMatch(/^\/api\/species\/[0-9a-f-]{36}$/)
    expect(put.body).toEqual({ scientific_name: 'Arbutus unedo', common_name: 'medronheiro', notes: null })
  })

  it('shows a duplicate name next to the field and keeps what you typed', async () => {
    speciesApi([suber])
    renderApp('/species')
    await userEvent.click(await screen.findByRole('button', { name: /add species/i }))
    await userEvent.type(screen.getByLabelText('Scientific name'), 'quercus SUBER')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Scientific name is already used')
    expect(screen.getByLabelText('Scientific name')).toHaveValue('quercus SUBER')
    expect(screen.getByLabelText('Scientific name')).toHaveAttribute('aria-invalid', 'true')
    // the list did not keep the rejected entry
    expect(within(screen.getByRole('list', { name: 'Species' })).getAllByRole('listitem')).toHaveLength(1)
  })

  it('edits a species by tapping it', async () => {
    const api = speciesApi([suber])
    renderApp('/species')
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Quercus suber' }))
    const common = screen.getByLabelText(/common name/i)
    await userEvent.clear(common)
    await userEvent.type(common, 'sobreiro (cork oak)')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('sobreiro (cork oak)')).toBeInTheDocument()
    expect(api.calls.find((c) => c.method === 'PUT')?.path).toBe(`/api/species/${suber.id}`)
  })

  it('asks before deleting, then removes it', async () => {
    speciesApi([suber])
    renderApp('/species')
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Quercus suber' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByRole('group', { name: 'Confirm delete' })).toHaveTextContent('Past plantings and sowings keep it')
    await userEvent.click(within(screen.getByRole('group', { name: 'Confirm delete' })).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText('Deleted Quercus suber.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Edit Quercus suber' })).not.toBeInTheDocument())
  })

  it('searches by scientific or common name, ignoring accents and case', async () => {
    speciesApi([
      suber,
      { ...suber, id: '22222222-2222-4222-8222-222222222222', scientific_name: 'Castanea sativa', common_name: 'castanheiro' },
    ])
    renderApp('/species')
    const search = await screen.findByRole('searchbox', { name: 'Search species' })
    await userEvent.type(search, 'CASTANHÉIRO')
    const list = screen.getByRole('list', { name: 'Species' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(list).getByText('Castanea sativa')).toBeInTheDocument()
  })

  it('says so when the server cannot be reached, with a retry', async () => {
    fakeApi({ 'GET /api/species': () => ({ status: 500, body: { error: { code: 'internal' } } }) })
    renderApp('/species')
    expect(await screen.findByRole('alert')).toHaveTextContent('The server had a problem')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('checks a blank name on the phone, without calling the server', async () => {
    const api = speciesApi()
    renderApp('/species')
    await userEvent.click(await screen.findByRole('button', { name: /add species/i }))
    await userEvent.type(screen.getByLabelText('Scientific name'), '   ')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Scientific name is required.')
    expect(screen.getByLabelText('Scientific name')).toHaveFocus()
    expect(api.calls.some((c) => c.method === 'PUT')).toBe(false)
  })

  it('without a connection, keeps the new species on the phone and says so', async () => {
    const api = speciesApi()
    renderApp('/species')
    await userEvent.click(await screen.findByRole('button', { name: /add species/i }))
    api.fetchMock.mockImplementation(async (input) => {
      if (String(input) === '/healthz') return new Response('{"status":"ok"}')
      throw new TypeError('Failed to fetch')
    })
    await userEvent.type(screen.getByLabelText('Scientific name'), 'Pinus pinea')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByText(SAVED_ON_PHONE)).toBeInTheDocument()
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Species' })).getByText('Pinus pinea')).toBeInTheDocument()
    expect(screen.getByText(/1 change saved on this phone/)).toBeInTheDocument()
  })

  it('puts focus back on the Add button after Cancel', async () => {
    speciesApi([suber])
    renderApp('/species')
    await userEvent.click(await screen.findByRole('button', { name: /add species/i }))
    expect(screen.getByLabelText('Scientific name')).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /add species/i })).toHaveFocus())
  })

  it('does not open the keyboard when you only tap a species to look at it', async () => {
    speciesApi([suber])
    renderApp('/species')
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Quercus suber' }))
    expect(screen.getByLabelText('Scientific name')).not.toHaveFocus()
  })

  it('closes the form when the species was deleted elsewhere', async () => {
    const api = speciesApi([suber])
    renderApp('/species')
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Quercus suber' }))
    api.fetchMock.mockImplementation(async (input, init) => {
      if (init?.method === 'PUT') return new Response('{"error":{"code":"deleted"}}', { status: 410 })
      return new Response(String(input) === '/healthz' ? '{"status":"ok"}' : '[]')
    })
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('This was deleted in the meantime.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Quercus suber' })).not.toBeInTheDocument()
  })
})
