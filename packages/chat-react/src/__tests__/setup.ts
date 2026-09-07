import { afterEach } from 'vitest'
import '@testing-library/jest-dom'
import { cleanup } from './testingLibraryReact17'

afterEach(() => {
  cleanup()
})
