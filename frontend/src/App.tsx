import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { useEffect, useState } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { persistOptions, resumeOutbox, saveWhenHidden } from './app/persist'
import { newQueryClient } from './app/queryClient'
import { routes } from './app/routes'

export default function App() {
  const [queryClient] = useState(newQueryClient)
  const [router] = useState(() => createBrowserRouter(routes))
  const [persist] = useState(persistOptions)
  useEffect(() => saveWhenHidden(queryClient, persist), [queryClient, persist])
  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persist} onSuccess={() => resumeOutbox(queryClient)}>
      <RouterProvider router={router} />
    </PersistQueryClientProvider>
  )
}
