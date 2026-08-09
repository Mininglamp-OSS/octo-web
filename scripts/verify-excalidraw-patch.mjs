#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const patch = join(root, 'patches/@excalidraw__excalidraw@0.18.1.patch')
const work = await mkdtemp(join(tmpdir(), 'octo-excalidraw-patch-'))

const expected = {
  tarball: 'b280d4b364b65cba264c5aa4e7435cc2ce6421eabbbef9765a56997a0fadf534',
  patch: 'eaa700535211a70fdc31564a90b584fd61323c3477f6d454ad12b53c7c122e24',
  files: {
    'dist/dev/chunk-4FTI6OG3.js': '4ac8f3fbe42404296e6eb541f561a736d0a51cfbcc220d3ee3412be693a32a08',
    'dist/dev/index.css': '220a92d978570eb64115d422b172c4d81700e56086eb366a8bf089fd7e994eb5',
    'dist/dev/index.js': 'd27286aa3308a5da9a3698f10c6ccc478cd645da7ed07e4494b6458ac35faa7d',
    'dist/dev/locales/zh-CN-4MXUOFTH.js': 'c1ecb260c1de1648d47e99b288b385eacb4d587c047c3083b7ba3eff9433dae9',
    'dist/dev/octo-native-shapes.js': 'b8bf27db85e29aa34f4015d081dabe4cfcd0df2d3889bb646cdbd1229c72c338',
    'dist/prod/chunk-K2UTITRG.js': '82c308c6bf3a299a927e4c5441144bfb39e3fdfc88b0b696a453daa8933dff73',
    'dist/prod/index.css': 'e72092760bae272ebe075bdadaff7f82909d318c5d819313185b19e99be31e49',
    'dist/prod/index.js': '9a4b91c632f48f36af24e797ca89e5144b5adc60191201a9e37d3fe48846a6c3',
    'dist/prod/locales/zh-CN-LNUGB5OW.js': '7035380ea7dd08b036fdea381f2814a8364a39178d604d3379ea2e1949a68b0d',
    'dist/prod/octo-native-shapes.js': 'b8bf27db85e29aa34f4015d081dabe4cfcd0df2d3889bb646cdbd1229c72c338',
    'dist/prod/data/image-GAAHSSAO.js': 'a855f8d02347910bcebfc136d1fa947d5543f6922233017c80c9a7bb037ed6b9',
    'dist/types/excalidraw/types.d.ts': 'e66dae06e8d7cb7839eb3ba3278aaa142aa7e0017e4f13f260be8ab7337aa65e',
    'dist/types/excalidraw/index.d.ts': 'db0682ff91c3fcea460ad070501164c96bd846af14e55aa87d97aef2cd9b7b1b',
    'dist/types/octo-native-shapes.d.ts': '1bb260d42fc12fe2cd87bfe7d9da0899426a39cb5bc3eacfab9effc7206e84ed',
    'package.json': 'a07cc9c861da050cafa04b080d7022191735ee41af0e6eefdadb139b6fd97939',
  },
}

function run(command, args, cwd = work) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed\n${result.stdout}${result.stderr}`)
  }
  return result.stdout.trim()
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

function assertHash(label, actual, wanted) {
  if (actual !== wanted) throw new Error(`${label}: expected ${wanted}, got ${actual}`)
  console.log(`ok ${label} ${actual}`)
}

try {
  const packed = run('npm', ['pack', '@excalidraw/excalidraw@0.18.1', '--silent'])
    .split(/\r?\n/).at(-1)
  const tarball = join(work, packed)
  assertHash('npm tarball', await sha256(tarball), expected.tarball)
  assertHash('pnpm patch', await sha256(patch), expected.patch)
  const patchText = await readFile(patch, 'utf8')
  if (/b\/node_modules\/\.bin\//.test(patchText)) {
    throw new Error('pnpm patch must not ship generated node_modules/.bin stubs')
  }
  if (/(?:^|["'= ])\/(?:Users|home)\/[\w.-]+\//m.test(patchText)) {
    throw new Error('pnpm patch must not contain developer-machine home paths')
  }

  run('tar', ['-xzf', tarball])
  run('git', ['apply', '--recount', '--check', '--directory=package', patch])
  run('git', ['apply', '--recount', '--directory=package', patch])

  for (const [file, hash] of Object.entries(expected.files)) {
    assertHash(file, await sha256(join(work, 'package', file)), hash)
  }
  const devIndex = await readFile(join(work, 'package/dist/dev/index.js'), 'utf8')
  const devChunk = await readFile(join(work, 'package/dist/dev/chunk-4FTI6OG3.js'), 'utf8')
  const prodIndex = await readFile(join(work, 'package/dist/prod/index.js'), 'utf8')
  const prodChunk = await readFile(join(work, 'package/dist/prod/chunk-K2UTITRG.js'), 'utf8')
  const devNativeShapes = await readFile(join(work, 'package/dist/dev/octo-native-shapes.js'), 'utf8')
  const prodNativeShapes = await readFile(join(work, 'package/dist/prod/octo-native-shapes.js'), 'utf8')
  const nativeShapeTypes = await readFile(join(work, 'package/dist/types/octo-native-shapes.d.ts'), 'utf8')
  if (!devIndex.includes('new window.ResizeObserver(updateWysiwygStyle)') ||
      !devIndex.includes('window.addEventListener("resize", updateWysiwygStyle)')) {
    throw new Error('dev WYSIWYG resize observer/fallback contract missing')
  }
  if (!prodIndex.includes('__octoResizeObserver') || !prodIndex.includes('addEventListener("resize"')) {
    throw new Error('prod WYSIWYG resize observer/fallback contract missing')
  }
  if (!prodIndex.includes('__octoPointerAnchor=null,__octoProxyViewport=null,__octoProxyAngle=0')) {
    throw new Error('prod WYSIWYG rich-text layout state declarations missing')
  }
  if (!prodIndex.includes('__octoResizeObserver&&r?ue.__octoResizeObserver.observe(r):window.addEventListener("resize",i)') ||
      prodIndex.includes('__octoResizeObserver.observe(s)')) {
    throw new Error('prod WYSIWYG resize observer must observe the canvas element')
  }
  if (!prodIndex.includes('{TTDDialogTriggerTunnel:G}=pt();') ||
      prodIndex.includes('{TTDDialogTriggerTunnel:G}=_e();')) {
    throw new Error('prod toolbar must call the tunnel hook, not the command-category object')
  }
  for (const symbol of ['History', 'ActionManager']) {
    if (!devIndex.includes(`var ${symbol} = class`) || !devIndex.includes(`new ${symbol}(`)) {
      throw new Error(`dev ${symbol} definition/constructor contract missing`)
    }
  }
  for (const [label, source] of [["dev", devIndex], ["prod", prodIndex]]) {
    if (source.includes('library.title') || !source.includes('toolBar.library')) {
      throw new Error(`${label} library tab must use the existing toolBar.library translation`)
    }
  }
  for (const [label, source] of [["dev", devIndex], ["prod", prodIndex]]) {
    for (const seam of ["renderDefaultMainMenu", "onContextMenu", "executeAction", "executeActionWithHostFeedback", "executeActionWithResult", "isActionAvailable"]) {
      if (!source.includes(seam)) throw new Error(`${label} Board menu seam missing: ${seam}`)
    }
    const readOnlyActions = label === 'dev'
      ? '["copy", "copyAsPng", "copyAsSvg", "copyText", "copyElementLink"]'
      : '["copy","copyAsPng","copyAsSvg","copyText","copyElementLink"]'
    if (source.split(readOnlyActions).length - 1 !== 3) {
      throw new Error(`${label} Board action seams must share the exact read-only action whitelist`)
    }
  }
  if (!devIndex.includes('renderDefaultMainMenu: props.renderDefaultMainMenu') ||
      !devIndex.includes('onContextMenu: props.onContextMenu') ||
      (devIndex.match(/app\.props\.renderDefaultMainMenu !== false && \/\* @__PURE__ \*\/ jsx(?:90|137)\((?:MainMenuTunnel|tunnels\.MainMenuTunnel)\.Out/g) ?? []).length !== 3) {
    throw new Error('dev Board menu props must reach App and guard all three main-menu tunnel outlets')
  }
  if (!prodIndex.includes('renderDefaultMainMenu:e.renderDefaultMainMenu') ||
      !prodIndex.includes('onContextMenu:e.onContextMenu') ||
      (prodIndex.match(/\.props\.renderDefaultMainMenu!==!1&&/g) ?? []).length !== 4) {
    throw new Error('prod Board menu props must reach App and guard all fallback injection/outlet paths')
  }
  if (!devIndex.includes('this.actionManager.executeAction(action, "ui", value)') ||
      devIndex.includes('this.actionManager.executeAction(action, "api", value)') ||
      !devIndex.includes('this.actionManager.executeActionWithResult(action, "ui", value') ||
      !prodIndex.includes('this.actionManager.executeAction(h,"ui",m)') ||
      prodIndex.includes('this.actionManager.executeAction(h,"api",m)') ||
      !prodIndex.includes('this.actionManager.executeActionWithResult(h,"ui",m')) {
    throw new Error('dev/prod imperative Board actions must execute with UI-origin semantics')
  }
  for (const [label, source] of [["dev", devIndex], ["prod", prodIndex]]) {
    if (!source.includes('toast: null') && !source.includes('toast:null') ||
        !source.includes('errorMessage: null') && !source.includes('errorMessage:null')) {
      throw new Error(`${label} host-feedback action seam must consume native success and error feedback`)
    }
    const returnsBatchedActionPromise = label === 'dev'
      ? source.includes('return unstable_batchedUpdates2(func, event)')
      : source.includes('var Ne=e=>t=>O1(e,t)')
    if (!returnsBatchedActionPromise) {
      throw new Error(`${label} batched action wrapper must preserve async action results`)
    }
    const awaitsPaste = label === 'dev'
      ? source.includes('await app.pasteFromClipboard(createPasteEvent({ types }))')
      : /await [A-Za-z_$][\w$]*\.pasteFromClipboard\(/.test(source)
    if (!awaitsPaste) {
      throw new Error(`${label} programmatic paste must await clipboard parsing before reporting success`)
    }
    const guardsOnlyTrustedNativePaste = label === 'dev'
      ? source.includes('if (event?.isTrusted && !isExcalidrawActive)')
        && source.includes('if (event?.isTrusted && (!(elementUnderCursor instanceof HTMLCanvasElement) || isWritableElement(target)))')
      : (source.match(/\.isTrusted/g)?.length ?? 0) >= 2
    if (!guardsOnlyTrustedNativePaste) {
      throw new Error(`${label} programmatic paste must not be rejected because the host menu owns focus or covers the cursor`)
    }
  }
  const exportToastSuffixCleanup = '.replace(/\\s*\\([^()]*\\)\\s*$/'
  for (const [label, source] of [["dev", devIndex], ["prod", prodIndex]]) {
    if (source.includes('exportColorScheme') ||
        (source.match(/copyToClipboardAs(?:Png|Svg)/g) ?? []).length !== 2 ||
        source.split(exportToastSuffixCleanup).length - 1 !== 2) {
      throw new Error(`${label} clipboard export feedback must omit the light/dark color scheme suffix`)
    }
  }
  if (!devChunk.includes('getOctoNativeShapePoints(element.customData?.nativeShapeKind, width, height, x, y, element.customData)')) {
    throw new Error('dev native-shape collision geometry must receive customData')
  }
  if (!devChunk.includes('const drawables = Array.isArray(shape) ? shape : [shape]') ||
      !prodChunk.includes('Array.isArray(x)?(()=>{')) {
    throw new Error('dev/prod SVG export must render every drawable of compound native shapes')
  }
  for (const [label, source] of [["dev", devIndex], ["prod", prodIndex]]) {
    if (!source.includes('__octoBasicShapeStyle') ||
        source.includes('currentItemStrokeWidth: 1, currentItemStrokeStyle: "solid", currentItemRoughness: 0')) {
      throw new Error(`${label} native shape basic style must be transient and element-scoped`)
    }
    const clearsStyleOnToolSwitch = label === 'dev'
      ? source.includes('this.__octoShapeVariant = null; this.__octoBasicShapeStyle = false;')
      : source.includes('this.__octoShapeVariant=null,this.__octoBasicShapeStyle=!1')
    if (!clearsStyleOnToolSwitch) {
      throw new Error(`${label} native shape basic style must clear when switching away before drawing`)
    }
  }
  const devBasicStyleDeclaration = 'const useOctoBasicShapeStyle = !!this.__octoBasicShapeStyle;'
  const devBasicStyleUse = 'strokeWidth: useOctoBasicShapeStyle ? 1 : this.state.currentItemStrokeWidth,'
  if (devIndex.split(devBasicStyleDeclaration).length - 1 !== 1 ||
      devIndex.split(devBasicStyleUse).length - 1 !== 1 ||
      devIndex.indexOf(devBasicStyleDeclaration) > devIndex.indexOf(devBasicStyleUse)) {
    throw new Error('dev basic-shape style must be declared in createGenericElementOnPointerDown before its only use')
  }
  const readRuntimeKinds = (source, label) => {
    const match = source.match(/OCTO_NATIVE_SHAPE_KINDS\s*=\s*\[([\s\S]*?)\];/)
    if (!match) throw new Error(`${label} native shape kind list missing`)
    return [...match[1].matchAll(/["']([^"']+)["']/g)].map((item) => item[1])
  }
  const typeMatch = nativeShapeTypes.match(/export type OctoNativeShapeKind\s*=\s*([^;]+);/)
  if (!typeMatch) throw new Error('native shape type union missing')
  const typeKinds = [...typeMatch[1].matchAll(/'([^']+)'/g)].map((item) => item[1])
  const devKinds = readRuntimeKinds(devNativeShapes, 'dev')
  const prodKinds = readRuntimeKinds(prodNativeShapes, 'prod')
  if (JSON.stringify(devKinds) !== JSON.stringify(prodKinds) ||
      JSON.stringify(devKinds) !== JSON.stringify(typeKinds) ||
      !devKinds.includes('inverted-triangle')) {
    throw new Error(`native shape runtime/type kinds differ: dev=${devKinds} prod=${prodKinds} types=${typeKinds}`)
  }
  if (!prodChunk.includes('getOctoNativeShapeStrokePaths as __octoNativeShapeStrokePaths') ||
      !prodChunk.includes('getOctoNativeShapePath as __octoNativeShapePath') ||
      !prodChunk.includes('getOctoNativeShapePoints as __octoNativeShapePoints') ||
      !prodChunk.includes('__octoNativeShapePath(e.customData?.nativeShapeKind,e.width,e.height,e.customData)') ||
      !prodChunk.includes('__octoNativeShapePoints(e.customData?.nativeShapeKind,e.width,e.height,0,0,e.customData)') ||
      !prodChunk.includes('__octoNativeShapePoints(e.customData?.nativeShapeKind,a,r,n,i,e.customData)') ||
      !prodChunk.includes('__octoNativeShapeStrokePaths(e.customData?.nativeShapeKind,e.width,e.height,e.customData)')) {
    throw new Error('prod native-shape geometry integration missing')
  }
  const devZhCN = await readFile(join(work, 'package/dist/dev/locales/zh-CN-4MXUOFTH.js'), 'utf8')
  const prodZhCN = await readFile(join(work, 'package/dist/prod/locales/zh-CN-LNUGB5OW.js'), 'utf8')
  for (const [label, source, zhCN] of [["dev", devIndex, devZhCN], ["prod", prodIndex, prodZhCN]]) {
    if (!/excalidrawLib:\s*["']\\u7D20\\u6750\\u5E93["']/.test(zhCN) ||
        /excalidrawLib:\s*["']Excalidraw/.test(zhCN)) {
      throw new Error(`${label} zh-CN library heading must be exactly 素材库`)
    }
    const gridContract = label === 'dev'
      ? 'gridTemplateColumns: grid ? "repeat(7, 36px)"'
      : 'gridTemplateColumns:b?"repeat(7, 36px)"'
    const centeredRoundedBubbleIcon = 'M7 4h10a4 4 0 0 1 4 4v5a4 4 0 0 1-4 4h-3l-2 4-2-4H7a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4Z'
    if (!source.includes(gridContract) ||
        !source.includes(centeredRoundedBubbleIcon) ||
        !source.includes('toolbar-shapes-flyout') ||
        !source.includes('shapeFlyout.map') ||
        !source.includes('bidirectional-arrow') ||
        source.includes('toolbar-shapes-expand') ||
        source.includes('toolbar-shapes-collapse') ||
        source.includes('shapeExpanded') ||
        source.includes('compactShapeSlots') ||
        source.includes('data-expanded') ||
        source.includes('shapes-more')) {
      throw new Error(`${label} direct 21-preset seven-column shape flyout missing or still has expansion UI`)
    }
  }
  console.log('Excalidraw dev/prod geometry and WYSIWYG resize contracts verified.')
  console.log('Excalidraw 0.18.1 patch replay is byte-for-byte reproducible.')
} finally {
  await rm(work, { recursive: true, force: true })
}
