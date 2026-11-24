import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderApp } from '../test/render'

function stubFetch(csv: () => Response) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const path = String(input)
    if (path === '/healthz') return Response.json({ status: 'ok' })
    if (path === '/api/export/activities.csv') return csv()
    return Response.json({ error: { code: 'not_found' } }, { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('MorePage export', () => {
  it('downloads the activity log under the name the server gives', async () => {
    stubFetch(
      () =>
        new Response('\uFEFFDate,Type\r\n', {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="forest-activities-2026-11-24.csv"',
          },
        }),
    )
    const createObjectURL = vi.fn<(obj: Blob) => string>(() => 'blob:csv')
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = createObjectURL
        static revokeObjectURL = vi.fn<(url: string) => void>()
      },
    )
    const clicked: HTMLAnchorElement[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this)
    })
    renderApp('/more')
    await userEvent.click(await screen.findByRole('button', { name: /download csv/i }))
    await waitFor(() => expect(clicked).toHaveLength(1))
    expect(clicked[0]!.download).toBe('forest-activities-2026-11-24.csv')
    expect(clicked[0]!.href).toBe('blob:csv')
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says so when there is no connection, and the button works again', async () => {
    stubFetch(() => {
      throw new TypeError('Failed to fetch')
    })
    renderApp('/more')
    const button = await screen.findByRole('button', { name: /download csv/i })
    await userEvent.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent(/no connection/i)
    expect(button).toBeEnabled()
  })

  it('refuses a page that is not the CSV (a captive portal)', async () => {
    stubFetch(() => new Response('<html>Login</html>', { headers: { 'Content-Type': 'text/html' } }))
    renderApp('/more')
    await userEvent.click(await screen.findByRole('button', { name: /download csv/i }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
