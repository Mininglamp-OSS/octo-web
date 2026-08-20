import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
const scanRoots = ['apps', 'packages']
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx'])
const styleExtensions = new Set(['.css'])
const ignoredSegments = new Set([
  'node_modules',
  'dist',
  'build',
  'build-e2e',
  '.turbo',
  '.vite',
  '.output',
  'public',
])

const allowedSemiDropdownFiles = new Set([
  'packages/octo-ui/src/components/Dropdown/index.tsx',
  'packages/octo-ui/src/components/Dropdown/Dropdown.test.tsx',
])

const legacyMenuSelectorPatterns = [
  /\.wk-move-to-group-menu__item\b/,
  /\.wk-move-to-group-menu__divider\b/,
  /\.wk-slash-command-item-active\b/,
  /\.wk-navrail__flyout-item\b/,
  /\.wk-contextmenus\s+li\b/,
  /\.wk-ctx-submenu\s+li\b/,
  /\.semi-dropdown(?:-item|-menu)?\b/,
]

function extname(file) {
  const index = file.lastIndexOf('.')
  return index >= 0 ? file.slice(index) : ''
}

function listFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (ignoredSegments.has(entry)) continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      listFiles(full, out)
      continue
    }

    const ext = extname(entry)
    if (sourceExtensions.has(ext) || styleExtensions.has(ext)) {
      out.push(full)
    }
  }
  return out
}

function lineNumber(source, index) {
  return source.slice(0, index).split('\n').length
}

const violations = []

for (const scanRoot of scanRoots) {
  const absRoot = join(root, scanRoot)
  for (const file of listFiles(absRoot)) {
    const rel = relative(root, file)
    const source = readFileSync(file, 'utf8')
    const ext = extname(file)

    if (sourceExtensions.has(ext) && !allowedSemiDropdownFiles.has(rel)) {
      const importPattern = /import\s*\{([\s\S]*?)\}\s*from\s*["']@douyinfe\/semi-ui["']/g
      let match
      while ((match = importPattern.exec(source))) {
        const specifiers = match[1].split(',').map((part) => part.trim().replace(/\s+as\s+\w+$/, ''))
        if (specifiers.includes('Dropdown')) {
          violations.push(`${rel}:${lineNumber(source, match.index)} imports Semi Dropdown; use @octo/ui Dropdown`)
        }
      }
    }

    if (styleExtensions.has(ext)) {
      for (const pattern of legacyMenuSelectorPatterns) {
        const match = pattern.exec(source)
        if (match) {
          violations.push(`${rel}:${lineNumber(source, match.index)} keeps legacy menu selector ${pattern}`)
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Octo UI Dropdown usage check failed:')
  for (const violation of violations) {
    console.error(`- ${violation}`)
  }
  process.exit(1)
}

console.log('Octo UI Dropdown usage check passed.')
