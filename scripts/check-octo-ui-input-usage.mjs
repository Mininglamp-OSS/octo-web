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

const allowedSemiInputFiles = new Set([
  'packages/octo-ui/src/components/Input/index.tsx',
  'packages/octo-ui/src/components/Input/types.ts',
  'packages/octo-ui/src/components/Input/Input.test.tsx',
  'packages/octo-ui/src/components/Input/Input.real.test.tsx',
])

const legacyInputSelectorPatterns = [
  /\.wk-input(?:\b|__|-)/g,
  /\.wk-inputedit(?:\b|__|-)/g,
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

function specifiers(source) {
  return source
    .split(',')
    .map((part) => part.trim().replace(/^type\s+/, '').replace(/\s+as\s+\w+$/, ''))
}

function hasInputSpecifier(specifierSource) {
  const names = specifiers(specifierSource)
  return names.includes('Input') || names.includes('TextArea')
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

    if (sourceExtensions.has(ext) && !allowedSemiInputFiles.has(rel)) {
      const namedImportPattern = /(?:^|\n)\s*import(?:\s+type)?\s*\{([^}]*)\}\s*from\s*["']@douyinfe\/semi-ui["']/g
      const exportPattern = /(?:^|\n)\s*export(?:\s+type)?\s*\{([^}]*)\}\s*from\s*["']@douyinfe\/semi-ui["']/g
      const namespaceImportPattern = /(?:^|\n)\s*import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*["']@douyinfe\/semi-ui["']/g
      const deepImportPattern = /(?:^|\n)\s*import(?:\s+type)?[\s\S]*?from\s*["']@douyinfe\/semi-ui\/[^"']*input[^"']*["']/g
      const sideEffectDeepImportPattern = /(?:^|\n)\s*import\s*["']@douyinfe\/semi-ui\/[^"']*input[^"']*["']/g
      const legacyImportPattern = /(?:^|\n)\s*import[\s\S]*?from\s*["'][^"']*(?:WKInput|InputEdit)[^"']*["']/g
      let match
      while ((match = namedImportPattern.exec(source))) {
        if (hasInputSpecifier(match[1])) {
          violations.push(`${rel}:${lineNumber(source, match.index)} imports Semi Input/TextArea; use @octo/ui Input`)
        }
      }
      while ((match = exportPattern.exec(source))) {
        if (hasInputSpecifier(match[1])) {
          violations.push(`${rel}:${lineNumber(source, match.index)} re-exports Semi Input/TextArea; use @octo/ui Input`)
        }
      }
      while ((match = namespaceImportPattern.exec(source))) {
        const namespaceUsage = new RegExp(`\\b${escapeRegExp(match[1])}\\.(?:Input|TextArea)\\b`)
        if (namespaceUsage.test(source)) {
          violations.push(`${rel}:${lineNumber(source, match.index)} imports Semi namespace Input/TextArea; use @octo/ui Input`)
        }
      }
      while ((match = deepImportPattern.exec(source))) {
        violations.push(`${rel}:${lineNumber(source, match.index)} imports Semi Input deep path; use @octo/ui Input`)
      }
      while ((match = sideEffectDeepImportPattern.exec(source))) {
        violations.push(`${rel}:${lineNumber(source, match.index)} imports Semi Input deep path; use @octo/ui Input`)
      }
      while ((match = legacyImportPattern.exec(source))) {
        violations.push(`${rel}:${lineNumber(source, match.index)} imports legacy WKInput/InputEdit; use @octo/ui Input`)
      }
    }

    if (styleExtensions.has(ext)) {
      for (const pattern of legacyInputSelectorPatterns) {
        let match
        pattern.lastIndex = 0
        while ((match = pattern.exec(source))) {
          violations.push(`${rel}:${lineNumber(source, match.index)} keeps legacy Input selector ${pattern}`)
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Octo UI Input usage check failed:')
  for (const violation of violations) {
    console.error(`- ${violation}`)
  }
  process.exit(1)
}

console.log('Octo UI Input usage check passed.')
