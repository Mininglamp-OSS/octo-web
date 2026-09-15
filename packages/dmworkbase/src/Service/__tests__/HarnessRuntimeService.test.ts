import { beforeEach, describe, expect, it, vi } from 'vitest'

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))

vi.mock('../APIClient', () => ({
  default: { shared: { get, post } },
}))

import {
  buildHarnessProfile,
  buildHarnessLoginCommand,
  createHarnessDeviceEnrollment,
  isValidHarnessProfile,
  listHarnessRuntimes,
} from '../HarnessRuntimeService'

describe('HarnessRuntimeService', () => {
  beforeEach(() => {
    get.mockReset()
    post.mockReset()
  })

  it('lists the current user runtimes through the agentworker facade', async () => {
    const items = [{ id: 'runtime-1' }]
    get.mockResolvedValue({ items })

    await expect(listHarnessRuntimes('http://localhost:3000/agentworker')).resolves.toBe(items)
    expect(get).toHaveBeenCalledWith('http://localhost:3000/agentworker/api/v1/runtimes', { signal: undefined })
  })

  it('creates an enrollment without sending profile or runtime metadata', async () => {
    const enrollment = { enrollment_token: 'octo_enroll_secret', octo_space_id: 'space-1', owner_user_id: 'user-1', expires_at: '2026-09-14T10:00:00Z' }
    post.mockResolvedValue(enrollment)

    await expect(createHarnessDeviceEnrollment('http://localhost:3000/agentworker/')).resolves.toBe(enrollment)
    expect(post).toHaveBeenCalledWith('http://localhost:3000/agentworker/api/v1/device_enrollments', {})
  })

  it('rejects an SPA fallback instead of presenting it as an empty list', async () => {
    get.mockResolvedValue('<!doctype html>')
    await expect(listHarnessRuntimes('http://localhost:3000/agentworker')).rejects.toThrow('Invalid runtime list response')
  })

  it('validates harness profile names and reserved paths', () => {
    expect(isValidHarnessProfile('production.cn-1')).toBe(true)
    expect(isValidHarnessProfile('profiles')).toBe(false)
    expect(isValidHarnessProfile('../escape')).toBe(false)
    expect(isValidHarnessProfile('')).toBe(false)
  })

  it('derives a stable profile from the enrollment space and user', () => {
    expect(buildHarnessProfile('space_01', 'user_02')).toBe('space_01_user_02')
    const longProfile = buildHarnessProfile(`space_${'a'.repeat(80)}`, `user_${'b'.repeat(80)}`)
    expect(longProfile).toHaveLength(64)
    expect(isValidHarnessProfile(longProfile)).toBe(true)
    expect(buildHarnessProfile(`space_${'a'.repeat(80)}`, `user_${'b'.repeat(80)}`)).toBe(longProfile)
  })

  it('builds a POSIX command with generated profile and automatic server URL', () => {
    const command = buildHarnessLoginCommand({
      profile: 'space_01_user_02',
      origin: 'https://im-test.deepminer.com.cn/',
      enrollmentToken: 'octo_enroll_posix',
      shell: 'posix',
    })

    expect(command).toContain("--server-url 'https://im-test.deepminer.com.cn'")
    expect(command).not.toContain('--agent-work-url')
    expect(command).toContain("--profile 'space_01_user_02' login")
    expect(command).not.toContain('--runtime-name')
    expect(command).toContain('--enroll-token-stdin')
    expect(command).toContain("<<< 'octo_enroll_posix'")
    expect(command).toMatch(/^octo-harness /)
    expect(command.match(/octo-harness/g)).toHaveLength(1)
    expect(command).not.toContain('daemon install')
    expect(command).not.toContain('daemon start')
  })

  it('uses PowerShell continuation and escaping when requested', () => {
    const command = buildHarnessLoginCommand({
      profile: 'default',
      origin: 'https://im-test.deepminer.com.cn',
      enrollmentToken: "octo_enroll_'quoted'",
      shell: 'powershell',
    })

    expect(command).toContain(' `\n  --server-url')
    expect(command).toContain("'octo_enroll_''quoted''' | octo-harness")
  })
})
