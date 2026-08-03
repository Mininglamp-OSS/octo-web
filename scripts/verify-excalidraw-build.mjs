import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const buildAssets = join(process.cwd(), 'apps/web/build/assets')
const entries = await readdir(buildAssets)
const prodChunks = entries.filter((name) => /^prod-[\w-]+\.js$/.test(name))

if (prodChunks.length !== 1) {
  throw new Error(`expected exactly one Excalidraw prod chunk, found ${prodChunks.length}`)
}

const file = join(buildAssets, prodChunks[0])
const source = await readFile(file, 'utf8')
const categories = /\b([A-Za-z_$][\w$]*)=\{app:["'`]App["'`],export:["'`]Export["'`],tools:["'`]Tools["'`],editor:["'`]Editor["'`],elements:["'`]Elements["'`],links:["'`]Links["'`]\}/.exec(source)

if (!categories) {
  throw new Error(`command-category object not found in ${prodChunks[0]}`)
}

const categoryIdentifier = categories[1]
const calledCategory = new RegExp(`\\b${categoryIdentifier.replace(/[$]/g, '\\$&')}\\s*\\(`)
if (calledCategory.test(source)) {
  throw new Error(`Excalidraw production bundle calls command-category object ${categoryIdentifier} as a function`)
}

if (!/\{TTDDialogTriggerTunnel:[A-Za-z_$][\w$]*\}=[A-Za-z_$][\w$]*\(\)/.test(source)) {
  throw new Error(`TTDDialogTriggerTunnel hook call not found in ${prodChunks[0]}`)
}

if (!/executeAction:\([^)]*\)=>\{[^}]*actionManager\.actions\[[^\]]+\][\s\S]{0,500}?actionManager\.executeAction\([^,]+,`ui`,/.test(source)) {
  throw new Error(`imperative Excalidraw actions do not use UI-origin semantics in ${prodChunks[0]}`)
}

for (const seam of ['renderDefaultMainMenu', 'onContextMenu', 'isActionAvailable']) {
  if (!source.includes(seam)) throw new Error(`Board menu seam missing from ${prodChunks[0]}: ${seam}`)
}

if (!/renderDefaultMainMenu:[A-Za-z_$][\w$]*\.renderDefaultMainMenu/.test(source) ||
    !/onContextMenu:[A-Za-z_$][\w$]*\.onContextMenu/.test(source)) {
  throw new Error(`Board menu props are not forwarded into the Excalidraw App in ${prodChunks[0]}`)
}

if ((source.match(/\.props\.renderDefaultMainMenu!==!1&&/g) ?? []).length !== 4) {
  throw new Error(`not every Excalidraw fallback main-menu injection/outlet is guarded in ${prodChunks[0]}`)
}

console.log(`Excalidraw production bundle contract verified: ${prodChunks[0]}`)
