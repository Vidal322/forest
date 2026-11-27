import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Browser } from 'leaflet'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeApi } from '../test/fakeApi'
import { testField } from '../test/fixtures'
import { renderApp } from '../test/render'

const browser = Browser as { any3d: boolean }
const realAny3d = browser.any3d
beforeAll(() => {
  browser.any3d = true
})
afterAll(() => {
  browser.any3d = realAny3d
})

beforeEach(() => {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(600)
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(400)
  URL.createObjectURL = vi.fn<typeof URL.createObjectURL>(() => 'blob:new-photo')
  URL.revokeObjectURL = vi.fn<typeof URL.revokeObjectURL>()
  // jsdom doesn't load images: report the picked photo's size at once
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 500
      naturalHeight = 350
      onload: (() => void) | null = null
      set src(_: string) {
        queueMicrotask(() => this.onload?.())
      }
    },
  )
})

describe('PhotoAlignment', () => {
  it('matches landmarks on the new photo and the current map, then uploads', async () => {
    const api = fakeApi({
      'GET /api/field': () => ({ status: 200, body: testField }),
      'POST /api/field/photos': () => ({ status: 201, body: { residual_px: 1.2, alignment_points: [1, 2, 3, 4] } }),
    })
    const { container } = renderApp('/field')
    await userEvent.upload(await screen.findByLabelText(/Escolher a fotografia mais recente/), new File(['x'], 'new.png', { type: 'image/png' }))
    expect(await screen.findByText('Ponto 1: toca nele na fotografia nova.')).toBeInTheDocument()
    const map = () => container.querySelector('.setup-map.is-active .leaflet-container')!

    // a tap outside the photo is refused with a hint
    fireEvent.click(map(), { clientX: 5, clientY: 5 })
    expect(screen.getByRole('alert')).toHaveTextContent('Toca dentro da fotografia.')

    for (const [x, y] of [
      [100, 100],
      [500, 100],
      [300, 350],
      [120, 330],
    ]) {
      fireEvent.click(map(), { clientX: x, clientY: y }) // new photo
      expect(await screen.findByText(/agora toca no mesmo sítio no mapa atual/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Mapa atual' })).toHaveAttribute('aria-pressed', 'true')
      fireEvent.click(map(), { clientX: x, clientY: y }) // current map
    }
    expect(screen.getByText('4 pontos de referência marcados')).toBeInTheDocument()
    // a wrong pair can be removed on its own
    await userEvent.click(screen.getByRole('button', { name: 'Tirar o ponto 4' }))
    expect(screen.getByText(/3 pontos de referência marcados/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Usar a fotografia nova' }))
    expect(await screen.findByText(/Fotografia nova alinhada\. Encaixa muito bem/)).toBeInTheDocument()
    // the form is ready for another photo, not this one again
    expect(screen.queryByRole('button', { name: 'Usar a fotografia nova' })).not.toBeInTheDocument()

    const post = api.fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    const pairs = JSON.parse(String((post[1]!.body as FormData).get('alignment')))
    // new photo (500×350) fits its 600×400 map at zoom 0: 1 px = 1 photo px, centred;
    // the 1000×700 frame fits at zoom −1: 1 px = 2 frame units
    expect(pairs[0]).toEqual({ photo: [50, 75], frame: [100, 150] })
    expect(pairs).toHaveLength(3)
  })

  it('needs 3 landmarks', async () => {
    fakeApi({ 'GET /api/field': () => ({ status: 200, body: testField }) })
    renderApp('/field')
    await userEvent.upload(await screen.findByLabelText(/Escolher a fotografia mais recente/), new File(['x'], 'new.png', { type: 'image/png' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Usar a fotografia nova' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Marca pelo menos 3 pontos de referência (para já, 0).')
  })
})
