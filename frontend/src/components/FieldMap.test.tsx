import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Browser } from 'leaflet'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { FieldMap } from './FieldMap'

const photo = { url: '/placeholder-field.svg', width: 1000, height: 700 }

/** jsdom has no layout: give every element this size (Leaflet reads clientWidth/clientHeight). */
function setViewport(width: number, height: number) {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(width)
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(height)
}

// jsdom has no CSS 3D transforms, so Leaflet would fall back to whole-number zoom levels.
// Every phone the app targets has them: test the fractional-zoom behaviour users actually get.
const browser = Browser as { any3d: boolean }
const realAny3d = browser.any3d
beforeAll(() => {
  browser.any3d = true
})
afterAll(() => {
  browser.any3d = realAny3d
})

const photoImg = () => screen.getByRole('img', { name: 'Aerial photo of the field' })
const zoomOut = () => screen.getByRole('button', { name: 'Zoom out' })

describe('FieldMap', () => {
  it('shows the field photo inside a labelled map region', () => {
    render(<FieldMap photo={photo} />)
    const region = screen.getByRole('region', { name: 'Field map' })
    expect(region).toContainElement(photoImg())
    expect(photoImg()).toHaveAttribute('src', '/placeholder-field.svg')
  })

  it('opens with the whole photo fitted to a phone screen', () => {
    setViewport(390, 700)
    render(<FieldMap photo={photo} />)
    // 390 px / 1000 units → zoom -1.5 (snapped down to a quarter step): 1000 × 2^-1.5 ≈ 354 px wide
    expect(parseFloat(photoImg().style.width)).toBeCloseTo(1000 * 2 ** -1.5, 0)
  })

  it('stops zooming out a little past the whole field', async () => {
    setViewport(390, 700)
    render(<FieldMap photo={photo} />)
    expect(zoomOut()).not.toHaveClass('leaflet-disabled')
    await userEvent.click(zoomOut()) // -1.5 → -2, the floor
    await waitFor(() => expect(zoomOut()).toHaveClass('leaflet-disabled'))
  })

  it('recomputes the zoom-out floor when the phone rotates', async () => {
    setViewport(390, 700)
    render(<FieldMap photo={photo} />)
    expect(zoomOut()).not.toHaveClass('leaflet-disabled')

    setViewport(700, 390) // landscape: fit is now zoom -1, so the floor -1.5 is where we already are
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    await waitFor(() => expect(zoomOut()).toHaveClass('leaflet-disabled'))
  })

  it('the Whole field button brings the photo back after zooming in', async () => {
    setViewport(390, 700)
    render(<FieldMap photo={photo} />)
    const fitted = parseFloat(photoImg().style.width)
    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    await waitFor(() => expect(parseFloat(photoImg().style.width)).toBeGreaterThan(fitted))

    await userEvent.click(screen.getByRole('button', { name: /whole field/i }))
    await waitFor(() => expect(parseFloat(photoImg().style.width)).toBeCloseTo(fitted, 0))
  })

  it('does not break before the map has a size (hidden or not laid out)', async () => {
    render(<FieldMap photo={photo} />)
    await userEvent.click(screen.getByRole('button', { name: /whole field/i }))
    expect(photoImg()).toBeInTheDocument()
  })
})
