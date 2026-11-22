import { vi } from 'vitest'

type Handler = (req: { method: string; path: string; body: unknown }) => { status: number; body?: unknown }

/**
 * Stubs fetch with a tiny in-memory API. Unmatched requests answer 404 in the
 * server's error shape; /healthz answers ok so the status pill stays quiet.
 */
export function fakeApi(routes: Record<string, Handler>) {
  const calls: { method: string; path: string; body: unknown }[] = []
  const fetchMock = vi.fn<typeof fetch>(async (input, init = {}) => {
    const path = String(input)
    const method = (init.method ?? 'GET').toUpperCase()
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ method, path, body })
    if (path === '/healthz') return json(200, { status: 'ok' })
    for (const [pattern, handler] of Object.entries(routes)) {
      const [m, p] = pattern.split(' ')
      if (m === method && new RegExp(`^${p}$`).test(path)) {
        const res = handler({ method, path, body })
        return res.status === 204 ? new Response(null, { status: 204 }) : json(res.status, res.body)
      }
    }
    return json(404, { error: { code: 'not_found' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, fetchMock }
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
