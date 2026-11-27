import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
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

  it('has a friendly page for unknown addresses', () => {
    fakeApi({})
    renderApp('/nope')
    expect(screen.getByRole('heading', { name: 'Página não encontrada' })).toBeInTheDocument()
  })
})
