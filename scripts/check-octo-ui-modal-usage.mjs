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

const allowedSemiModalFiles = new Set([
  'packages/octo-ui/src/components/Modal/index.tsx',
  'packages/octo-ui/src/components/Modal/Modal.test.tsx',
  'packages/octo-ui/src/components/Modal/Modal.real.test.tsx',

  // Existing unmigrated Semi Modal surfaces. New call sites should use @octo/ui Modal.
  'packages/dmworkbase/src/Components/CreateCategoryModal/index.tsx',
  'packages/dmworkbase/src/Components/DeleteCategoryModal/index.tsx',
  'packages/dmworkbase/src/Components/WKBase/index.tsx',
  'packages/dmworksummary/src/components/ChatSummaryNewModal.tsx',
  'packages/dmworksummary/src/components/AgentChatPanel.tsx',
  'packages/dmworksummary/src/components/MemberSelectorModal.tsx',
  'packages/dmworksummary/src/components/ScheduleConfigModal.tsx',
  'packages/dmworksummary/src/components/SummaryCard.tsx',
  'packages/dmworksummary/src/components/SummaryPreviewModal.tsx',
  'packages/dmworksummary/src/components/SummaryReferencePicker.tsx',
  'packages/dmworksummary/src/pages/ScheduleListPage.tsx',
  'packages/dmworksummary/src/pages/SummaryCreatePage.tsx',
  'packages/dmworksummary/src/pages/SummaryDetailPage.tsx',
])

const allowedSemiModalStyleFiles = new Set([
  'packages/octo-ui/src/components/Modal/index.css',
  'packages/octo-ui/src/components/Modal/Modal.real.test.tsx',
])

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

function hasModalSpecifier(specifierSource) {
  return specifiers(specifierSource).includes('Modal')
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

    if (sourceExtensions.has(ext) && !allowedSemiModalFiles.has(rel)) {
      const namedImportPattern = /(?:^|\n)\s*import(?:\s+type)?\s*\{([^}]*)\}\s*from\s*["']@douyinfe\/semi-ui["']/g
      const exportPattern = /(?:^|\n)\s*export(?:\s+type)?\s*\{([^}]*)\}\s*from\s*["']@douyinfe\/semi-ui["']/g
      const defaultImportPattern = /(?:^|\n)\s*import\s+([A-Za-z_$][\w$]*)(?:\s*,\s*\{[^}]*\})?\s+from\s*["']@douyinfe\/semi-ui["']/g
      const namespaceImportPattern = /(?:^|\n)\s*import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*["']@douyinfe\/semi-ui["']/g
      const deepImportPattern = /(?:^|\n)\s*import(?:\s+type)?(?:[^;\n]|\n(?!\s*(?:import|export)\b))*?from\s*["']@douyinfe\/semi-ui\/[^"']*modal[^"']*["']/g
      const sideEffectDeepImportPattern = /(?:^|\n)\s*import\s*["']@douyinfe\/semi-ui\/[^"']*modal[^"']*["']/g
      let match
      while ((match = namedImportPattern.exec(source))) {
        if (hasModalSpecifier(match[1])) {
          violations.push(`${rel}:${lineNumber(source, match.index)} imports Semi Modal; use @octo/ui Modal`)
        }
      }
      while ((match = exportPattern.exec(source))) {
        if (hasModalSpecifier(match[1])) {
          violations.push(`${rel}:${lineNumber(source, match.index)} re-exports Semi Modal; use @octo/ui Modal`)
        }
      }
      while ((match = defaultImportPattern.exec(source))) {
        const defaultUsage = new RegExp(`\\b${escapeRegExp(match[1])}\\.Modal\\b`)
        if (defaultUsage.test(source)) {
          violations.push(`${rel}:${lineNumber(source, match.index)} imports Semi default Modal; use @octo/ui Modal`)
        }
      }
      while ((match = namespaceImportPattern.exec(source))) {
        const namespaceUsage = new RegExp(`\\b${escapeRegExp(match[1])}\\.Modal\\b`)
        if (namespaceUsage.test(source)) {
          violations.push(`${rel}:${lineNumber(source, match.index)} imports Semi namespace Modal; use @octo/ui Modal`)
        }
      }
      while ((match = deepImportPattern.exec(source))) {
        violations.push(`${rel}:${lineNumber(source, match.index)} imports Semi Modal deep path; use @octo/ui Modal`)
      }
      while ((match = sideEffectDeepImportPattern.exec(source))) {
        violations.push(`${rel}:${lineNumber(source, match.index)} imports Semi Modal deep path; use @octo/ui Modal`)
      }
    }

    if (styleExtensions.has(ext) && !allowedSemiModalStyleFiles.has(rel)) {
      for (const pattern of [/\.octo-ui-modal[^\n,{]*\.semi-modal(?:\b|-)/g, /\.semi-modal(?:\b|-)[^\n,{]*\.octo-ui-modal/g]) {
        let match
        pattern.lastIndex = 0
        while ((match = pattern.exec(source))) {
          violations.push(`${rel}:${lineNumber(source, match.index)} overrides Semi Modal internals through Octo Modal; use octo-ui-modal__* slots`)
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Octo UI Modal usage check failed:')
  for (const violation of violations) {
    console.error(`- ${violation}`)
  }
  process.exit(1)
}

console.log('Octo UI Modal usage check passed.')
