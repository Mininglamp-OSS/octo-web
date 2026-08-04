#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'

const root = resolve(import.meta.dirname, '..')
const probe = join(root, 'packages/docs/.tmp-excalidraw-production-input')
const port = 4189
let preview

const run = (command, args, cwd = root) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe' })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed\n${result.stdout}${result.stderr}`)
}

const waitForPreview = async () => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}`)
      if (response.ok) return
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  }
  throw new Error('production probe preview did not start')
}

try {
  await mkdir(probe, { recursive: true })
  await writeFile(join(probe, 'index.html'), '<div id="root"></div><script type="module" src="/src.jsx"></script>')
  await writeFile(join(probe, 'src.jsx'), `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
let api
window.__probe = { get api() { return api } }
createRoot(document.getElementById('root')).render(
  <div style={{ width: '100vw', height: '100vh' }}>
    <Excalidraw excalidrawAPI={(next) => { api = next }} autoFocus />
  </div>,
)
`)
  await writeFile(join(probe, 'style.css'), 'html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}')
  run(join(root, 'node_modules/.bin/vite'), ['build', probe, '--outDir', 'dist'])
  preview = spawn(join(root, 'node_modules/.bin/vite'), ['preview', probe, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: root,
    stdio: 'ignore',
  })
  await waitForPreview()

  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(String(error)))
    await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' })
    const canvas = page.locator('canvas.interactive')
    const box = await canvas.boundingBox()
    if (!box) throw new Error('interactive canvas missing')
    const x = box.x + box.width * 0.55
    const y = box.y + box.height * 0.55

    await page.locator('label:has([data-testid="toolbar-text"])').click()
    await page.mouse.click(x, y)
    const createdEditor = page.locator('textarea.excalidraw-wysiwyg')
    await createdEditor.waitFor({ state: 'attached' })
    if (!(await createdEditor.evaluate((node) => node === document.activeElement))) {
      throw new Error('new text editor did not receive focus')
    }
    await page.keyboard.type('Existing text')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(100)

    await page.mouse.dblclick(x + 20, y + 10)
    const editor = page.locator('textarea.excalidraw-wysiwyg')
    await editor.waitFor({ state: 'attached' })
    if (!(await editor.evaluate((node) => node === document.activeElement))) {
      throw new Error('existing text editor did not receive focus')
    }
    if (await editor.inputValue() !== 'Existing text') throw new Error('existing text did not reopen in the editor')
    await editor.evaluate((node) => node.setSelectionRange(node.value.length, node.value.length))
    await page.keyboard.type(' updated')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(100)

    const texts = await page.evaluate(() => window.__probe.api.getSceneElements().map((element) => element.text))
    if (!texts.includes('Existing text updated')) {
      throw new Error(`unexpected edited texts: ${JSON.stringify(texts)}`)
    }
    if (errors.length) throw new Error(`production page errors:\n${errors.join('\n')}`)
    console.log('Excalidraw production text creation and editing verified.')
  } finally {
    await browser.close()
  }
} finally {
  preview?.kill('SIGTERM')
  await rm(probe, { recursive: true, force: true })
}
