import { QueryClient } from '@tanstack/react-query'
import { registerFieldMutations } from '../api/field'
import { registerSpeciesMutations } from '../api/species'

export function newQueryClient(options: { retry?: boolean } = {}) {
  const qc = new QueryClient({
    defaultOptions: {
      // Field connections are flaky: a couple of quiet retries before showing an error.
      queries: { retry: options.retry === false ? false : 2, staleTime: 30_000 },
    },
  })
  registerSpeciesMutations(qc)
  registerFieldMutations(qc)
  return qc
}
