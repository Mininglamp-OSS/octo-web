/**
 * config.mjs — 统一配置读取
 *
 * 读取 AGENTS.config.json（仅 branch 配置）+ AGENTS.config.local.json（个人环境）
 * 其他配置使用内置默认值。所有脚本通过 import { config } from './config.mjs' 使用
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

function readJSON(filePath) {
  if (!existsSync(filePath)) return {}
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch (e) {
    console.error(`⚠️  读取配置失败: ${filePath}`)
    console.error(`   ${e.message}`)
    return {}
  }
}

const project = readJSON(resolve(ROOT, 'AGENTS.config.json'))
const local = readJSON(resolve(ROOT, 'AGENTS.config.local.json'))

export const ROOT_DIR = ROOT

export const config = {
  // 默认架构路径（作为 gen:component 脚手架默认值）
  uiDir: resolve(ROOT, project.ui_dir || 'packages/dmworkbase/src/ui/'),
  bridgeDir: resolve(ROOT, project.bridge_dir || 'packages/dmworkbase/src/bridge/'),
  cssPrefix: project.css_prefix || 'wk',

  // 分支规范
  branchTypes: project.branch?.types || ['feat', 'fix', 'refactor', 'chore', 'docs', 'test'],
  defaultBase: project.branch?.defaultBase || 'origin/develop',

  // 本地环境（从 AGENTS.config.local.json，有合理默认值）
  worktreeParent: local.worktree?.parent || resolve(ROOT, '..'),
  worktreeSymlinks: local.worktree?.symlinks || [],
  remote: local.remote || 'origin',
}
