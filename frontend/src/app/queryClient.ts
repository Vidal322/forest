import { QueryClient } from '@tanstack/react-query'
import { registerFieldMutations } from '../api/field'
import { activities } from '../api/activities'
import { plots, zones } from '../api/plots'
import { species } from '../api/species'
import { wateringRules } from '../api/stats'
import { tasks } from '../api/tasks'
import { registerTreeMutations } from '../api/trees'

export function newQueryClient(options: { retry?: boolean } = {}) {
  const qc = new QueryClient({
    defaultOptions: {
      // Field connections are flaky: a couple of quiet retries before showing an error.
      queries: {
        retry: options.retry === false ? false : 2,
        staleTime: 30_000,
        // kept (and saved on the phone) through a long offline stretch. Not more than
        // ~24 days: timers above 2^31 ms overflow and would drop the cache at once.
        gcTime: 7 * 24 * 60 * 60 * 1000,
      },
    },
  })
  species.register(qc)
  plots.register(qc)
  zones.register(qc)
  activities.register(qc)
  tasks.register(qc)
  wateringRules.register(qc)
  registerTreeMutations(qc)
  registerFieldMutations(qc)
  return qc
}
