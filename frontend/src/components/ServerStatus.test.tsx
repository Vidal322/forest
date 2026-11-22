import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ServerStatus } from './ServerStatus'

type FetchFn = (input: string, init: RequestInit) => Promise<Response>

const ok: FetchFn = () => Promise.resolve(new Response('{"status":"ok"}', { status: 200 }))
const down: FetchFn = () => Promise.reject(new TypeError('Failed to fetch'))

function setOnline(value: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  setOnline(true)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('ServerStatus', () => {
  it('shows Online when /healthz answers', async () => {
    vi.stubGlobal('fetch', vi.fn<FetchFn>(ok))
    render(<ServerStatus />)
    expect(screen.getByText('Connecting…')).toBeInTheDocument()
    expect(await screen.findByText('Online')).toBeInTheDocument()
  })

  it('says "Server unreachable" when the device is online but the API is not', async () => {
    vi.stubGlobal('fetch', vi.fn<FetchFn>(down))
    render(<ServerStatus />)
    expect(await screen.findByText('Server unreachable')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/retrying automatically/)
  })

  it('says "No connection" without even trying when the device is offline', async () => {
    setOnline(false)
    const fetchMock = vi.fn<FetchFn>(ok)
    vi.stubGlobal('fetch', fetchMock)
    render(<ServerStatus />)
    expect(await screen.findByText('No connection')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not trust a 200 that is not our health body (captive portal)', async () => {
    vi.stubGlobal('fetch', vi.fn<FetchFn>(() => Promise.resolve(new Response('{"hello":"portal"}', { status: 200 }))))
    render(<ServerStatus />)
    expect(await screen.findByText('Server unreachable')).toBeInTheDocument()
  })

  it('recovers on the next poll and announces it', async () => {
    const fetchMock = vi.fn<FetchFn>(down)
    vi.stubGlobal('fetch', fetchMock)
    render(<ServerStatus intervalMs={1000} />)
    expect(await screen.findByText('Server unreachable')).toBeInTheDocument()

    fetchMock.mockImplementation(ok)
    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(await screen.findByText('Online')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Back online.')
  })

  it('stays quiet for screen readers on a normal load', async () => {
    vi.stubGlobal('fetch', vi.fn<FetchFn>(ok))
    render(<ServerStatus />)
    await screen.findByText('Online')
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('checks immediately when the device comes back online', async () => {
    const fetchMock = vi.fn<FetchFn>(down)
    vi.stubGlobal('fetch', fetchMock)
    render(<ServerStatus intervalMs={60_000} />)
    await screen.findByText('Server unreachable')

    fetchMock.mockImplementation(ok)
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(await screen.findByText('Online')).toBeInTheDocument()
  })

  it('does not poll while the tab is hidden', async () => {
    const fetchMock = vi.fn<FetchFn>(ok)
    vi.stubGlobal('fetch', fetchMock)
    render(<ServerStatus intervalMs={1000} />)
    await screen.findByText('Online')
    const callsBefore = fetchMock.mock.calls.length

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await act(() => vi.advanceTimersByTimeAsync(5000))
    expect(fetchMock.mock.calls.length).toBe(callsBefore)
  })

  it('a slow old check cannot overwrite a newer result', async () => {
    let releaseSlow: (r: Response) => void = () => {}
    const fetchMock = vi.fn<FetchFn>((_: string, init: RequestInit) => {
      if (fetchMock.mock.calls.length === 1 || fetchMock.mock.calls.length === 2) {
        // first mount checks (StrictMode mounts twice): hang until released or aborted
        return new Promise<Response>((resolve, reject) => {
          releaseSlow = resolve
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        })
      }
      return Promise.resolve(new Response('{"status":"ok"}', { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ServerStatus intervalMs={60_000} />)

    act(() => {
      window.dispatchEvent(new Event('online')) // starts a newer check, which answers ok
    })
    expect(await screen.findByText('Online')).toBeInTheDocument()

    // the old request finally "answers" with an error page — must be ignored
    releaseSlow(new Response('oops', { status: 500 }))
    await act(() => vi.advanceTimersByTimeAsync(10))
    expect(screen.getByText('Online')).toBeInTheDocument()
  })

  it('aborts its request and stops polling when unmounted', async () => {
    const signals: AbortSignal[] = []
    const fetchMock = vi.fn<FetchFn>((_: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal)
      return new Promise<Response>(() => {})
    })
    vi.stubGlobal('fetch', fetchMock)
    const { unmount } = render(<ServerStatus intervalMs={1000} />)
    unmount()

    expect(signals.length).toBeGreaterThan(0)
    expect(signals.every((s) => s.aborted)).toBe(true)
    const calls = fetchMock.mock.calls.length
    await act(() => vi.advanceTimersByTimeAsync(5000))
    expect(fetchMock.mock.calls.length).toBe(calls)
  })
})
