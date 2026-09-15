import codex from './assets/codex.svg'
import claudeCode from './assets/claude-code.svg'
import codebuddy from './assets/codebuddy.svg'
import hermes from './assets/hermes.svg'
import kiro from './assets/kiro.svg'
import kimiCode from './assets/kimi-code.svg'
import opencodeLight from './assets/opencode-light.svg'
import opencodeDark from './assets/opencode-dark.svg'
import openclaw from './assets/openclaw.svg'

interface ProviderIcon {
  name: string
  url: string
  darkURL?: string
  monochrome?: boolean
}

export const runtimeProviderIcons: ReadonlyMap<string, ProviderIcon> = new Map([
  ['codex', { name: 'Codex', url: codex, monochrome: true }],
  ['claude-code', { name: 'Claude Code', url: claudeCode }],
  ['codebuddy', { name: 'CodeBuddy', url: codebuddy }],
  ['hermes', { name: 'Hermes', url: hermes, monochrome: true }],
  ['kiro', { name: 'Kiro', url: kiro }],
  ['kimi-code', { name: 'Kimi Code', url: kimiCode, monochrome: true }],
  ['opencode', { name: 'OpenCode', url: opencodeLight, darkURL: opencodeDark }],
  ['openclaw', { name: 'OpenClaw', url: openclaw }],
])
