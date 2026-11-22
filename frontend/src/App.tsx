import { QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { newQueryClient } from './app/queryClient'
import { routes } from './app/routes'

export default function App() {
  const [queryClient] = useState(newQueryClient)
  const [router] = useState(() => createBrowserRouter(routes))
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}
