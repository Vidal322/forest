import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiGet } from './client'

type FetchFn = (input: string, init: RequestInit) => Promise<Response>

/** Every call gets a fresh Response (a body can only be read once). */
function respond(status: number, body: string | null, headers: Record<string, string> = {}) {
  const fetchMock = vi.fn<FetchFn>(() => Promise.resolve(new Response(body, { status, headers })))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.useRealTimers()
})

describe('apiGet', () => {
  it('returns parsed JSON and asks for JSON', async () => {
    const fetchMock = respond(200, '{"status":"ok"}')
    await expect(apiGet('/healthz')).resolves.toEqual({ status: 'ok' })
    const init = fetchMock.mock.calls[0]![1]
    expect(new Headers(init.headers).get('Accept')).toBe('application/json')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('returns undefined for 204 No Content', async () => {
    respond(204, null)
    await expect(apiGet('/api/x')).resolves.toBeUndefined()
  })

  it('turns a non-JSON 200 (captive portal, SPA fallback) into bad_response', async () => {
    respond(200, '<html>Welcome to Café WiFi</html>', { 'X-Request-Id': 'r1' })
    await expect(apiGet('/healthz')).rejects.toMatchObject({ name: 'ApiError', status: 200, code: 'bad_response', requestId: 'r1' })
  })

  it('turns the backend error body into an ApiError with its code and request id', async () => {
    respond(404, '{"error":{"code":"not_found","message":"no such endpoint"}}', { 'X-Request-Id': 'abc123' })
    const err = await apiGet('/api/nope').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 404, code: 'not_found', message: 'no such endpoint', requestId: 'abc123' })
  })

  it('copes with a non-JSON error page', async () => {
    respond(502, '<html>Bad Gateway</html>')
    await expect(apiGet('/api/x')).rejects.toMatchObject({ status: 502, code: 'unknown' })
  })

  it('reports network failures with code "network"', async () => {
    vi.stubGlobal('fetch', vi.fn<FetchFn>(() => Promise.reject(new TypeError('Failed to fetch'))))
    await expect(apiGet('/healthz')).rejects.toMatchObject({ status: 0, code: 'network' })
  })

  it('gives up after timeoutMs with code "timeout"', async () => {
    // a fetch that never answers on its own, only rejects when its signal aborts
    vi.stubGlobal('fetch', vi.fn<FetchFn>((_: string, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason)))))
    await expect(apiGet('/healthz', { timeoutMs: 20 })).rejects.toMatchObject({ code: 'timeout' })
  })

  it('re-throws a caller abort untouched (with its reason), never as a network error', async () => {
    vi.stubGlobal('fetch', vi.fn<FetchFn>((_: string, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason)))))
    const ctrl = new AbortController()
    const p = apiGet('/healthz', { signal: ctrl.signal })
    ctrl.abort(new Error('user left the page'))
    await expect(p).rejects.toThrow('user left the page')
  })
})
