#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'

const root = resolve(import.meta.dirname, '..')
const probe = join(root, 'packages/docs/.tmp-excalidraw-development-input')
// 4190 is blocked by the Fetch standard's unsafe-port list.
const port = 4191
let server

const waitForServer = async () => {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (server.exitCode != null) {
      throw new Error(`development probe exited ${server.exitCode}: ${server.stderr.read() ?? ''}`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}`)
      if (response.ok) return
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  }
  throw new Error(`development probe did not start: ${server.stderr.read() ?? ''}`)
}

try {
  await mkdir(probe, { recursive: true })
  await writeFile(join(probe, 'index.html'), '<div id="root"></div><script type="module" src="/src.jsx"></script>')
  await writeFile(join(probe, 'src.jsx'), `
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Excalidraw } from '@excalidraw/excalidraw'
import { BoardContextMenu } from '../src/board/BoardContextMenu.tsx'
import '@excalidraw/excalidraw/index.css'
let api
window.__probe = { get api() { return api } }
function Probe() {
  const [menu, setMenu] = useState(null)
  const [feedback, setFeedback] = useState('idle')
  const paste = async () => {
    try {
      const executed = await api.executeActionWithHostFeedback('paste')
      setFeedback(executed ? 'success' : 'failure')
      return executed
    } catch {
      setFeedback('failure')
      return false
    }
  }
  return <div
    style={{ width: '100vw', height: '100vh' }}
    onContextMenuCapture={(event) => {
      event.preventDefault()
      setMenu({ left: event.clientX, top: event.clientY })
    }}
  >
    <output data-testid="paste-feedback">{feedback}</output>
    <Excalidraw excalidrawAPI={(next) => { api = next }} langCode="zh-CN" autoFocus />
    {menu && <BoardContextMenu
      bounds={{ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }}
      left={menu.left}
      top={menu.top}
      items={[{ id: 'paste', label: '粘贴', onSelect: paste }]}
      onClose={() => setMenu(null)}
    />}
  </div>
}
createRoot(document.getElementById('root')).render(<Probe />)
`)
  server = spawn(join(root, 'node_modules/.bin/vite'), ['--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: probe,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await waitForServer()

  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({
      viewport: { width: 1200, height: 800 },
      permissions: ['clipboard-read', 'clipboard-write'],
    })
    const page = await context.newPage()
    const errors = []
    const consoleErrors = []
    page.on('pageerror', (error) => errors.push(String(error)))
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    await page.goto(`http://localhost:${port}`, { waitUntil: 'networkidle' })

    const canvas = page.locator('canvas.interactive')
    try {
      await canvas.waitFor({ state: 'visible' })
    } catch (error) {
      throw new Error(`development canvas did not render: ${JSON.stringify({ errors, consoleErrors })}`, { cause: error })
    }
    const box = await canvas.boundingBox()
    if (!box) throw new Error('interactive canvas missing')
    const x = box.x + box.width * 0.55
    const y = box.y + box.height * 0.55

    await page.evaluate(() => navigator.clipboard.writeText('Development pasted text'))
    await page.mouse.click(x, y, { button: 'right' })
    const pasteItem = page.getByRole('menuitem', { name: '粘贴' })
    await pasteItem.click()
    await page.getByTestId('paste-feedback').filter({ hasText: 'success' }).waitFor()
    await pasteItem.waitFor({ state: 'hidden' })
    await page.waitForTimeout(500)
    const pastedElements = await page.evaluate(() => window.__probe.api.getSceneElements().map((element) => ({ type: element.type, text: element.text })))
    if (!pastedElements.some((element) => element.text === 'Development pasted text')) {
      throw new Error(`development context-menu paste did not create text: ${JSON.stringify(pastedElements)}`)
    }

    await context.clearPermissions()
    await page.mouse.click(x + 30, y + 30, { button: 'right' })
    const deniedPasteItem = page.getByRole('menuitem', { name: '粘贴' })
    await deniedPasteItem.click()
    await page.getByTestId('paste-feedback').filter({ hasText: 'failure' }).waitFor()
    if (!(await deniedPasteItem.isVisible())) throw new Error('development paste failure closed the context menu')
    await page.keyboard.press('Escape')

    await page.mouse.click(x, y)
    await page.locator('label:has([data-testid="toolbar-text"])').click()
    await page.mouse.click(x, y)
    const editor = page.locator('textarea.excalidraw-wysiwyg')
    await editor.waitFor({ state: 'attached' })
    if (!(await editor.evaluate((node) => node === document.activeElement))) {
      throw new Error('development text editor did not receive focus')
    }
    await page.keyboard.type('Development text')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(100)

    const texts = await page.evaluate(() => window.__probe.api.getSceneElements().map((element) => element.text))
    if (!texts.includes('Development text')) {
      throw new Error(`unexpected development texts: ${JSON.stringify(texts)}`)
    }
    if (errors.length || consoleErrors.length) {
      throw new Error(`development browser errors: ${JSON.stringify({ errors, consoleErrors })}`)
    }
    console.log('Excalidraw development context-menu paste success/failure, canvas click, and text editing verified.')
  } finally {
    await browser.close()
  }
} finally {
  server?.kill('SIGTERM')
  if (process.env.KEEP_EXCALIDRAW_PROBE !== '1') {
    await rm(probe, { recursive: true, force: true })
  }
}
