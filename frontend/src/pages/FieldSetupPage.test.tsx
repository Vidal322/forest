import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Field } from '../api/field'
import { fakeApi } from '../test/fakeApi'
import { renderApp } from '../test/render'

const field: Field = {
  id: 'f1',
  name: 'Quinta',
  frame_width: 1000,
  frame_height: 700,
  calibration_line: null,
  calibration_length_m: null,
  metres_per_unit: null,
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

const noField = { status: 404, body: { error: { code: 'no_field' } } }

beforeEach(() => {
  // jsdom lacks object URLs (used for the photo preview)
  URL.createObjectURL = vi.fn<typeof URL.createObjectURL>(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn<typeof URL.revokeObjectURL>()
})

describe('first run', () => {
  it('the map invites you to set up the field', async () => {
    fakeApi({ 'GET /api/field': () => noField })
    renderApp('/')
    expect(await screen.findByRole('heading', { name: 'Bem-vindo ao Forest' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Configurar o teu terreno' })).toHaveAttribute('href', '/field')
  })

  it('creates the field from a name and a photo', async () => {
    let created = false
    const api = fakeApi({
      'GET /api/field': () => (created ? { status: 200, body: field } : noField),
      'POST /api/field': () => {
        created = true
        return { status: 201, body: field }
      },
    })
    renderApp('/field')
    await userEvent.type(await screen.findByLabelText('Nome do terreno'), 'Quinta')
    const file = new File(['png'], 'field.png', { type: 'image/png' })
    await userEvent.upload(screen.getByLabelText(/escolher a fotografia do terreno/i), file)
    expect(screen.getByRole('img', { name: 'Pré-visualização do terreno que escolheste' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Criar o terreno' }))

    expect(await screen.findByText('Terreno criado. Agora marca a escala.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '2 · Marcar a escala' })).toBeInTheDocument()
    const post = api.fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    const body = post[1]!.body as FormData
    expect(body.get('name')).toBe('Quinta')
    expect((body.get('photo') as File).name).toBe('field.png')
  })

  it('asks for the missing parts before uploading', async () => {
    const api = fakeApi({ 'GET /api/field': () => noField })
    renderApp('/field')
    await userEvent.click(await screen.findByRole('button', { name: 'Criar o terreno' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Dá um nome ao terreno.')
    await userEvent.type(screen.getByLabelText('Nome do terreno'), 'Quinta')
    await userEvent.click(screen.getByRole('button', { name: 'Criar o terreno' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Escolhe a fotografia do teu terreno.')
    expect(api.fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it('explains a rejected photo', async () => {
    fakeApi({
      'GET /api/field': () => noField,
      'POST /api/field': () => ({
        status: 422,
        body: { error: { code: 'not_an_image', message: 'not a PNG, JPEG or WebP image', field: 'photo' } },
      }),
    })
    renderApp('/field')
    await userEvent.type(await screen.findByLabelText('Nome do terreno'), 'Quinta')
    await userEvent.upload(screen.getByLabelText(/escolher a fotografia do terreno/i), new File(['x'], 'notes.png', { type: 'image/png' }))
    await userEvent.click(screen.getByRole('button', { name: 'Criar o terreno' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Esse ficheiro não é uma fotografia que a aplicação consiga ler.')
  })
})

describe('scale', () => {
  it('saves the line with its real length, keeping the other settings', async () => {
    const api = fakeApi({
      'GET /api/field': () => ({ status: 200, body: field }),
      'PUT /api/field': ({ body }) => ({ status: 200, body: { ...field, ...(body as object), metres_per_unit: 0.3 } }),
    })
    renderApp('/field')
    const metres = await screen.findByLabelText('Comprimento real da linha A–B')
    // default line: across the middle third of a 1000 px photo
    expect(screen.getByText(/Linha: 334 px/)).toBeInTheDocument()
    await userEvent.type(metres, '100')
    // never calibrated: the made-up line must be placed first
    await userEvent.click(screen.getByRole('button', { name: 'Guardar a escala' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Primeiro põe A e B')
    // place it by typing the positions (the keyboard alternative to dragging)
    await userEvent.click(screen.getByText('Escrever as posições à mão'))
    const bx = screen.getByLabelText('B x')
    await userEvent.clear(bx)
    await userEvent.type(bx, '633')
    expect(screen.getByText(/Linha: 300 px/)).toBeInTheDocument()
    expect(screen.getByText(/1 px ≈ 0,33 m/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Guardar a escala' }))

    expect(await screen.findByText('Escala guardada.')).toBeInTheDocument()
    const put = api.calls.find((c) => c.method === 'PUT')!
    expect(put.body).toEqual({
      name: 'Quinta',
      calibration_line: { type: 'LineString', coordinates: [[333, 350], [633, 350]] },
      calibration_length_m: 100,
      default_water_interval_days: 7,
    })
  })

  it('accepts a decimal comma', async () => {
    const calibrated = { ...field, calibration_line: { type: 'LineString' as const, coordinates: [[0, 0], [100, 0]] as [number, number][] }, calibration_length_m: 10 }
    const api = fakeApi({
      'GET /api/field': () => ({ status: 200, body: calibrated }),
      'PUT /api/field': ({ body }) => ({ status: 200, body: { ...field, ...(body as object) } }),
    })
    renderApp('/field')
    const metres = await screen.findByLabelText('Comprimento real da linha A–B')
    await userEvent.clear(metres)
    await userEvent.type(metres, '12,5')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar a escala' }))
    await waitFor(() => expect(api.calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ calibration_length_m: 12.5 }))
  })

  it('needs a length', async () => {
    fakeApi({
      'GET /api/field': () => ({
        status: 200,
        body: { ...field, calibration_line: { type: 'LineString', coordinates: [[0, 0], [100, 0]] } },
      }),
    })
    renderApp('/field')
    await userEvent.click(await screen.findByRole('button', { name: 'Guardar a escala' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Escreve o comprimento real da linha, em metros.')
  })
})

describe('the map', () => {
  it('shows the field photo once set up', async () => {
    fakeApi({ 'GET /api/field': () => ({ status: 200, body: field }) })
    renderApp('/')
    expect(await screen.findByRole('img', { name: 'Fotografia aérea do terreno' })).toHaveAttribute(
      'src',
      `/api/photos/${field.photo!.key}/display`,
    )
  })

  it('places the scale line on the full-size original', async () => {
    fakeApi({ 'GET /api/field': () => ({ status: 200, body: field }) })
    renderApp('/field')
    expect(await screen.findByRole('img', { name: 'Fotografia aérea do terreno' })).toHaveAttribute(
      'src',
      `/api/photos/${field.photo!.key}`,
    )
  })
})

describe('details and offline', () => {
  it('a field set up meanwhile (lost answer, second tap) loads instead of erroring', async () => {
    let posted = false // the server already has it; our copy doesn't know yet
    fakeApi({
      'GET /api/field': () => (posted ? { status: 200, body: field } : noField),
      'POST /api/field': () => {
        posted = true
        return { status: 409, body: { error: { code: 'field_exists' } } }
      },
    })
    renderApp('/field')
    await userEvent.type(await screen.findByLabelText('Nome do terreno'), 'Quinta')
    await userEvent.upload(screen.getByLabelText(/escolher a fotografia do terreno/i), new File(['x'], 'f.png', { type: 'image/png' }))
    await userEvent.click(screen.getByRole('button', { name: 'Criar o terreno' }))
    expect(await screen.findByRole('heading', { name: '2 · Marcar a escala' })).toBeInTheDocument()
  })

  it('saves name and watering interval, keeping the scale', async () => {
    const api = fakeApi({
      'GET /api/field': () => ({ status: 200, body: field }),
      'PUT /api/field': ({ body }) => ({ status: 200, body: { ...field, ...(body as object) } }),
    })
    renderApp('/field')
    const days = await screen.findByLabelText('As zonas precisam de rega de quantos em quantos dias')
    await userEvent.clear(days)
    await userEvent.type(days, '0')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('A rega é de 1 em 1 dia até de 365 em 365 dias.')
    await userEvent.clear(days)
    await userEvent.type(days, '4')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Terreno guardado.')).toBeInTheDocument()
    expect(api.calls.find((c) => c.method === 'PUT')?.body).toEqual({
      name: 'Quinta',
      calibration_line: null,
      calibration_length_m: null,
      default_water_interval_days: 4,
    })
  })

  it('without a connection, keeps the change on the phone and frees the form', async () => {
    const api = fakeApi({ 'GET /api/field': () => ({ status: 200, body: field }) })
    renderApp('/field')
    const name = await screen.findByLabelText('Nome do terreno', { selector: 'input' })
    api.fetchMock.mockImplementation(async (input) => {
      if (String(input) === '/healthz') return new Response('{"status":"ok"}')
      throw new TypeError('Failed to fetch')
    })
    await userEvent.clear(name)
    await userEvent.type(name, 'Quinta Nova')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText(/Guardado neste telemóvel/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled()
    expect(screen.getByText(/1 alteração guardada neste telemóvel/)).toBeInTheDocument()
  })
})
