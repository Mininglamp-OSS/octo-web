import '@testing-library/react'
import { afterEach } from 'vitest'

// fake-indexeddb gives jsdom a working IndexedDB for offline-cache tests.
import 'fake-indexeddb/auto'

afterEach(() => {
  // Each test owns its own DOM/mocks; keep teardown minimal here.
})
