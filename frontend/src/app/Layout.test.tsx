import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Task } from '../api/tasks'
import { addDays, fieldToday } from '../domain/dates'
import { fakeApi } from '../test/fakeApi'
import { renderApp } from '../test/render'

describe('Layout', () => {
  it('opens on the map', () => {
    fakeApi({ 'GET /api/field': () => ({ status: 404, body: { error: { code: 'no_field' } } }) })
    renderApp('/')
    expect(screen.getByRole('heading', { name: 'Mapa do terreno' })).toBeInTheDocument()
  })

  it('reaches the species catalogue through More (phone tabs)', async () => {
    fakeApi({
      'GET /api/species': () => ({ status: 200, body: [] }),
      'GET /api/field': () => ({ status: 404, body: { error: { code: 'no_field' } } }),
    })
    const { router } = renderApp('/')
    const tabs = screen.getAllByRole('navigation', { name: 'Principal' })[1]!
    await userEvent.click(within(tabs).getByRole('link', { name: /mais/i }))
    await userEvent.click(within(screen.getByRole('main')).getByRole('link', { name: 'Espécies' }))
    expect(router.state.location.pathname).toBe('/species')
    expect(await screen.findByRole('heading', { name: 'Espécies' })).toBeInTheDocument()
    expect(within(tabs).getByRole('link', { name: /mais/i })).toHaveAttribute('aria-current', 'page')
  })

  it('reaches the More page (and its export) from the top navigation (wide screens)', async () => {
    fakeApi({ 'GET /api/field': () => ({ status: 404, body: { error: { code: 'no_field' } } }) })
    const { router } = renderApp('/')
    const top = screen.getAllByRole('navigation', { name: 'Principal' })[0]!
    await userEvent.click(within(top).getByRole('link', { name: 'Mais' }))
    expect(router.state.location.pathname).toBe('/more')
    expect(await screen.findByRole('button', { name: /descarregar csv/i })).toBeInTheDocument()
    expect(within(top).getByRole('link', { name: 'Mais' })).toHaveAttribute('aria-current', 'page')
  })

  it('the Tasks tab says how many tasks are late, and says nothing when none is', async () => {
    const today = fieldToday()
    const task = (id: string, due_on: string | null, status: Task['status'] = 'open'): Task => ({
      id, plot_id: null, zone_id: null, title: id, description: null, kind: 'water', status, due_on,
      completed_at: null, resolved_by_activity_id: null, version: 1, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    })
    const list = [task('a', addDays(today, -2)), task('b', addDays(today, -1)), task('c', today), task('d', null), task('e', addDays(today, -3), 'done')]
    fakeApi({
      'GET /api/field': () => ({ status: 404, body: { error: { code: 'no_field' } } }),
      'GET /api/tasks': () => ({ status: 200, body: list }),
    })
    renderApp('/')
    const tabs = screen.getAllByRole('navigation', { name: 'Principal' })[1]!
    expect(await within(tabs).findByRole('link', { name: /^Tarefas ?\(2 atrasadas\)$/ })).toHaveAttribute('href', '/tasks')
    const top = screen.getAllByRole('navigation', { name: 'Principal' })[0]!
    expect(within(top).getByRole('link', { name: /^Tarefas ?2 ?atrasadas$/ })).toBeInTheDocument()
  })

  it('the Tasks tab is plain "Tarefas" with nothing late', async () => {
    fakeApi({
      'GET /api/field': () => ({ status: 404, body: { error: { code: 'no_field' } } }),
      'GET /api/tasks': () => ({ status: 200, body: [] }),
    })
    renderApp('/')
    const tabs = screen.getAllByRole('navigation', { name: 'Principal' })[1]!
    await waitFor(() => expect(within(tabs).getByRole('link', { name: 'Tarefas' })).toBeInTheDocument())
    expect(within(tabs).getAllByRole('link').map((l) => l.textContent)).toEqual(['Mapa', 'Registar', 'Tarefas', 'Mais'])
  })

  it('has a friendly page for unknown addresses', () => {
    fakeApi({})
    renderApp('/nope')
    expect(screen.getByRole('heading', { name: 'Página não encontrada' })).toBeInTheDocument()
  })
})
