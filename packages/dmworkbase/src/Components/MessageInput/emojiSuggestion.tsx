import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion, {
  SuggestionMatch,
  SuggestionOptions,
} from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import tippy, { Instance as TippyInstance } from 'tippy.js'
import EmojiSuggestionList from './EmojiSuggestionList'
import {
  buildEmojiSuggestItems,
  matchEmojiPrefix,
  EmojiSuggestItem,
} from '../../Utils/emojiSuggestion'

/**
 * 表情前缀联想的 Tiptap 扩展，复用 @ 提及同一套 Tiptap Suggestion + tippy 基建。
 *
 * 与 mention 的关键差异：
 * - 无触发字符（char: ''），由自定义 findSuggestionMatch 反向扫描光标前文本做前缀匹配
 * - 选中后插入的是 emoji.key 纯文本（如 "[使命必达]"），不引入任何自定义 node；
 *   表情的图片渲染由发送/接收链路的 emojiRegExp 解析完成（本扩展不参与渲染）
 * - 独立 pluginKey，与 mention(@)/默认 suggestion 并存不冲突
 */

/** 独立 pluginKey，避免与 mention 及默认 suggestion 冲突 */
export const emojiSuggestionPluginKey = new PluginKey('emojiSuggestion')

/**
 * 自定义匹配：取光标前所在文本节点的内容，交给 matchEmojiPrefix 做前缀匹配。
 * range 覆盖光标前的 query 文字，选中后整体替换为表情 key。
 * 不依赖 char / allowedPrefixes 等触发符配置。
 */
function findEmojiSuggestionMatch(config: { $position: any }): SuggestionMatch {
  const { $position } = config
  const nodeBefore = $position.nodeBefore
  const text: string | false | undefined = nodeBefore?.isText && nodeBefore.text

  if (!text) return null

  const matched = matchEmojiPrefix(text)
  if (!matched) return null

  // query 是 text 的后缀，range 从「光标 - query 长度」到光标
  const to = $position.pos
  const from = to - matched.query.length

  return {
    range: { from, to },
    query: matched.query,
    text: matched.query,
  }
}

export function createEmojiSuggestionExtension(
  onActiveChange?: (active: boolean) => void,
): Extension {
  const suggestion: Omit<SuggestionOptions<EmojiSuggestItem>, 'editor'> = {
    pluginKey: emojiSuggestionPluginKey,
    char: '',
    allowSpaces: false,
    // 关闭「触发符前需空格」限制，否则句中输入不会触发
    allowedPrefixes: null,
    findSuggestionMatch: findEmojiSuggestionMatch,

    items: ({ query }) => {
      // 不在此处用 editor.view.composing 拦截：表情名 query 完全经中文输入法
      // 上屏，compositionend 派发的插入事务跑到这里时 view.composing 往往仍为
      // true，会把首次匹配的列表吞成空 → onStart 因 items 为空不建弹窗 → 此后
      // 无新输入便永久不弹（表现为「粘贴能联想、键入不联想」）。
      // 组合期 ProseMirror 不向 doc 写入拼音中间态，apply 的 findSuggestionMatch
      // 拿不到拼音串，去掉此拦截不会引入组合期误触发。
      return buildEmojiSuggestItems(query)
    },

    command: ({ editor, range, props }) => {
      // 把光标前的 query 文字替换为表情 key 纯文本（第一版不追加空格）
      editor.chain().focus().insertContentAt(range, props.key).run()
    },

    render: () => {
      let component: ReactRenderer
      let popup: TippyInstance[]

      return {
        onStart: (props: any) => {
          if (!props.items?.length) return

          onActiveChange?.(true)
          component = new ReactRenderer(EmojiSuggestionList, {
            props,
            editor: props.editor,
          })

          if (!props.clientRect) return

          popup = tippy('body', {
            getReferenceClientRect: props.clientRect,
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: 'manual',
            placement: 'bottom-start',
          })
        },

        onUpdate(props: any) {
          if (!component) return

          component.updateProps(props)

          if (!props.items?.length) {
            popup?.[0]?.hide()
            return
          }

          popup?.[0]?.show()

          if (!props.clientRect) return

          popup[0].setProps({
            getReferenceClientRect: props.clientRect,
          })
        },

        onKeyDown(props: any) {
          if (!component) return false

          if (props.event.key === 'Escape') {
            popup?.[0]?.hide()
            return true
          }

          return component.ref?.onKeyDown(props)
        },

        onExit() {
          onActiveChange?.(false)
          popup?.[0]?.destroy()
          component?.destroy()
        },
      }
    },
  }

  return Extension.create({
    name: 'emojiSuggestion',
    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          ...suggestion,
        }),
      ]
    },
  })
}
