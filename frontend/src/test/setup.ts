import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

// Mount like production does (main.tsx renders inside <StrictMode>).
configure({ reactStrictMode: true })

afterEach(() => {
  cleanup()
})
