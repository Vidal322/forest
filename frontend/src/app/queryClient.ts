import { QueryClient } from '@tanstack/react-query'
import { registerFieldMutations } from '../api/field'
import { activities } from '../api/activities'
import { plots, zones } from '../api/plots'
import { species } from '../api/species'

export function newQueryClient(options: { retry?: boolean } = {}) {
  const qc = new QueryClient({
    defaultOptions: {
      // Field connections are flaky: a couple of quiet retries before showing an error.
      queries: { retry: options.retry === false ? false : 2, staleTime: 30_000 },
    },
  })
  species.register(qc)
  plots.register(qc)
  zones.register(qc)
  activities.register(qc)
  registerFieldMutations(qc)
  return qc
}
