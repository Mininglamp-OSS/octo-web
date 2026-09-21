import APIClient from './APIClient'
import type { HarnessCommandShell, HarnessRuntimeStatus } from '../ui/HarnessRuntimeSettings/types'

const PROFILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const RESERVED_PROFILES = new Set([
  'config.json', 'credentials', 'identity', 'logs', 'octo-daemon.pid',
  'profiles', 'run', 'setup', 'sockets', 'state.db',
])

export interface HarnessRuntimeDevice {
  os?: string
  arch?: string
  hostname?: string
  fingerprint?: string
}

export interface HarnessRuntime {
  id: string
  machine_id: string
  octo_space_id: string
  owner_ref: string
  kind: 'local' | 'cloud' | 'team'
  name: string
  profile?: string
  device: HarnessRuntimeDevice
  status: HarnessRuntimeStatus
  runtime_version?: string
  protocol_version: number
  capabilities: unknown
  last_heartbeat_at?: string
  registered_at: string
  updated_at: string
  deregistered_at?: string
}

export interface HarnessRuntimeAdapter {
  available: boolean
  provider_type: string
  provider_version?: string | null
}

export function availableRuntimeAdapters(capabilities: unknown): HarnessRuntimeAdapter[] {
  if (!capabilities || typeof capabilities !== 'object' || !('adapters' in capabilities)) return []
  if (!Array.isArray(capabilities.adapters)) return []
  return capabilities.adapters.filter((adapter): adapter is HarnessRuntimeAdapter =>
    adapter !== null && typeof adapter === 'object' && adapter.available === true
    && typeof adapter.provider_type === 'string' && adapter.provider_type.trim().length > 0)
}

export interface DeviceEnrollment {
  enrollment_token: string
  octo_space_id: string
  created_by_octo_uid: string
  owner_subject_type: 'user' | 'organization'
  owner_subject_id: string
  kind: 'local' | 'cloud'
  expires_at: string
}

function agentWorkerEndpoint(agentWorkerURL: string, path: string): string {
  return `${agentWorkerURL.replace(/\/$/, '')}/api/v1/${path}`
}

export async function listHarnessRuntimes(agentWorkerURL: string, signal?: AbortSignal): Promise<HarnessRuntime[]> {
  const response = await APIClient.shared.get<{ items?: HarnessRuntime[] }>(agentWorkerEndpoint(agentWorkerURL, 'runtimes'), { signal })
  if (!Array.isArray(response?.items)) throw new Error('Invalid runtime list response')
  return response.items
}

export async function createHarnessDeviceEnrollment(agentWorkerURL: string): Promise<DeviceEnrollment> {
  const response = await APIClient.shared.post(agentWorkerEndpoint(agentWorkerURL, 'runtime_enrollments'), {
    kind: 'local',
  }) as DeviceEnrollment
  if (!response?.enrollment_token || !response?.octo_space_id || !response?.expires_at
    || typeof response.owner_subject_id !== 'string' || !response.owner_subject_id.trim()) {
    throw new Error('Invalid device enrollment response')
  }
  return response
}

export function isValidHarnessProfile(profile: string): boolean {
  return PROFILE_PATTERN.test(profile) && !RESERVED_PROFILES.has(profile.toLowerCase())
}

function profilePart(value: string, fallback: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '')
  return normalized || fallback
}

function profileHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function buildHarnessProfile(spaceID: string, userID: string): string {
  const space = profilePart(spaceID, 'space')
  const user = profilePart(userID, 'user')
  const profile = `${space}_${user}`
  if (profile.length <= 64 && isValidHarnessProfile(profile)) return profile
  return `${space.slice(0, 27)}_${user.slice(0, 27)}_${profileHash(`${spaceID}\0${userID}`)}`
}

function quotePosix(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export function buildHarnessLoginCommand(input: {
  profile: string
  origin: string
  enrollmentToken: string
  shell: HarnessCommandShell
}): string {
  const origin = input.origin.replace(/\/$/, '')
  const profile = input.profile
  const continuation = input.shell === 'powershell' ? '`' : '\\'
  const lineBreak = ` ${continuation}\n  `
  const quote = input.shell === 'powershell' ? quotePowerShell : quotePosix
  const setupParts = [
    `octo-harness --profile ${quote(profile)} login`,
    `--server-url ${quote(origin)}`,
    '--enroll-token-stdin',
  ]

  if (input.shell === 'powershell') {
    const setup = setupParts.join(lineBreak)
    return `${quote(input.enrollmentToken)} | ${setup}`
  }

  const setup = setupParts.join(` ${continuation}\n  `)
  return `${setup} <<< ${quote(input.enrollmentToken)}`
}

export function buildHarnessOpenClawSetupCommand(profile: string): string {
  return [
    "printf 'OpenClaw Gateway token: ' &&",
    'IFS= read -rs OCTO_OPENCLAW_GATEWAY_TOKEN &&',
    "printf '\\n' &&",
    `printf '%s\\n' "$OCTO_OPENCLAW_GATEWAY_TOKEN" |`,
    `  octo-harness --profile ${quotePosix(profile)} adapter setup openclaw \\`,
    "  --gateway-url 'ws://127.0.0.1:18789' \\",
    '  --token-stdin',
    'unset OCTO_OPENCLAW_GATEWAY_TOKEN',
  ].join('\n')
}
