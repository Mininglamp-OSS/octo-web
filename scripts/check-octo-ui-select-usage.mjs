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

const allowedSemiSelectFiles = new Set([
  'packages/octo-ui/src/components/Select/index.tsx',
  'packages/octo-ui/src/components/Select/Select.test.tsx',
])

const allowedSemiSelectStyleFiles = new Set()

const legacySelectSelectorPatterns = [
  /\.semi-select(?:\b|-)/g,
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

function hasSelectSpecifier(specifierSource) {
  return specifierSource
    .split(',')
    .map((part) => part.trim().replace(/^type\s+/, '').replace(/\s+as\s+\w+$/, ''))
    .includes('Select')
}

function escapeRegExp(source) {
  return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const violations = []

for (const scanRoot of scanRoots) {
  const absRoot = join(root, scanRoot)
  for (const file of listFiles(absRoot)) {
    const rel = relative(root, file)
    const source = readFileSync(file, 'utf8')
    const ext = extname(file)

    if (sourceExtensions.has(ext) && !allowedSemiSelectFiles.has(rel)) {
      const namedImportPattern = /(?:^|\n)\s*import(?:\s+type)?\s*\{([^}]*)\}\s*from\s*["']@douyinfe\/semi-ui["']/g
      const exportPattern = /(?:^|\n)\s*export(?:\s+type)?\s*\{([^}]*)\}\s*from\s*["']@douyinfe\/semi-ui["']/g
      const defaultImportPattern = /(?:^|\n)\s*import\s+([A-Za-z_$][\w$]*)(?:\s*,\s*\{[^}]*\})?\s+from\s*["']@douyinfe\/semi-ui["']/g
      const namespaceImportPattern = /(?:^|\n)\s*import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*["']@douyinfe\/semi-ui["']/g
      const deepImportPattern = /(?:^|\n)\s*import(?:\s+type)?[\s\S]*?from\s*["']@douyinfe\/semi-ui\/[^"']*select[^"']*["']/g
      const sideEffectDeepImportPattern = /(?:^|\n)\s*import\s*["']@douyinfe\/semi-ui\/[^"']*select[^"']*["']/g
      let match
      while ((match = namedImportPattern.exec(source))) {
        if (hasSelectSpecifier(match[1])) {
          violations.push(`${rel}:${lineNumber(source, match.index)} imports Semi Select; use @octo/ui/select`)
        }
      }
      while ((match = exportPattern.exec(source))) {
        if (hasSelectSpecifier(match[1])) {
          violations.push(`${rel}:${lineNumber(source, match.index)} re-exports Semi Select; use @octo/ui/select`)
        }
      }
      while ((match = defaultImportPattern.exec(source))) {
        const defaultUsage = new RegExp(`\\b${escapeRegExp(match[1])}\\.Select\\b`)
        if (defaultUsage.test(source)) {
          violations.push(`${rel}:${lineNumber(source, match.index)} imports Semi default Select; use @octo/ui/select`)
        }
      }
      while ((match = namespaceImportPattern.exec(source))) {
        const namespaceUsage = new RegExp(`\\b${escapeRegExp(match[1])}\\.Select\\b`)
        if (namespaceUsage.test(source)) {
          violations.push(`${rel}:${lineNumber(source, match.index)} imports Semi namespace Select; use @octo/ui/select`)
        }
      }
      while ((match = deepImportPattern.exec(source))) {
        violations.push(`${rel}:${lineNumber(source, match.index)} imports Semi Select deep path; use @octo/ui/select`)
      }
      while ((match = sideEffectDeepImportPattern.exec(source))) {
        violations.push(`${rel}:${lineNumber(source, match.index)} imports Semi Select deep path; use @octo/ui/select`)
      }
    }

    if (styleExtensions.has(ext) && !allowedSemiSelectStyleFiles.has(rel)) {
      for (const pattern of legacySelectSelectorPatterns) {
        let match
        pattern.lastIndex = 0
        while ((match = pattern.exec(source))) {
          violations.push(`${rel}:${lineNumber(source, match.index)} keeps legacy Select selector ${pattern}`)
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Octo UI Select usage check failed:')
  for (const violation of violations) {
    console.error(`- ${violation}`)
  }
  process.exit(1)
}

console.log('Octo UI Select usage check passed.')
