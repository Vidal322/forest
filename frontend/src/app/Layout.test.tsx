import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { fakeApi } from '../test/fakeApi'
import { renderApp } from '../test/render'

describe('Layout', () => {
  it('opens on the map', () => {
    fakeApi({})
    renderApp('/')
    expect(screen.getByRole('heading', { name: 'Field map' })).toBeInTheDocument()
  })

  it('reaches the species catalogue through More (phone tabs)', async () => {
    fakeApi({ 'GET /api/species': () => ({ status: 200, body: [] }) })
    const { router } = renderApp('/')
    const tabs = screen.getAllByRole('navigation', { name: 'Main' })[1]!
    await userEvent.click(within(tabs).getByRole('link', { name: /more/i }))
    await userEvent.click(within(screen.getByRole('main')).getByRole('link', { name: /species/i }))
    expect(router.state.location.pathname).toBe('/species')
    expect(await screen.findByRole('heading', { name: 'Species' })).toBeInTheDocument()
    expect(within(tabs).getByRole('link', { name: /more/i })).toHaveAttribute('aria-current', 'page')
  })

  it('has a friendly page for unknown addresses', () => {
    fakeApi({})
    renderApp('/nope')
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })
})
