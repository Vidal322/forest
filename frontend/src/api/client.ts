// Thin fetch wrapper for the Forest API.
//
// Every failure becomes an ApiError with a stable `code`, so screens can show a
// friendly message instead of a stack trace:
//   - the backend's own {"error": {"code", "message"}} body, or
//   - "network"      the request never reached a server (no signal, DNS, …)
//   - "timeout"      no answer within timeoutMs (weak field connections)
//   - "bad_response" a 2xx that isn't the JSON we expect (captive portal page, …)
//   - "unknown"      an error status without our JSON body (proxy error page, …)
// Aborts requested by the caller are re-thrown untouched.

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly requestId: string | null
  /** The input field the server blamed (validation, duplicates), if any. */
  readonly field: string | null

  constructor(status: number, code: string, message: string, requestId: string | null, field: string | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.requestId = requestId
    this.field = field
  }

  /** True when the request never got an answer (worth retrying later). */
  get isOffline(): boolean {
    return this.code === 'network' || this.code === 'timeout'
  }
}

export type RequestOptions = RequestInit & { timeoutMs?: number }

const DEFAULT_TIMEOUT_MS = 10_000

type ErrorBody = { error?: { code?: unknown; message?: unknown; field?: unknown } }

export function apiGet<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return apiRequest<T>(path, { ...options, method: 'GET' })
}

/** PUT/POST/PATCH/DELETE with an optional JSON body. */
export function apiSend<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  return apiRequest<T>(path, {
    ...options,
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: callerSignal, headers, ...init } = options
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout

  let res: Response
  try {
    const h = new Headers(headers)
    if (!h.has('Accept')) h.set('Accept', 'application/json')
    res = await fetch(path, { ...init, signal, headers: h })
  } catch (err) {
    if (callerSignal?.aborted) throw callerSignal.reason ?? err // the caller cancelled: not an error to show
    if (timeout.aborted) throw new ApiError(0, 'timeout', 'The server took too long to answer', null)
    throw new ApiError(0, 'network', 'Could not reach the server', null)
  }

  const requestId = res.headers.get('X-Request-Id')
  const text = await res.text()

  if (!res.ok) {
    let code = 'unknown'
    let message = `Request failed (${res.status})`
    let field: string | null = null
    try {
      const body = JSON.parse(text) as ErrorBody
      if (typeof body.error?.code === 'string') code = body.error.code
      if (typeof body.error?.message === 'string') message = body.error.message
      if (typeof body.error?.field === 'string') field = body.error.field
    } catch {
      // not JSON (e.g. a proxy error page) — keep the generic message
    }
    throw new ApiError(res.status, code, message, requestId, field)
  }

  if (res.status === 204 || text === '') return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ApiError(res.status, 'bad_response', 'Unexpected response from the server', requestId)
  }
}
