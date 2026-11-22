import { QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { newQueryClient } from '../app/queryClient'
import { routes } from '../app/routes'

/** Renders the real app routes at `path`, with a fresh query cache and no retries. */
export function renderApp(path = '/') {
  const queryClient = newQueryClient({ retry: false })
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { ...result, router, queryClient }
}
