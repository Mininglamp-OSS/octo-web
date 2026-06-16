import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import AiBadge from '../AiBadge'
import { useI18n } from '../../i18n'
import './MentionList.css'

interface MemberItem {
  uid: string
  name: string
  icon: string
  isBot?: boolean
  id?: string
  display?: string
  /**
   * 外部群成员相对当前查看 Space 的来源 Space 名称，用于「@SpaceName」
   * 企微风格后缀。由 MessageInput 透传；同 Space / 自己 / 非外部时为空字符串。
   */
  sourceSpaceName?: string
}

interface MentionListProps {
  items: MemberItem[]
  command: (item: { id: string; label: string }) => void
}

type InteractionMode = 'keyboard' | 'mouse'
type KeyboardDirection = 'up' | 'down'
type PointerPosition = { x: number; y: number }

const SCROLL_EDGE_EPSILON = 1
const POINTER_MOVE_EPSILON = 1

export default forwardRef((props: MentionListProps, ref) => {
  const { t } = useI18n()
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [interactionMode, setInteractionMode] =
    useState<InteractionMode>('keyboard')
  const listRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  const selectedIndexRef = useRef(0)
  const hoveredIndexRef = useRef<number | null>(null)
  const interactionModeRef = useRef<InteractionMode>('keyboard')
  const suppressMouseHoverUntilMoveRef = useRef(false)
  const lastPointerPositionRef = useRef<PointerPosition | null>(null)

  const selectItem = (index: number) => {
    const item = props.items[index]
    if (item) {
      props.command({
        id: item.uid || item.id,
        label: item.name || item.display,
      })
    }
  }

  const scrollKeyboardItemIntoView = (index: number, direction: KeyboardDirection) => {
    const list = listRef.current
    const item = itemRefs.current[index]

    if (!list || !item) return

    const itemTop = item.offsetTop
    const itemBottom = itemTop + item.offsetHeight
    const viewTop = list.scrollTop
    const viewBottom = viewTop + list.clientHeight
    let nextScrollTop = viewTop

    if (direction === 'up') {
      if (itemTop < viewTop - SCROLL_EDGE_EPSILON) {
        nextScrollTop = itemTop
      }
    } else if (itemBottom > viewBottom + SCROLL_EDGE_EPSILON) {
      nextScrollTop = itemBottom - list.clientHeight
    }

    const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight)
    const clampedScrollTop = Math.min(Math.max(nextScrollTop, 0), maxScrollTop)

    if (Math.abs(clampedScrollTop - viewTop) > SCROLL_EDGE_EPSILON) {
      list.scrollTop = clampedScrollTop
    }
  }

  const scrollWrappedKeyboardItemIntoView = (direction: KeyboardDirection) => {
    const list = listRef.current
    if (!list) return

    if (direction === 'up') {
      list.scrollTop = Math.max(0, list.scrollHeight - list.clientHeight)
    } else {
      list.scrollTop = 0
    }
  }

  const moveKeyboardSelection = (direction: KeyboardDirection) => {
    if (!props.items.length) return

    const startingIndex = interactionModeRef.current === 'mouse'
      ? hoveredIndexRef.current ?? selectedIndexRef.current
      : selectedIndexRef.current
    const nextIndex = direction === 'up'
      ? (startingIndex + props.items.length - 1) % props.items.length
      : (startingIndex + 1) % props.items.length
    const wrapped =
      (direction === 'up' && startingIndex === 0) ||
      (direction === 'down' && startingIndex === props.items.length - 1)

    if (wrapped) {
      scrollWrappedKeyboardItemIntoView(direction)
    } else {
      scrollKeyboardItemIntoView(nextIndex, direction)
    }
    selectedIndexRef.current = nextIndex
    suppressMouseHoverUntilMoveRef.current = true
    interactionModeRef.current = 'keyboard'
    setInteractionMode('keyboard')
    hoveredIndexRef.current = null
    setSelectedIndex(nextIndex)
  }

  const upHandler = () => {
    moveKeyboardSelection('up')
  }

  const downHandler = () => {
    moveKeyboardSelection('down')
  }

  const enterHandler = () => {
    const commandIndex = interactionModeRef.current === 'mouse'
      ? hoveredIndexRef.current ?? selectedIndexRef.current
      : selectedIndexRef.current

    selectedIndexRef.current = commandIndex
    interactionModeRef.current = 'keyboard'
    setInteractionMode('keyboard')
    hoveredIndexRef.current = null
    selectItem(commandIndex)
  }

  const hasNativeMouseMovement = (event: React.MouseEvent<HTMLDivElement>) => {
    const nativeEvent = event.nativeEvent as MouseEvent
    return (
      Math.abs(nativeEvent.movementX || 0) > POINTER_MOVE_EPSILON ||
      Math.abs(nativeEvent.movementY || 0) > POINTER_MOVE_EPSILON
    )
  }

  const hasPointerMoved = (pointerPosition: PointerPosition) => {
    const lastPointerPosition = lastPointerPositionRef.current
    if (!lastPointerPosition) return false

    return (
      Math.abs(pointerPosition.x - lastPointerPosition.x) > POINTER_MOVE_EPSILON ||
      Math.abs(pointerPosition.y - lastPointerPosition.y) > POINTER_MOVE_EPSILON
    )
  }

  const mouseHandler = (index: number, event: React.MouseEvent<HTMLDivElement>) => {
    const pointerPosition = { x: event.clientX, y: event.clientY }
    const pointerMoved = hasPointerMoved(pointerPosition)

    if (
      suppressMouseHoverUntilMoveRef.current &&
      (event.type !== 'mousemove' || (!hasNativeMouseMovement(event) && !pointerMoved))
    ) {
      return
    }

    suppressMouseHoverUntilMoveRef.current = false
    lastPointerPositionRef.current = pointerPosition
    interactionModeRef.current = 'mouse'
    setInteractionMode((currentMode) =>
      currentMode === 'mouse' ? currentMode : 'mouse'
    )
    hoveredIndexRef.current = index
  }

  const mouseLeaveHandler = () => {
    if (interactionModeRef.current !== 'mouse') return

    suppressMouseHoverUntilMoveRef.current = false
    lastPointerPositionRef.current = null
    hoveredIndexRef.current = null
    selectedIndexRef.current = 0
    interactionModeRef.current = 'keyboard'
    setSelectedIndex(0)
    setInteractionMode('keyboard')
  }

  useEffect(() => {
    selectedIndexRef.current = 0
    hoveredIndexRef.current = null
    interactionModeRef.current = 'keyboard'
    suppressMouseHoverUntilMoveRef.current = false
    lastPointerPositionRef.current = null
    setSelectedIndex(0)
    setInteractionMode('keyboard')
    if (listRef.current) {
      listRef.current.scrollTop = 0
    }
  }, [props.items])

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: any) => {
      if (event.key === 'ArrowUp') {
        upHandler()
        return true
      }

      if (event.key === 'ArrowDown') {
        downHandler()
        return true
      }

      if (event.key === 'Enter') {
        enterHandler()
        return true
      }

      return false
    },
  }))

  return (
    <div
      ref={listRef}
      className={`mention-list mention-list--${interactionMode}`}
      role="listbox"
      onMouseLeave={mouseLeaveHandler}
    >
      {props.items.length ? (
        props.items.map((item, index) => {
          const isKeyboardSelected =
            interactionMode === 'keyboard' && index === selectedIndex

          return (
            <div
              ref={(el) => {
                itemRefs.current[index] = el
              }}
              className={`mention-list-item ${
                isKeyboardSelected ? 'is-selected' : ''
              }`}
              key={item.uid || item.id || index}
              role="option"
              aria-selected={isKeyboardSelected}
              onMouseEnter={(event) => mouseHandler(index, event)}
              onMouseMove={(event) => mouseHandler(index, event)}
              onClick={() => selectItem(index)}
            >
              <div className="wk-messageinput-iconbox">
                <img
                  className="wk-messageinput-icon"
                  src={item.icon}
                  alt=""
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '24px',
                  }}
                />
              </div>
              <div>
                <strong>{item.name || item.display}</strong>
                {/* @ 提醒选人弹窗的「@SpaceName」后缀（企微风格） */}
                {item.sourceSpaceName && (
                  <span
                    className="mention-list-item-space"
                    title={`@${item.sourceSpaceName}`}
                  >
                    @{item.sourceSpaceName}
                  </span>
                )}
                {item.isBot && <AiBadge size="small" />}
              </div>
            </div>
          )
        })
      ) : (
        <div className="mention-list-item">{t("base.mentionList.noMembers")}</div>
      )}
    </div>
  )
})
