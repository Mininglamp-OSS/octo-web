import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
const scanRoots = ['apps', 'packages']
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx'])
const styleExtensions = new Set(['.css', '.less', '.scss'])
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

function blankComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
}

function collectOctoModalClassNames(source) {
  const names = new Set()
  const importPattern = /(?:^|\n)\s*import\s*\{([^}]*)\}\s*from\s*["']@octo\/ui["']/g
  let match
  while ((match = importPattern.exec(source))) {
    for (const rawSpecifier of match[1].split(',').map((part) => part.trim().replace(/^type\s+/, ''))) {
      const parts = rawSpecifier.split(/\s+as\s+/)
      if (parts[0] === 'Modal') names.add(parts[1] || 'Modal')
    }
  }
  if (names.size === 0) return []

  const tagPattern = new RegExp(`<(${Array.from(names).map(escapeRegExp).join('|')})\\b[^>]*>`, 'g')
  const classes = []
  while ((match = tagPattern.exec(source))) {
    const tag = match[0]
    const classMatch = /\bclassName\s*=\s*(?:"([^"]+)"|'([^']+)'|`([^`$]+)`)/.exec(tag)
    if (!classMatch) continue
    const classSource = classMatch[1] || classMatch[2] || classMatch[3] || ''
    for (const className of classSource.split(/\s+/).filter(Boolean)) {
      classes.push({ className, index: match.index })
    }
  }
  return classes
}

function selectorTouchesClass(selector, className) {
  return new RegExp(`\\.${escapeRegExp(className)}(?:\\b|[.#:[\\s>+~])`).test(selector)
}

function selectorTouchesSemiModal(selector) {
  return /\.semi-modal(?:\b|-)/.test(selector)
}

function collectSemiModalOverrideViolations(source, classNames) {
  const stripped = blankComments(source)
  const violations = []
  const rulePattern = /([^{}]+)\{/g
  let match
  while ((match = rulePattern.exec(stripped))) {
    const selectors = match[1].split(',').map((selector) => selector.replace(/\s+/g, ' ').trim())
    for (const selector of selectors) {
      if (!selectorTouchesSemiModal(selector)) continue
      for (const className of classNames) {
        if (selectorTouchesClass(selector, className)) {
          violations.push(match.index)
          break
        }
      }
    }
  }
  return violations
}

const violations = []
const files = []
const modalClassNames = new Set(['octo-ui-modal'])

for (const scanRoot of scanRoots) {
  const absRoot = join(root, scanRoot)
  files.push(...listFiles(absRoot))
}

for (const file of files) {
  const rel = relative(root, file)
  const source = readFileSync(file, 'utf8')
  const ext = extname(file)

  if (sourceExtensions.has(ext) && !allowedSemiModalFiles.has(rel)) {
    for (const { className } of collectOctoModalClassNames(source)) modalClassNames.add(className)
  }
}

for (const file of files) {
  const rel = relative(root, file)
  const source = readFileSync(file, 'utf8')
  const ext = extname(file)

  if (sourceExtensions.has(ext) && !allowedSemiModalFiles.has(rel)) {
    const namedImportPattern = /(?:^|\n)\s*import(?:\s+type)?\s*\{([^}]*)\}\s*from\s*["']@douyinfe\/semi-ui(?:\/[^"']*)?["']/g
    const exportPattern = /(?:^|\n)\s*export(?:\s+type)?\s*\{([^}]*)\}\s*from\s*["']@douyinfe\/semi-ui(?:\/[^"']*)?["']/g
    const defaultImportPattern = /(?:^|\n)\s*import\s+([A-Za-z_$][\w$]*)(?:\s*,\s*\{[^}]*\})?\s+from\s*["']@douyinfe\/semi-ui(?:\/[^"']*)?["']/g
    const namespaceImportPattern = /(?:^|\n)\s*import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*["']@douyinfe\/semi-ui["']/g
    const deepImportPattern = /(?:^|\n)\s*import(?:\s+type)?(?:[^;\n]|\n(?!\s*(?:import|export)\b))*?from\s*["']@douyinfe\/semi-ui\/[^"']*modal[^"']*["']/g
    const sideEffectDeepImportPattern = /(?:^|\n)\s*import\s*["']@douyinfe\/semi-ui\/[^"']*modal[^"']*["']/g
    const requirePattern = /(?:^|\n)\s*(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*["']@douyinfe\/semi-ui(?:\/[^"']*)?["']\s*\)/g
    const dynamicImportPattern = /(?:^|\n)\s*(?:const|let|var)\s*\{([^}]*)\}\s*=\s*await\s+import\(\s*["']@douyinfe\/semi-ui(?:\/[^"']*)?["']\s*\)/g
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
      const namespaceDestructure = new RegExp(`\\{[^}]*\\bModal\\b[^}]*\\}\\s*=\\s*${escapeRegExp(match[1])}\\b`)
      if (namespaceUsage.test(source)) {
        violations.push(`${rel}:${lineNumber(source, match.index)} imports Semi namespace Modal; use @octo/ui Modal`)
      }
      if (namespaceDestructure.test(source)) {
        violations.push(`${rel}:${lineNumber(source, match.index)} destructures Semi namespace Modal; use @octo/ui Modal`)
      }
    }
    while ((match = deepImportPattern.exec(source))) {
      violations.push(`${rel}:${lineNumber(source, match.index)} imports Semi Modal deep path; use @octo/ui Modal`)
    }
    while ((match = sideEffectDeepImportPattern.exec(source))) {
      violations.push(`${rel}:${lineNumber(source, match.index)} imports Semi Modal deep path; use @octo/ui Modal`)
    }
    while ((match = requirePattern.exec(source))) {
      if (hasModalSpecifier(match[1])) {
        violations.push(`${rel}:${lineNumber(source, match.index)} requires Semi Modal; use @octo/ui Modal`)
      }
    }
    while ((match = dynamicImportPattern.exec(source))) {
      if (hasModalSpecifier(match[1])) {
        violations.push(`${rel}:${lineNumber(source, match.index)} dynamically imports Semi Modal; use @octo/ui Modal`)
      }
    }
  }

  if (styleExtensions.has(ext) && !allowedSemiModalStyleFiles.has(rel)) {
    for (const index of collectSemiModalOverrideViolations(source, modalClassNames)) {
      violations.push(`${rel}:${lineNumber(source, index)} overrides Semi Modal internals through Octo Modal; use octo-ui-modal__* slots`)
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
