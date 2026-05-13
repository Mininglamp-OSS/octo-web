#!/usr/bin/env node

/**
 * gen:component — 生成 ui/ + bridge/ 组件脚手架
 *
 * 用法：
 *   pnpm gen:component MessageBubble
 *   pnpm gen:component MessageBubble --ui-only  # 只生成 ui/，不生成 bridge/
 *
 * 路径由 AGENTS.config.json 中的 ui_dir / bridge_dir 决定（如果配置存在），
 * 否则使用内置默认值。
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { config, ROOT_DIR } from './config.mjs'

// ── Parse args ──
const args = process.argv.slice(2)
const flags = new Set(args.filter(a => a.startsWith('--')))
const positional = args.filter(a => !a.startsWith('--'))

if (positional.length === 0) {
  console.error('❌ 用法: pnpm gen:component <ComponentName> [--ui-only]')
  console.error('')
  console.error('  --ui-only   只生成 ui/ 层，不生成 bridge/')
  console.error('')
  console.error(`  ui 目录:     ${relative(ROOT_DIR, config.uiDir)}`)
  console.error(`  bridge 目录: ${relative(ROOT_DIR, config.bridgeDir)}`)
  process.exit(1)
}

const name = positional[0]
const uiOnly = flags.has('--ui-only')

// 校验命名：PascalCase
if (!/^[A-Z][a-zA-Z0-9]+$/.test(name)) {
  console.error(`❌ 组件名必须是 PascalCase，例如 MessageBubble。收到: "${name}"`)
  process.exit(1)
}

const uiDir = join(config.uiDir, name)
const bridgeDir = join(config.bridgeDir, name)

// ── 检查冲突 ──
if (existsSync(uiDir)) {
  console.error(`❌ ui/${name}/ 已存在: ${relative(ROOT_DIR, uiDir)}`)
  process.exit(1)
}
if (!uiOnly && existsSync(bridgeDir)) {
  console.error(`❌ bridge/${name}/ 已存在: ${relative(ROOT_DIR, bridgeDir)}`)
  process.exit(1)
}

// ── 文件模板 ──

const kebab = toKebab(name)
const prefix = config.cssPrefix

const uiTypes = `export interface ${name}Props {
  className?: string
}
`

const uiIndex = `import React from 'react'
import type { ${name}Props } from './types'
import './index.css'

const ${name}: React.FC<${name}Props> = ({ className }) => {
  return (
    <div className={\`${prefix}-${kebab}\${className ? ' ' + className : ''}\`}>
      ${name}
    </div>
  )
}

export default ${name}
`

const uiCss = `.${prefix}-${kebab} {
  /* TODO: 样式 */
}
`

const uiStory = `import type { Meta, StoryObj } from '@storybook/react-vite'
import ${name} from './index'

const meta: Meta<typeof ${name}> = {
  title: 'Base/${name}',
  component: ${name},
  parameters: {
    docs: {
      description: {
        component: '${name} 组件。',
      },
    },
  },
}

export default meta
type Story = StoryObj<typeof ${name}>

export const Default: Story = {
  name: '默认',
  args: {},
}
`

// bridge/types.ts → ui/types.ts 的相对路径（从文件所在目录算）
const bridgeFileDir = join(config.bridgeDir, name)        // bridge/<Name>/
const uiTypesTarget = join(config.uiDir, name, 'types')   // ui/<Name>/types
const uiRelFromBridge = relative(bridgeFileDir, uiTypesTarget)

const bridgeTypes = `import type { ${name}Props } from '${uiRelFromBridge}'

/**
 * Bridge 层 props — 如果需要额外字段在此扩展，
 * 否则直接复用 ui 层的 ${name}Props
 */
export type ${name}BridgeProps = ${name}Props
`

const hookName = `use${name}`
const bridgeHook = `import { useMemo } from 'react'
import type { ${name}BridgeProps } from './types'

/**
 * ${hookName} — 连接 SDK 数据和 ${name} UI 组件
 *
 * TODO: 实现 SDK 数据获取和转换逻辑
 */
export function ${hookName}(): ${name}BridgeProps {
  return useMemo(() => {
    return {
      // TODO: 从 SDK 获取数据，转换为 UI props
    }
  }, [])
}
`

// ── 写文件 ──

function writeFile(filePath, content) {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf-8')
  console.log(`  ✅ ${relative(ROOT_DIR, filePath)}`)
}

console.log(`\n🔨 生成组件: ${name}\n`)
console.log(`📁 ui:     ${relative(ROOT_DIR, config.uiDir)}`)
console.log(`📁 bridge: ${relative(ROOT_DIR, config.bridgeDir)}\n`)

writeFile(join(uiDir, 'types.ts'), uiTypes)
writeFile(join(uiDir, 'index.tsx'), uiIndex)
writeFile(join(uiDir, 'index.css'), uiCss)
writeFile(join(uiDir, `${name}.stories.tsx`), uiStory)

if (!uiOnly) {
  writeFile(join(bridgeDir, 'types.ts'), bridgeTypes)
  writeFile(join(bridgeDir, `${hookName}.ts`), bridgeHook)
}

console.log(`\n✨ 完成！`)
if (!uiOnly) {
  console.log(`\n下一步:`)
  console.log(`  1. 编辑 ui/${name}/types.ts 定义 props`)
  console.log(`  2. 实现 ui/${name}/index.tsx 纯 UI`)
  console.log(`  3. pnpm storybook 预览 Story`)
  console.log(`  4. 实现 bridge/${name}/${hookName}.ts 连接 SDK`)
}

// ── Utils ──

function toKebab(str) {
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
}
