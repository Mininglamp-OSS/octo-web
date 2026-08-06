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
  await writeFile(join(probe, 'index.html'), '<style>html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}</style><div id="root"></div><script type="module" src="/src.jsx"></script>')
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
  run(join(root, 'node_modules/.bin/vite'), ['build', probe, '--outDir', 'dist'])
  preview = spawn(join(root, 'node_modules/.bin/vite'), ['preview', probe, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: root,
    stdio: 'ignore',
  })
  await waitForPreview()

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
      if (message.type() === 'error' || message.text().includes("Can't find translation")) {
        consoleErrors.push(`${message.type()}: ${message.text()}`)
      }
    })
    await page.goto(`http://localhost:${port}`, { waitUntil: 'networkidle' })
    const extraTools = page.locator('[data-testid="toolbar-extra-tools"]')
    try {
      await extraTools.waitFor({ state: 'visible' })
    } catch (error) {
      const diagnostics = await page.evaluate(() => ({
        bodyText: document.body.innerText.slice(0, 500),
        excalidrawCount: document.querySelectorAll('.excalidraw').length,
        toolbarCount: document.querySelectorAll('.App-toolbar').length,
        extraTriggerCount: document.querySelectorAll('.App-toolbar__extra-tools-trigger').length,
        toolbarHtml: document.querySelector('.App-toolbar')?.outerHTML.slice(0, 5000),
      }))
      throw new Error(`extra-tools trigger did not render: ${JSON.stringify({ diagnostics, errors, consoleErrors })}`, { cause: error })
    }
    const accessibleName = await extraTools.getAttribute('aria-label')
    if (accessibleName !== '更多工具') {
      throw new Error(`extra-tools trigger did not use zh-CN: ${JSON.stringify(accessibleName)}`)
    }
    await extraTools.click()
    const dropdown = page.locator('.App-toolbar__extra-tools-dropdown')
    await dropdown.waitFor({ state: 'visible' })
    const menuItems = []
    for (const testId of ['toolbar-frame', 'toolbar-search', 'toolbar-reset-canvas', 'toolbar-mermaid']) {
      const item = dropdown.locator(`[data-testid="${testId}"]`)
      await item.waitFor({ state: 'visible' })
      menuItems.push(await item.boundingBox())
    }
    const triggerBox = await extraTools.boundingBox()
    const dropdownBox = await dropdown.boundingBox()
    const dropdownLayout = await dropdown.evaluate((node) => {
      const style = getComputedStyle(node)
      return {
        parentClass: node.parentElement?.className ?? '',
        position: style.position,
        width: style.width,
        bodyChild: node.parentElement === document.body,
      }
    })
    if (!triggerBox || !dropdownBox || menuItems.some((box) => !box)) {
      throw new Error('extra-tools trigger, dropdown, or menu item has no layout box')
    }
    if (!(await dropdown.evaluate((node) => node.closest('.App-toolbar') !== null))) {
      throw new Error('extra-tools dropdown left Excalidraw’s original toolbar positioning context')
    }
    if (dropdownLayout.bodyChild || dropdownLayout.position === 'fixed' || dropdownLayout.width === '190px') {
      throw new Error(`extra-tools dropdown uses the regressed body/fixed substitute: ${JSON.stringify(dropdownLayout)}`)
    }
    if (dropdownLayout.position !== 'absolute') {
      throw new Error(`extra-tools dropdown lost native absolute toolbar geometry: ${JSON.stringify(dropdownLayout)}`)
    }
    if (dropdownBox.y < triggerBox.y + triggerBox.height - 2) {
      throw new Error(`extra-tools dropdown is not positioned below its trigger: ${JSON.stringify({ triggerBox, dropdownBox })}`)
    }
    if (!menuItems.every((box, index) => index === 0 || menuItems[index - 1].y < box.y)) {
      throw new Error(`extra-tools items are not vertically stacked: ${JSON.stringify(menuItems)}`)
    }
    if (Math.max(...menuItems.map((box) => box.x)) - Math.min(...menuItems.map((box) => box.x)) > 2) {
      throw new Error(`extra-tools items do not share one menu column: ${JSON.stringify(menuItems)}`)
    }
    const heading = dropdown.locator('div').filter({ hasText: /^Generate$/ })
    if ((await heading.innerText()).trim() !== 'Generate') {
      throw new Error(`extra-tools Generate heading missing: ${JSON.stringify(await dropdown.innerText())}`)
    }
    const mermaidItem = dropdown.locator('[data-testid="toolbar-mermaid"]')
    const mermaidText = (await mermaidItem.innerText()).trim()
    if (!mermaidText.includes('Mermaid 至画布') || !mermaidText.includes('Shift+M')) {
      throw new Error(`Mermaid menu item incomplete: ${JSON.stringify(mermaidText)}`)
    }

    const searchItem = dropdown.locator('[data-testid="toolbar-search"]')
    if ((await searchItem.innerText()).trim().split('\n')[0] !== '查找') {
      throw new Error(`search menu item did not use zh-CN: ${JSON.stringify(await searchItem.innerText())}`)
    }
    await searchItem.click()
    await dropdown.waitFor({ state: 'hidden' })

    const searchInput = page.locator('.layer-ui__search input')
    await searchInput.waitFor({ state: 'visible' })
    if ((await searchInput.getAttribute('placeholder')) !== '在画布上查找文字…') {
      throw new Error(`search placeholder did not use zh-CN: ${JSON.stringify(await searchInput.getAttribute('placeholder'))}`)
    }
    await page.keyboard.press('Escape')
    await searchInput.waitFor({ state: 'hidden' })

    const helpButton = page.locator('button.help-icon')
    await helpButton.waitFor({ state: 'visible' })
    if ((await helpButton.getAttribute('aria-label')) !== '帮助' || !(await helpButton.getAttribute('title'))?.startsWith('帮助')) {
      throw new Error(`help button did not use zh-CN: ${JSON.stringify({
        ariaLabel: await helpButton.getAttribute('aria-label'),
        title: await helpButton.getAttribute('title'),
      })}`)
    }
    await helpButton.click()
    const helpDialog = page.locator('.HelpDialog')
    await helpDialog.waitFor({ state: 'visible' })
    if (!(await helpDialog.innerText()).includes('快捷键列表')) {
      throw new Error(`help dialog did not use zh-CN: ${JSON.stringify((await helpDialog.innerText()).slice(0, 300))}`)
    }
    await helpButton.click({ force: true })
    await helpDialog.waitFor({ state: 'hidden' })

    const canvas = page.locator('canvas.interactive')
    const box = await canvas.boundingBox()
    if (!box) throw new Error('interactive canvas missing')
    const x = box.x + box.width * 0.55
    const y = box.y + box.height * 0.55

    await page.locator('[data-testid="toolbar-shapes"]').click({ force: true })
    const shapeFlyout = page.locator('[data-testid="toolbar-shapes-flyout"]')
    await shapeFlyout.waitFor({ state: 'visible' })
    if (await shapeFlyout.locator('[data-testid="toolbar-shapes-expand"]').count()) {
      throw new Error('production shape flyout still exposes the removed expansion control')
    }
    const databaseTool = shapeFlyout.locator('[data-testid="toolbar-database"]')
    await databaseTool.waitFor({ state: 'visible' })
    const databasePath = await databaseTool.locator('path').getAttribute('d')
    const expectedDatabasePath = 'M4 6c0-3 16-3 16 0v12c0 3-16 3-16 0ZM4 6c0 3 16 3 16 0'
    if (databasePath !== expectedDatabasePath) {
      throw new Error(`production database toolbar icon differs from canvas geometry: ${JSON.stringify(databasePath)}`)
    }
    const allShapeSlots = [
      'rounded-rectangle', 'ellipse', 'diamond', 'square', 'circle', 'triangle', 'parallelogram',
      'database', 'notched-dovetail', 'chevron', 'trapezoid', 'speech-bubble', 'speech-bubble-rounded',
      'right-triangle', 'star', 'hexagon', 'pentagon', 'octagon', 'left-arrow', 'right-arrow',
      'bidirectional-arrow',
    ]
    for (const [index, slot] of allShapeSlots.entries()) {
      if (index > 0) {
        // Reload between slots so each case proves its own toolbar activation/finalization path and
        // cannot inherit React radio state, a prior native preset, or a previously selected element.
        await page.reload({ waitUntil: 'networkidle' })
        await page.locator('[data-testid="toolbar-shapes"]').click({ force: true })
        await shapeFlyout.waitFor({ state: 'visible' })
      }
      await shapeFlyout.locator(`[data-testid="toolbar-${slot}"]`).click()
      const offset = index * 3
      await page.mouse.move(x - 100 + offset, y - 80 + offset)
      await page.mouse.down()
      await page.mouse.move(x + 20 + offset, y + 20 + offset, { steps: 5 })
      await page.mouse.up()
      await page.waitForTimeout(50)
      const oneShotShape = await page.evaluate(() => ({
        activeTool: window.__probe.api.getAppState().activeTool,
        elements: window.__probe.api.getSceneElements(),
      }))
      const expectedNativeKind = ['rounded-rectangle', 'ellipse', 'diamond'].includes(slot) ? null : slot
      const created = oneShotShape.elements.at(-1)
      if (oneShotShape.activeTool.type !== 'selection' || oneShotShape.activeTool.locked) {
        throw new Error(`production shape ${slot} did not return to unlocked selection: ${JSON.stringify(oneShotShape.activeTool)}`)
      }
      if (!created || created.strokeWidth !== 1 || created.strokeStyle !== 'solid' || created.roughness !== 0) {
        throw new Error(`production shape ${slot} did not use the requested basic style: ${JSON.stringify(created)}`)
      }
      if (expectedNativeKind && created.customData?.nativeShapeKind !== expectedNativeKind) {
        throw new Error(`production slot ${slot} created the wrong native shape: ${JSON.stringify(created.customData)}`)
      }
      const countAfterFirstDraw = oneShotShape.elements.length
      await page.mouse.move(x + 40 + offset, y + 40 + offset)
      await page.mouse.down()
      await page.mouse.move(x + 80 + offset, y + 80 + offset, { steps: 3 })
      await page.mouse.up()
      await page.waitForTimeout(50)
      const afterSecondDrag = await page.evaluate(() => ({
        activeTool: window.__probe.api.getAppState().activeTool,
        elementCount: window.__probe.api.getSceneElements().length,
      }))
      if (afterSecondDrag.activeTool.type !== 'selection' || afterSecondDrag.elementCount !== countAfterFirstDraw) {
        throw new Error(`production shape ${slot} stayed armed after its first draw: ${JSON.stringify({ countAfterFirstDraw, afterSecondDrag })}`)
      }
    }
    // Keep the remainder of this broad probe independent: shapes span the coordinates used by the
    // existing text-input checks and would otherwise turn their click into bound-text editing.
    await page.evaluate(() => window.__probe.api.updateScene({ elements: [] }))

    await page.evaluate(() => navigator.clipboard.writeText('Production pasted text'))
    await page.mouse.click(x, y, { button: 'right' })
    const pasteItem = page.getByRole('menuitem', { name: '粘贴' })
    await pasteItem.click()
    await page.getByTestId('paste-feedback').filter({ hasText: 'success' }).waitFor()
    await pasteItem.waitFor({ state: 'hidden' })
    await page.waitForTimeout(500)
    const pastedElements = await page.evaluate(() => window.__probe.api.getSceneElements().map((element) => ({ type: element.type, text: element.text })))
    if (!pastedElements.some((element) => element.text === 'Production pasted text')) {
      throw new Error(`production context-menu paste did not create text: ${JSON.stringify(pastedElements)}`)
    }

    await context.clearPermissions()
    await page.mouse.click(x + 30, y + 30, { button: 'right' })
    const deniedPasteItem = page.getByRole('menuitem', { name: '粘贴' })
    await deniedPasteItem.click()
    await page.getByTestId('paste-feedback').filter({ hasText: 'failure' }).waitFor()
    if (!(await deniedPasteItem.isVisible())) throw new Error('production paste failure closed the context menu')
    await page.keyboard.press('Escape')

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
    if (errors.length || consoleErrors.length) {
      throw new Error(`production browser errors: ${JSON.stringify({ errors, consoleErrors })}`)
    }
    console.log('Excalidraw production one-shot basic native shape, database icon, context-menu paste, zh-CN search/help, Extra Tools, and text editing verified.')
  } finally {
    await browser.close()
  }
} finally {
  preview?.kill('SIGTERM')
  if (process.env.KEEP_EXCALIDRAW_PROBE !== '1') {
    await rm(probe, { recursive: true, force: true })
  }
}
