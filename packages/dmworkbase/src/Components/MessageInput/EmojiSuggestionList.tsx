import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import type { EmojiSuggestItem } from '../../Utils/emojiSuggestion'
import './EmojiSuggestionList.css'

interface EmojiSuggestionListProps {
  items: EmojiSuggestItem[]
  command: (item: EmojiSuggestItem) => void
}

type InteractionMode = 'keyboard' | 'mouse'

/**
 * 表情前缀联想候选条。形态为输入法风格的「横向候选条」（一行内横排多个表情
 * 图标 + 名称），刻意区别于 @ 提及的竖向成员列表。
 *
 * 暴露 onKeyDown 供 Tiptap Suggestion 在激活时驱动键盘选择：横向条以左右键
 * 切换（同时兼容上下键），Enter 选中。鼠标 hover 高亮、点击选中。
 */
export default forwardRef((props: EmojiSuggestionListProps, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [interactionMode, setInteractionMode] =
    useState<InteractionMode>('keyboard')
  const selectedIndexRef = useRef(0)

  const selectItem = (index: number) => {
    const item = props.items[index]
    if (item) {
      props.command(item)
    }
  }

  const moveSelection = (direction: 'prev' | 'next') => {
    if (!props.items.length) return
    const len = props.items.length
    const next =
      direction === 'prev'
        ? (selectedIndexRef.current + len - 1) % len
        : (selectedIndexRef.current + 1) % len
    selectedIndexRef.current = next
    setSelectedIndex(next)
    setInteractionMode('keyboard')
  }

  useEffect(() => {
    selectedIndexRef.current = 0
    setSelectedIndex(0)
    setInteractionMode('keyboard')
  }, [props.items])

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      // 横向候选条：左右键为主，上下键兼容
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        moveSelection('prev')
        return true
      }
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        moveSelection('next')
        return true
      }
      if (event.key === 'Enter') {
        selectItem(selectedIndexRef.current)
        return true
      }
      return false
    },
  }))

  if (!props.items.length) {
    return null
  }

  return (
    <div
      className={`emoji-suggestion-bar emoji-suggestion-bar--${interactionMode}`}
      role="listbox"
    >
      {props.items.map((item, index) => {
        const isSelected =
          interactionMode === 'keyboard' && index === selectedIndex

        return (
          <div
            className={`emoji-suggestion-cell ${isSelected ? 'is-selected' : ''}`}
            key={item.key}
            role="option"
            aria-selected={isSelected}
            onMouseEnter={() => {
              setInteractionMode('mouse')
              selectedIndexRef.current = index
            }}
            onClick={() => selectItem(index)}
          >
            <img
              className="emoji-suggestion-icon"
              src={item.image}
              alt={item.label}
            />
            <span className="emoji-suggestion-name">{item.label}</span>
          </div>
        )
      })}
    </div>
  )
})
