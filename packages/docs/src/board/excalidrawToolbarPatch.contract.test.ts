import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const packageRoot = dirname(dirname(dirname(require.resolve('@excalidraw/excalidraw'))))
const bundles = ['dev', 'prod'].map((mode) => ({
  mode,
  source: readdirSync(join(packageRoot, 'dist', mode))
    .filter((file) => file.endsWith('.js') && !file.endsWith('.js.map'))
    .map((file) => readFileSync(join(packageRoot, 'dist', mode, file), 'utf8'))
    .join('\n'),
  zhCN: readFileSync(
    join(
      packageRoot,
      'dist',
      mode,
      'locales',
      readdirSync(join(packageRoot, 'dist', mode, 'locales')).find((file) => file.startsWith('zh-CN-') && file.endsWith('.js'))!,
    ),
    'utf8',
  ),
}))

describe.each(bundles)('patched Excalidraw $mode toolbar contract', ({ mode, source, zhCN }) => {
  it('defaults to straight and emits a real three-point path only for curved arrows', () => {
    expect(source).toMatch(/currentItemArrowType[\s\S]{0,80}(?:ARROW_TYPE|\w+)\.sharp/)
    expect(source).toMatch(/currentItemRoundness[\s\S]{0,40}["']sharp["']/)
    expect(source).toContain('__octoCurvedLinearPoints')
    expect(source).toMatch(/(?:points|\w+)\.length\s*===\s*3\s*&&\s*(?:newElement\w*|\w+)\.roundness/)
    expect(source).toMatch(/__octoCurvedLinearPoints\(\w+,\s*\w+\)/)
    expect(source).toMatch(/roundness:\s*this\.state\.currentItemArrowType\s*===\s*(?:ARROW_TYPE|\w+)\.round/)
  })

  it('keeps English labels and localizes the requested Simplified Chinese labels', () => {
    expect(source).toContain('More options')
    expect(source).toContain('Arrow type')
    expect(source).toContain('toolBar.extraTools')
    expect(source).toContain('toolBar.mermaidToExcalidraw')
    expect(zhCN).toContain('nextResult')
    expect(zhCN).toContain('previousResult')
    expect(zhCN).toContain('elementLink')
    expect(zhCN).toContain('emptyWebEmbed')
    expect(zhCN).toMatch(/excalidrawLib:\s*["']\\u7D20\\u6750\\u5E93["']/)
    expect(zhCN).not.toMatch(/excalidrawLib:\s*["']Excalidraw/)
  })

  it('renders the database toolbar preview with the same single rim seam as the canvas shape', () => {
    // Canvas geometry has one top-rim seam. A second middle seam made the toolbar preview look like
    // a different database shape even though the created canvas element was correct.
    expect(source).toContain('M4 6c0-3 16-3 16 0v12c0 3-16 3-16 0ZM4 6c0 3 16 3 16 0')
    expect(source).not.toContain('M4 12c0 2 16 2 16 0')
    expect(source).not.toContain('m-16 6c0 2 16 2 16 0')
  })

  it('renders merged shape and line primaries without caret controls', () => {
    expect(source).toMatch(/data-testid"?:\s*"toolbar-shapes"/)
    expect(source).toMatch(/data-testid"?:\s*"toolbar-lines"/)
    expect(source).not.toContain('toolbar-shapes-caret')
    expect(source).not.toContain('toolbar-lines-caret')
  })

  it('opens all 21 shapes directly and opens the matching line flyout in one click', () => {
    // Primary buttons are pure toggles: opening a flyout must not preselect rectangle/arrow.
    expect(source).toMatch(/toolbar-shapes"[\s\S]{0,260}(?:setShapeOpen|\bl)\((?:nextOpen|\w+)\)[\s\S]{0,80}(?:setLineOpen|\bd)\((?:false|!1)\)/)
    expect(source).toMatch(/toolbar-lines"[\s\S]{0,260}(?:setLineOpen|\bd)\((?:nextOpen|\w+)\)[\s\S]{0,80}(?:setShapeOpen|\bl)\((?:false|!1)\)/)
    expect(source).not.toMatch(/toolbar-shapes"[\s\S]{0,260}(?:selectShape|\bh)\("rectangle"\)/)
    expect(source).not.toMatch(/toolbar-lines"[\s\S]{0,260}(?:selectLine|\bu)\("arrow"\)/)
    expect(source).toContain('toolbar-shapes-flyout')
    expect(source).toContain('toolbar-lines-flyout')
    expect(source).toMatch(/shapeFlyout\.map/)
    expect(source).not.toContain('toolbar-shapes-expand')
    expect(source).not.toContain('toolbar-shapes-collapse')
    expect(source).not.toContain('shapeExpanded')
    expect(source).not.toContain('compactShapeSlots')
    expect(source).not.toContain('data-expanded')
    expect(source).toMatch(/toolbar-shapes"[\s\S]{0,260}aria-expanded/)
    expect(source).toMatch(/toolbar-shapes"[\s\S]{0,280}aria-controls["']?:\s*["']toolbar-shapes-flyout["']/)
    expect(source).toMatch(/toolbar-lines"[\s\S]{0,260}aria-expanded/)
    expect(source).toMatch(/toolbar-lines"[\s\S]{0,280}aria-controls["']?:\s*["']toolbar-lines-flyout["']/)
    expect(source).toMatch(/(?:createPortal|gg)\(/)
    expect(source).toMatch(/position:\s*"fixed"/)
    // The flyouts are portalled to document.body, outside Excalidraw's CSS-variable scope. Mirror
    // the existing More tools surface with its resolved opaque theme colours, text, padding, and
    // island shadow so the native flyouts do not look brighter than the adjacent dropdown.
    expect(source).toMatch(/background:\s*(?:appState\.theme|\w+\.theme)\s*===\s*"dark"\s*\?\s*"#232329"\s*:\s*"#ffffff"/)
    expect(source).toMatch(/color:\s*(?:appState\.theme|\w+\.theme)\s*===\s*"dark"\s*\?\s*"#e3e3e8"\s*:\s*"#1b1b1f"/)
    expect(source).toMatch(/border:\s*0/)
    expect(source).toMatch(/boxShadow:\s*"0px 0px 0\.9310142993927002px 0px rgba\(0, 0, 0, 0\.17\), 0px 0px 3\.1270833015441895px 0px rgba\(0, 0, 0, 0\.08\), 0px 7px 14px 0px rgba\(0, 0, 0, 0\.05\)"/)
    expect(source).toMatch(/padding:\s*8/)
    expect(source).toMatch(/document\.addEventListener\("keydown"/)
    expect(source).toMatch(/document\.addEventListener\("pointerdown"/)
    // Historical inverted triangles remain readable through geometry helpers but are intentionally
    // absent from the current 21-item toolbar and its icon switch.
    expect(source).not.toMatch(/["']inverted-triangle["']\s*:\s*(?:\/\*[^*]*\*\/\s*)?(?:jsx\w*|K)\(/)
  })

  it('lays out the ten primary slots in the fixed 1-0 order', () => {
    // Slots 1 selection, 2 shapes, 3 lines, 4 freedraw, 5 laser, 6 text,
    // 7 embeddable, 8 image, 9 canvas-color, 0 eraser.
    const shapes = source.indexOf('toolbar-shapes"')
    const lines = source.indexOf('toolbar-lines"')
    const laser = source.indexOf('toolbar-laser')
    const embeddable = source.indexOf('toolbar-embeddable')
    const canvasColor = source.indexOf('toolbar-canvas-color')

    expect(shapes).toBeGreaterThan(-1)
    expect(lines).toBeGreaterThan(shapes)
    expect(laser).toBeGreaterThan(lines)
    expect(embeddable).toBeGreaterThan(laser)
    expect(canvasColor).toBeGreaterThan(embeddable)

    // The remaining primaries are rendered from the SHAPES table via renderTool,
    // interleaved between the explicit buttons at the requested numeric slots.
    expect(source).toMatch(/renderTool\("freedraw",\s*"4"\)/)
    expect(source).toMatch(/renderTool\("text",\s*"6"\)/)
    expect(source).toMatch(/renderTool\("image",\s*"8"\)/)
    expect(source).toMatch(/renderTool\("eraser",\s*"0"\)/)

    // The three explicit non-SHAPES tools carry their new numeric labels.
    expect(source).toMatch(/keyBindingLabel:\s*"3"[\s\S]{0,120}toolbar-lines"/)
    expect(source).toMatch(/keyBindingLabel:\s*"5"[\s\S]{0,120}toolbar-laser/)
    expect(source).toMatch(/keyBindingLabel:\s*"7"[\s\S]{0,120}toolbar-embeddable/)
    expect(source).toMatch(/keyBindingLabel:\s*"9"[\s\S]{0,120}toolbar-canvas-color/)

    expect(source.match(/data-testid"?:\s*"toolbar-canvas-color"/g)).toHaveLength(1)
    expect(source.match(/data-testid"?:\s*"toolbar-embeddable"/g)).toHaveLength(1)
    expect(source.match(/data-testid"?:\s*"toolbar-laser"/g)).toHaveLength(1)
  })

  it('maps the digit keyboard shortcuts to the matching tools', () => {
    // The visible 1–0 order is also the complete numeric keyboard contract.
    expect(source).toMatch(/(?:KEYS\["1"\]|C\[1\])\)?\s*\{[\s\S]{0,90}type:\s*"selection"/)
    expect(source).toMatch(/(?:KEYS\["2"\]|C\[2\])\)?\s*\{[\s\S]{0,90}type:\s*"rectangle"/)
    expect(source).toMatch(/(?:KEYS\["3"\]|C\[3\])\)?\s*\{[\s\S]{0,90}type:\s*"arrow"/)
    expect(source).toMatch(/(?:KEYS\["4"\]|C\[4\])\)?\s*\{[\s\S]{0,90}type:\s*"freedraw"/)
    expect(source).toMatch(/(?:KEYS\["5"\]|C\[5\])\)?\s*\{[\s\S]{0,90}type:\s*"laser"/)
    expect(source).toMatch(/(?:KEYS\["6"\]|C\[6\])\)?\s*\{[\s\S]{0,90}type:\s*"text"/)
    expect(source).toMatch(/(?:KEYS\["7"\]|C\[7\])\)?\s*\{[\s\S]{0,90}type:\s*"embeddable"/)
    expect(source).toMatch(/(?:KEYS\["8"\]|C\[8\])\)?\s*\{[\s\S]{0,90}type:\s*"image"/)
    expect(source).toMatch(/(?:KEYS\["0"\]|C\[0\])\)?\s*\{[\s\S]{0,90}type:\s*"eraser"/)
    // Digit 9 no longer opens Excalidraw's native left-side canvas menu. It dispatches the app-owned
    // document event so BoardCanvasColorControl opens the shared picker — so the handler must emit the
    // event and must NOT set openMenu/openPopup (which would reopen the native panel).
    expect(source).toMatch(/(?:KEYS\["9"\]|C\[9\])\)?\s*\{[\s\S]{0,160}octo-board-canvas-color-request/)
    expect(source).not.toMatch(/(?:KEYS\["9"\]|C\[9\])\)?\s*\{[\s\S]{0,160}openMenu[\s\S]{0,40}"canvas"/)
  })

  it('keeps global underline across colour runs at a fixed width', () => {
    // A colour boundary flushes the previous underline before the next run records its start. The
    // stroke remains a fixed 1px regardless of the run's font size.
    expect(source).toMatch(/(?:segmentUnderlineWidth\s*=\s*1|const\s+\w+\s*=\s*1;[^\n]{0,180}(?:underlineStart|_))/)
    // Regression guard (yujiawei P2-1): the per-segment underline width the draw path strokes must be
    // the literal 1px constant, never re-derived from a font size. The prior negative targeted
    // `.style.fontSize / 14`, a shape the patch never emitted, so it could not fail; anchor it on the
    // patch's own `segmentUnderlineWidth` binding and reject any division. (The dead layout value
    // `underlineWidth = Math.max(1, maxFontSize / 14)` and the strikethrough stroke `fontSize / 14`
    // are separate code paths with separate names, so this does not fire on them; the positive above
    // covers the prod-minified draw path where `segmentUnderlineWidth` is renamed.)
    expect(source).not.toMatch(/segmentUnderlineWidth\s*=\s*[^;\n]*\/\s*\d/)
    expect(source).toMatch(/(?:flushUnderline\(x\)|\w+\(y\))[\s\S]{0,300}(?:underlineStart\s*===\s*null|_===null)/)
  })

  it('keeps group-resized text width-owned by disabling autoResize', () => {
    // This is an intentional divergence from upstream: a multi-selection resize changes the text
    // box width and lets rich-text measurement determine its height instead of scaling glyphs or
    // immediately growing the box again. Pin the one-way autoResize transition so regenerating the
    // vendor patch cannot silently restore the upstream behaviour.
    //
    // Anchored on the patch's own group-resize hunk (yujiawei P2-1): a sole-property
    // `{ autoResize: false }` object handed to a mutate call, immediately followed by the
    // `redrawTextBoundingBox(element, null, …)` the patch inserts (its second argument is `null`).
    // Upstream's own autoResize sites are multi-property or are not followed by a null-second-arg
    // call, so — unlike the previous `\w+\(…\)` alternations, which degraded to "any call" and matched
    // the pristine bundle — this matches ONLY the inserted hunk (one occurrence per bundle).
    expect(source).toMatch(/\{\s*autoResize:\s*(?:false|!1)\s*\}[\s\S]{0,60}\w+\(\w+,\s*null\b/)
  })

  it('keeps text corner resize out of the horizontal wrap-only branch', () => {
    expect(source).toMatch(/transformHandleType\s*===\s*"e"\s*\|\|\s*transformHandleType\s*===\s*"w"|\w+==="e"\s*\|\|\s*\w+==="w"/)
    expect(source).not.toMatch(/transformHandleType\.includes\("e"\)\s*\|\|\s*transformHandleType\.includes\("w"\)/)
  })

  it('draws one basic-style shape and then returns to selection', () => {
    // Shape presets apply basic style directly to the one element being created. They never mutate
    // persisted currentItem* defaults, so opening the flyout cannot restyle later line/text tools.
    expect(source).toMatch(/__octoBasicShapeStyle/)
    expect(source).toMatch(/strokeWidth:\s*[^,?]+\?\s*1\s*:/)
    expect(source).toMatch(/strokeStyle:\s*[^,?]+\?\s*"solid"\s*:/)
    expect(source).toMatch(/roughness:\s*[^,?]+\?\s*0\s*:/)
    expect(source).not.toMatch(/setAppState\(\{[^}]*currentItemStrokeWidth:\s*1/)

    // Shapes are intentionally one-shot: unlocked tools return to selection after the first draw.
    expect(source).toMatch(/setActiveTool\(\{[\s\S]{0,120}locked:\s*(?:false|!1)[\s\S]{0,20}\}\)/)
    expect(source).not.toMatch(/__octoBasicShapeStyle[\s\S]{0,180}locked:\s*(?:true|!0)/)

    // Once a custom element owns nativeShapeKind, creation immediately drops the transient preset.
    // Completion then runs the public selection transition in a setState callback, after the current
    // pointer-up state batch, so no later update in that batch can re-arm the custom tool.
    expect(source).toMatch(/getOctoNativeShapeElementProps|\w+\(\w+\)[\s\S]{0,100}__octoShapeVariant\s*=\s*null/)
    expect(source).toMatch(/(?:newElement\w*|\w+)\??\.customData\??\.nativeShapeKind/)
    expect(source).toMatch(/setState\([^)]*newElement:\s*null[\s\S]{0,120}\(\)\s*=>\s*\{?[\s\S]{0,80}setActiveTool\(\{\s*type:\s*"selection",\s*locked:\s*(?:false|!1)/)
    expect(source).toMatch(/\.type\s*===\s*"selection"\s*\?\s*\{[\s\S]{0,60}locked:\s*(?:false|!1)/)
    expect(source).toMatch(/\["rectangle",\s*"diamond",\s*"ellipse"\]\.includes\([^)]+\.type\)[\s\S]{0,60}__octoShapeVariant\s*=\s*null/)
  })

  it('routes the slot-9 canvas-colour button and the digit-9 shortcut through the app-owned event', () => {
    // The toolbar button dispatches the custom event instead of toggling the native canvas menu, so
    // clicking it (or pressing 9) never opens Excalidraw's left-side panel.
    expect(source).toMatch(/toolbar-canvas-color"[\s\S]{0,60}onClick[\s\S]{0,100}octo-board-canvas-color-request/)
    expect(source).not.toMatch(/toolbar-canvas-color"[\s\S]{0,60}onClick[\s\S]{0,120}openMenu/)
    // Emitted from both the button and the digit-9 keydown handler.
    expect((source.match(/octo-board-canvas-color-request/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })


  it('keeps shape, line, and more-tools flyouts mutually exclusive', () => {
    // Opening either native flyout closes More tools first; opening More tools closes both native
    // flyouts. This prevents the portalled shape row from overlapping the dropdown menu.
    expect(source).toMatch(/toolbar-shapes"[\s\S]{0,320}(?:setIsExtraToolsMenuOpen|\bB)\((?:false|!1)\)[\s\S]{0,120}(?:setShapeOpen|\bl)\((?:nextOpen|\w+)\)[\s\S]{0,80}(?:setLineOpen|\bd)\((?:false|!1)\)/)
    expect(source).toMatch(/toolbar-lines"[\s\S]{0,320}(?:setIsExtraToolsMenuOpen|\bB)\((?:false|!1)\)[\s\S]{0,120}(?:setLineOpen|\bd)\((?:nextOpen|\w+)\)[\s\S]{0,80}(?:setShapeOpen|\bl)\((?:false|!1)\)/)
    expect(source).toMatch(/App-toolbar__extra-tools-trigger[\s\S]{0,320}onToggle:[\s\S]{0,220}(?:setShapeOpen|\bl)\((?:false|!1)\)[\s\S]{0,100}(?:setLineOpen|\bd)\((?:false|!1)\)/)
  })

  it('restores the complete more-tools dropdown at the toolbar end', () => {
    const extraTools = source.indexOf('toolbar-extra-tools')
    const eraser = source.indexOf('renderTool("eraser", "0")') >= 0
      ? source.indexOf('renderTool("eraser", "0")')
      : source.indexOf('renderTool("eraser","0")')

    expect(extraTools).toBeGreaterThan(eraser)
    expect(source).toContain('App-toolbar__extra-tools-trigger')
    expect(source).toContain('App-toolbar__extra-tools-dropdown')
    expect(source).toMatch(/aria-label[\s\S]{0,160}toolbar-extra-tools|toolbar-extra-tools[\s\S]{0,160}aria-label/)
    expect(source).toContain('toolbar-frame')
    expect(source).toContain('toolbar-search')
    // The redundant canvas-colour entry is removed from 更多工具 — slot 9 owns it now.
    expect(source).not.toContain('toolbar-more-canvas-color')
    expect(source).toContain('toolbar-reset-canvas')
    expect(source).toMatch(/margin:\s*["']6px 0["'][\s\S]{0,120}fontWeight:\s*600[\s\S]{0,120}Generate/)
    expect(source).toContain('toolbar-mermaid')
    expect(source).toMatch(/toolbar-mermaid[\s\S]{0,260}Shift\+M|Shift\+M[\s\S]{0,260}toolbar-mermaid/)
    expect(source).toMatch(/toolbar-mermaid[\s\S]{0,300}mermaidToExcalidraw|mermaidToExcalidraw[\s\S]{0,300}toolbar-mermaid/)
    // Preserve Excalidraw's original DropdownMenu composition and styling. The production bundle
    // may bind Trigger/Content/Item implementations directly because static component properties
    // can be removed by the host app's second tree-shaking pass; dev keeps the original properties.
    const extraToolsBlock = source.slice(
      Math.max(0, source.indexOf('App-toolbar__extra-tools-trigger') - 500),
      source.indexOf('toolbar-mermaid') + 500,
    )
    expect(extraToolsBlock).toMatch(/children:\s*(?:extraToolsIcon|octoExtraToolsIcon|[A-Za-z_$][\w$]*)/)
    expect(extraToolsBlock).not.toContain('M5 12a2 2 0 1 0 0 .01M12 12a2 2 0 1 0 0 .01M19 12a2 2 0 1 0 0 .01')
    expect(extraToolsBlock).toMatch(/(?:(?:DropdownMenu_default\.Trigger|DropdownMenuTrigger_default)|\biI)\s*,\s*\{[^}]*App-toolbar__extra-tools-trigger/)
    expect(extraToolsBlock).toMatch(/(?:(?:DropdownMenu_default\.Content|DropdownMenuContent_default)|\bhI)\s*,\s*\{[^}]*App-toolbar__extra-tools-dropdown/)
    expect(extraToolsBlock.match(/(?:(?:DropdownMenu_default\.Item|DropdownMenuItem_default)|\bTt)\s*,\s*\{/g)).toHaveLength(4)
    expect(source).toContain('dropdown-menu-container')
    // Keep the menu in the toolbar's native positioning context. Moving this one menu to body
    // breaks the original right/below anchoring unless the complete dropdown positioning system moves too.
    expect(extraToolsBlock).not.toMatch(/(?:createPortal|gg)\([\s\S]{0,200}document\.body/)
    expect(extraToolsBlock).not.toMatch(/width:\s*190|position:\s*["']fixed["']/)
    expect(source).not.toContain('toolbar-more-canvas-color')
  })

  it('localizes icon-only search controls and sidebar tabs', () => {
    expect(source).toMatch(/search\.nextResult[\s\S]{0,100}aria-label|aria-label[\s\S]{0,100}search\.nextResult/)
    expect(source).toMatch(/search\.previousResult[\s\S]{0,100}aria-label|aria-label[\s\S]{0,100}search\.previousResult/)
    expect(source).toMatch(/search\.title[\s\S]{0,120}aria-label|aria-label[\s\S]{0,120}search\.title/)
    expect(source).toMatch(/toolBar\.library[\s\S]{0,120}aria-label|aria-label[\s\S]{0,120}toolBar\.library/)
    expect(source).not.toContain('library.title')
  })

  it('localizes delayed toolbar hints and lists only the current 1-0 mapping in keyboard help', () => {
    const toolbar = source.slice(source.indexOf('toolbar-shapes') - 800, source.indexOf('toolbar-canvas-color') + 500)
    expect(toolbar).not.toMatch(/Shapes .{0,20}R or 2|Lines .{0,20}A\/L or 3|5 or K/)
    expect(toolbar).toMatch(/(?:形状|\"Shapes\")[\s\S]{0,50}(?:—|\u2014) 2/)
    expect(toolbar).toMatch(/(?:线条|\"Lines\")[\s\S]{0,50}(?:—|\u2014) 3/)

    const help = source.slice(source.indexOf('HelpDialog'))
    expect(help).toMatch(/toolBar\.selection[\s\S]{0,100}(?:KEYS\["1"\]|C\[1\])/)
    expect(help).toMatch(/(?:形状|Shapes)[\s\S]{0,100}(?:KEYS\["2"\]|C\[2\])/)
    expect(help).toMatch(/(?:线条|Lines)[\s\S]{0,100}(?:KEYS\["3"\]|C\[3\])/)
    expect(help).toMatch(/toolBar\.freedraw[\s\S]{0,100}(?:KEYS\["4"\]|C\[4\])/)
    expect(help).toMatch(/toolBar\.laser[\s\S]{0,100}(?:KEYS\["5"\]|C\[5\])/)
    expect(help).toMatch(/toolBar\.text[\s\S]{0,100}(?:KEYS\["6"\]|C\[6\])/)
    expect(help).toMatch(/toolBar\.embeddable[\s\S]{0,100}(?:KEYS\["7"\]|C\[7\])/)
    expect(help).toMatch(/toolBar\.image[\s\S]{0,100}(?:KEYS\["8"\]|C\[8\])/)
    expect(help).toMatch(/labels\.canvasBackground[\s\S]{0,100}(?:KEYS\["9"\]|C\[9\])/)
    expect(help).toMatch(/toolBar\.eraser[\s\S]{0,100}(?:KEYS\["0"\]|C\[0\])/)
    expect(help).not.toMatch(/toolBar\.selection[\s\S]{0,100}(?:KEYS\.V|C\.V)/)
    expect(help).not.toMatch(/toolBar\.laser[\s\S]{0,100}(?:KEYS\.K|C\.K)/)
    expect(help).not.toMatch(/helpDialog\.(?:curvedArrow|curvedLine)/)
    expect(help).toMatch(/toolBar\.mermaidToExcalidraw[\s\S]{0,100}Shift\+M/)
    expect(help).not.toMatch(/Toggle grid|Canvas & Shape properties|Command palette|Create a flowchart from a generic element|Navigate a flowchart|Show font picker|Mermaid 至 Excalidraw/)
  })

  it('opens the Mermaid dialog from the displayed Shift+M shortcut', () => {
    expect(source).toMatch(/shiftKey[\s\S]{0,100}toLocaleLowerCase\(\)[\s\S]{0,20}["']m["'][\s\S]{0,180}openDialog:[\s\S]{0,40}name:[\s\S]{0,10}["']ttd["'][\s\S]{0,30}tab:[\s\S]{0,10}["']mermaid["']/)
  })

  it('arms the picked line variant as an appState default the next arrow inherits', () => {
    // Regression: clicking the "curved" flyout slot changed only the menu highlight; the next arrow
    // still drew straight. The slot handler must write the currentItem* defaults so the created
    // element inherits the variant (curved → round, elbow → elbow, straight/line → sharp).
    expect(source).toMatch(
      /currentItemArrowType:\s*\w+\s*===\s*"curved"\s*\?\s*"round"\s*:\s*\w+\s*===\s*"elbow"\s*\?\s*"elbow"\s*:\s*"sharp"/,
    )
    expect(source).toMatch(/currentItemRoundness:\s*\w+\s*===\s*"curved"\s*\?\s*"round"\s*:\s*"sharp"/)
  })

  it('derives a freshly-created arrow roundness from the armed arrow type (not just the menu)', () => {
    // The new-arrow factory reads currentItemArrowType, so a round default yields a proportional
    // roundness (a curved arrow) and anything else yields null (a straight arrow). This is what
    // makes the picked variant actually draw, rather than only paint the flyout state.
    expect(source).toMatch(
      /currentItemArrowType\s*===\s*[\w.]+\.round\s*\?\s*\{\s*type:\s*[\w.]+\.PROPORTIONAL_RADIUS/,
    )
  })
})
