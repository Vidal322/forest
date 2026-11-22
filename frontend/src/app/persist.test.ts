import { dehydrate, hydrate } from '@tanstack/react-query'
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client'
import { describe, expect, it, vi } from 'vitest'
import { fakeApi } from '../test/fakeApi'
import { CACHE_VERSION, dehydrateOptions, keepingOutbox, KEEP_FOR_MS, resumeOutbox } from './persist'
import { newQueryClient } from './queryClient'

const input = (name: string) => ({ scientific_name: name, common_name: null, notes: null })

describe('saved outbox', () => {
  it('changes made without signal survive a restart and are sent once, in order', async () => {
    // phone A: no signal — two saves wait in the outbox
    const offline = vi.fn<typeof fetch>(() => Promise.reject(new TypeError('Failed to fetch')))
    vi.stubGlobal('fetch', offline)
    const a = newQueryClient({ retry: false })
    const m = a.getMutationCache()
    void m.build(a, { mutationKey: ['species', 'save'] }).execute({ id: 'id-1', input: input('First') }).catch(() => {})
    void m.build(a, { mutationKey: ['species', 'save'] }).execute({ id: 'id-2', input: input('Second') }).catch(() => {})
    await vi.waitFor(() => expect(offline).toHaveBeenCalled())

    const saved = JSON.parse(JSON.stringify(dehydrate(a, dehydrateOptions)))
    expect(saved.mutations).toHaveLength(2)
    a.clear()

    // the app is reopened with signal
    const api = fakeApi({ 'PUT /api/species/[^/]+': ({ path, body }) => ({ status: 201, body: { id: path.split('/').pop(), ...(body as object), updated_at: 'x' } }) })
    const b = newQueryClient({ retry: false })
    hydrate(b, saved)
    resumeOutbox(b)
    await vi.waitFor(() => expect(api.calls.filter((c) => c.method === 'PUT')).toHaveLength(2))
    await new Promise((r) => setTimeout(r, 50))
    const puts = api.calls.filter((c) => c.method === 'PUT')
    expect(puts.map((c) => c.path)).toEqual(['/api/species/id-1', '/api/species/id-2'])
    expect(b.getMutationCache().getAll().every((x) => x.state.status === 'success')).toBe(true)
  })

  it('keeps queued changes when the saved data is too old or from another version', async () => {
    const old: PersistedClient = {
      buster: 'forest-0',
      timestamp: 0,
      clientState: { queries: [{ queryKey: ['species'] } as never], mutations: [{ mutationKey: ['species', 'save'] } as never] },
    }
    const base: Persister = { persistClient: async () => {}, restoreClient: async () => old, removeClient: async () => {} }
    const restored = await keepingOutbox(base, () => KEEP_FOR_MS * 2).restoreClient()
    expect(restored?.buster).toBe(CACHE_VERSION)
    expect(restored?.clientState.queries).toHaveLength(0)
    expect(restored?.clientState.mutations).toHaveLength(1)
  })

  it('also keeps a list whose last refresh failed', () => {
    const qc = newQueryClient({ retry: false })
    qc.setQueryData(['zones'], [{ id: 'z' }])
    qc.getQueryCache().find({ queryKey: ['zones'] })!.setState({ status: 'error', error: new Error('timeout') })
    expect(dehydrate(qc, dehydrateOptions).queries.map((q) => q.queryKey)).toContainEqual(['zones'])
  })
})
