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
  patch: 'b9a423b15c56c9abed03db92983a4f21d2df0d7da50a21b6bebed8685e5eec70',
  files: {
    'dist/dev/chunk-4FTI6OG3.js': '274cb0731f353e41eef41aa4d9a6680735402a7e0cabd69a8d31396412d1a160',
    'dist/dev/index.js': '41fecf9a72ad4718ab5c5965acbb08018c9be0dbd13be4e59dbad38f8f0090fe',
    'dist/dev/octo-native-shapes.js': '176ff08f2bbe45c49c407edd8660b77de4e96eaa9edb07a8f92a8119bd151abc',
    'dist/prod/chunk-K2UTITRG.js': '236887e2295d4369484e7797bea5d0acbd7a14c1e1e16bac11dcfccf1e6ad27c',
    'dist/prod/index.js': 'bd9a0cb856e9def21b20f6fd33d7a71e26b3d73708979ebf7a8fb732ae2b3738',
    'dist/prod/octo-native-shapes.js': 'bd2eb479a5333c3b66289e8231a2c309d0d607076b6ebf8446ce0ef2415a0cbd',
    'dist/prod/data/image-GAAHSSAO.js': 'a855f8d02347910bcebfc136d1fa947d5543f6922233017c80c9a7bb037ed6b9',
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
  if (!prodChunk.includes('o==="triangle"||o==="inverted-triangle"||o==="parallelogram"')) {
    throw new Error('prod native-shape kind guard missing')
  }
  console.log('Excalidraw dev/prod geometry and WYSIWYG resize contracts verified.')
  console.log('Excalidraw 0.18.1 patch replay is byte-for-byte reproducible.')
} finally {
  await rm(work, { recursive: true, force: true })
}
