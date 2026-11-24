import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'
import { forgetRemembered } from '../app/remembered'

// Mount like production does (main.tsx renders inside <StrictMode>).
configure({ reactStrictMode: true })

afterEach(() => {
  cleanup()
  forgetRemembered()
  localStorage.clear() // settings kept on the device (map layers)
})
