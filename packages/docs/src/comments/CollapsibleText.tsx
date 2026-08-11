// 长评论正文折叠 + 「展开全文」(原型 `.comment-text.is-collapsible` / `.comment-expand`)。
//
// 为什么需要:Bot 的答复经常是十几行(改了什么、依据在哪、锚点在哪),一条就把侧栏顶满,
// 后面几条评论被推到看不见的地方。原型对根评论截 5 行、对回复截 3 行。
//
// 关键是**量出来的**溢出,而不是按字数猜:折叠靠 `-webkit-line-clamp`,渲染宽度、字号、
// 换行都会影响实际行数,按 body.length 猜必然在中文/英文、宽窄面板之间两头不准 —— 短文本
// 挂个没用的「展开全文」，或者长文本被截了却没有展开入口(那就是内容永久看不到)。所以
// 这里读 scrollHeight 与 lineHeight 比。clamp 配 overflow:hidden 时 scrollHeight 仍是完整
// 内容高度,折叠状态下也能量,不用先展开再收起(那会闪一帧)。

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { t } from '../octoweb/index.ts'

export function CollapsibleText({
  lineLimit,
  className,
  children,
}: {
  /** 折叠时保留的行数。原型:根评论 5,回复 3。 */
  lineLimit: number
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [overflows, setOverflows] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    const lineHeight = Number.parseFloat(window.getComputedStyle(el).lineHeight)
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
      // line-height: normal 量不出具体像素值。此时宁可不给折叠入口 —— 挂一个点了没反应
      // 的按钮比不挂更糟。
      setOverflows(false)
      return
    }
    // +1 抵掉亚像素:正好 N 行的文本 scrollHeight 常比 N*lineHeight 大零点几,不留余量
    // 会给每条短评论都挂上「展开全文」。
    setOverflows(el.scrollHeight > lineHeight * lineLimit + 1)
  }, [lineLimit])

  // 首次渲染后立刻量,且要在绘制前 —— 用 useEffect 的话「展开全文」会晚一帧出现,肉眼可见地闪。
  useLayoutEffect(measure, [measure, children])

  // 面板可以拖宽,宽度一变行数就变。ResizeObserver 比 window resize 准:侧栏宽度变化
  // 不一定伴随窗口 resize 事件。
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measure())
    observer.observe(el)
    return () => observer.disconnect()
  }, [measure])

  const collapsed = overflows && !expanded
  const classes = ['octo-comment-text']
  if (className) classes.push(className)
  if (overflows) classes.push('is-collapsible')
  if (collapsed) classes.push('is-collapsed')

  return (
    <>
      <p
        ref={ref}
        className={classes.join(' ')}
        style={collapsed ? { WebkitLineClamp: lineLimit } : undefined}
      >
        {children}
      </p>
      {overflows && (
        <button
          type="button"
          className="octo-comment-expand"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? t('docs.comment.collapseText') : t('docs.comment.expandText')}
        </button>
      )}
    </>
  )
}
