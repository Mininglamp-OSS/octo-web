import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getCurrentImUnreadCount } from '@octo/base'
import { getElectronUnreadMessageCount } from '../electronUnreadCount'

vi.mock('@octo/base', () => ({
  getCurrentImUnreadCount: vi.fn(),
}))

beforeEach(() => vi.mocked(getCurrentImUnreadCount).mockReset())

describe('legacy Electron unread export', () => {
  it('delegates to the shared business selector', () => {
    vi.mocked(getCurrentImUnreadCount).mockReturnValue(7)
    expect(getElectronUnreadMessageCount()).toBe(7)
    expect(getCurrentImUnreadCount).toHaveBeenCalledOnce()
  })

  it('does not cache the previous snapshot in the app facade', () => {
    vi.mocked(getCurrentImUnreadCount).mockReturnValueOnce(4).mockReturnValueOnce(0)
    expect(getElectronUnreadMessageCount()).toBe(4)
    expect(getElectronUnreadMessageCount()).toBe(0)
  })
})
