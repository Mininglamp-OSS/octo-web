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
  patch: '731c0ef5dac77b30f2ff9472c35f5a671edb3e743c16cf7ebba89c5a5caf5b4a',
  files: {
    'dist/dev/chunk-4FTI6OG3.js': '274cb0731f353e41eef41aa4d9a6680735402a7e0cabd69a8d31396412d1a160',
    'dist/dev/index.js': 'af102575ebd6067bafb1b8ce894a9f2c6a9b6e859395e1cf144d5a915db66706',
    'dist/dev/octo-native-shapes.js': '176ff08f2bbe45c49c407edd8660b77de4e96eaa9edb07a8f92a8119bd151abc',
    'dist/prod/chunk-K2UTITRG.js': '236887e2295d4369484e7797bea5d0acbd7a14c1e1e16bac11dcfccf1e6ad27c',
    'dist/prod/index.js': '18742cbd236ff9fc6f98f1972e2909ba43ea0324646371e0ac773e08161b3a94',
    'dist/prod/octo-native-shapes.js': 'bd2eb479a5333c3b66289e8231a2c309d0d607076b6ebf8446ce0ef2415a0cbd',
    'dist/prod/data/image-GAAHSSAO.js': 'a855f8d02347910bcebfc136d1fa947d5543f6922233017c80c9a7bb037ed6b9',
    'dist/types/excalidraw/types.d.ts': 'e66dae06e8d7cb7839eb3ba3278aaa142aa7e0017e4f13f260be8ab7337aa65e',
    'dist/types/excalidraw/index.d.ts': 'db0682ff91c3fcea460ad070501164c96bd846af14e55aa87d97aef2cd9b7b1b',
    'dist/types/octo-native-shapes.d.ts': '7b82fa390cc9191fc5e1e77f9db605585de5e22fc5ddaf80ad9f9566559b3626',
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
  run('git', ['apply', '--check', '--directory=package', patch])
  run('git', ['apply', '--directory=package', patch])

  for (const [file, hash] of Object.entries(expected.files)) {
    assertHash(file, await sha256(join(work, 'package', file)), hash)
  }
  const devIndex = await readFile(join(work, 'package/dist/dev/index.js'), 'utf8')
  const prodIndex = await readFile(join(work, 'package/dist/prod/index.js'), 'utf8')
  const prodChunk = await readFile(join(work, 'package/dist/prod/chunk-K2UTITRG.js'), 'utf8')
  if (!devIndex.includes('new window.ResizeObserver(updateWysiwygStyle)') ||
      !devIndex.includes('window.addEventListener("resize", updateWysiwygStyle)')) {
    throw new Error('dev WYSIWYG resize observer/fallback contract missing')
  }
  if (!prodIndex.includes('__octoResizeObserver') || !prodIndex.includes('addEventListener("resize"')) {
    throw new Error('prod WYSIWYG resize observer/fallback contract missing')
  }
  if (!prodIndex.includes('{TTDDialogTriggerTunnel:G}=pt();') ||
      prodIndex.includes('{TTDDialogTriggerTunnel:G}=_e();')) {
    throw new Error('prod toolbar must call the tunnel hook, not the command-category object')
  }
  for (const [label, source] of [["dev", devIndex], ["prod", prodIndex]]) {
    for (const seam of ["renderDefaultMainMenu", "onContextMenu", "executeAction", "executeActionWithHostFeedback", "isActionAvailable"]) {
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
  }
  const exportToastSuffixCleanup = '.replace(/\\s*\\([^()]*\\)\\s*$/'
  for (const [label, source] of [["dev", devIndex], ["prod", prodIndex]]) {
    if (source.includes('exportColorScheme') ||
        (source.match(/copyToClipboardAs(?:Png|Svg)/g) ?? []).length !== 2 ||
        source.split(exportToastSuffixCleanup).length - 1 !== 2) {
      throw new Error(`${label} clipboard export feedback must omit the light/dark color scheme suffix`)
    }
  }
  if (!prodChunk.includes('o==="triangle"||o==="inverted-triangle"||o==="parallelogram"')) {
    throw new Error('prod native-shape kind guard missing')
  }
  console.log('Excalidraw dev/prod geometry and WYSIWYG resize contracts verified.')
  console.log('Excalidraw 0.18.1 patch replay is byte-for-byte reproducible.')
} finally {
  await rm(work, { recursive: true, force: true })
}
