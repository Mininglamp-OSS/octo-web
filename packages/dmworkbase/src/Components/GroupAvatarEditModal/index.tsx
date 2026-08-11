import React, { useEffect, useState } from "react"
import { Input } from "@douyinfe/semi-ui"
import { IconTick } from "@douyinfe/semi-icons"
import WKModal from "../WKModal"
import { t } from "../../i18n"
import GroupAvatarPreview from "../GroupAvatarPreview"
import {
  GroupColorHex,
  getCachedPalette,
  fetchGroupAvatarPalette,
} from "../GroupAvatarPreview/palette"
import { cleanAvatarText, visibleCount } from "../GroupAvatarPreview/text"
import "./index.css"

export interface GroupAvatarEditResult {
  /** 清洗后的自定义头像文字（≤4 可见字符；空串表示回退双人图标） */
  avatarText: string
  /** 头像文字是否被用户操作过：修改或清除 */
  textChanged?: boolean
  /** 用户显式选中的色板下标；undefined 表示未选色 → 由服务端按 group_no 派生默认色 */
  colorIndex?: number
  /** 色板是否被用户操作过：选择颜色或清除为默认色 */
  colorChanged?: boolean
}

export interface GroupAvatarEditModalProps {
  visible: boolean
  /** 群名：未选色时派生颜色；nameAsFallback 时无自定义文字也按群名取字预览 */
  name?: string
  /** 无自定义文字时是否按群名取字预览（命名群场景传 true，对齐服务端） */
  nameAsFallback?: boolean
  /** 初始自定义文字 */
  initialAvatarText?: string
  /** 初始色板下标 */
  initialColorIndex?: number
  /** 保存中：禁用关闭并让确认按钮展示 loading */
  saving?: boolean
  /** 保存：回传清洗后的文字与色板下标 */
  onSave: (result: GroupAvatarEditResult) => void
  onCancel: () => void
}

export interface GroupAvatarEditFormProps {
  /** 群名：未选色时派生颜色；nameAsFallback 时无自定义文字也按群名取字预览 */
  name?: string
  /** 无自定义文字时是否按群名取字预览（命名群场景传 true，对齐服务端） */
  nameAsFallback?: boolean
  /** 初始自定义文字 */
  initialAvatarText?: string
  /** 初始色板下标 */
  initialColorIndex?: number
  /** 编辑态变化：用于父组件维护本地 draft mode */
  onChange?: (result: GroupAvatarEditResult) => void
}

const MAX_VISIBLE = 4

// GroupAvatarEditModal 是「修改头像」二次弹窗：自定义头像文字 + 头像颜色 + 实时预览。
// 上下文无关（不直接调接口）——保存时把结果回传调用方：创建弹窗据此更新本地态、群设置
// 据此调 PUT。
export const GroupAvatarEditForm: React.FC<GroupAvatarEditFormProps> = ({
  name = "",
  nameAsFallback = false,
  initialAvatarText = "",
  initialColorIndex,
  onChange,
}) => {
  const [palette, setPalette] = useState<GroupColorHex[]>(getCachedPalette())
  const [avatarText, setAvatarText] = useState<string>(initialAvatarText)
  const [textChanged, setTextChanged] = useState(false)
  // undefined = 用户未显式选色：预览按群名派生、不下发 avatar_color（服务端按 group_no
  // 派生默认色）。只有点击色圈才落定一个下标，避免「打开弹窗即静默锁死某个颜色」。
  const [colorIndex, setColorIndex] = useState<number | undefined>(initialColorIndex)
  const [colorChanged, setColorChanged] = useState(false)

  useEffect(() => {
    let active = true
    fetchGroupAvatarPalette().then((p) => {
      if (active) setPalette(p)
    })
    return () => {
      active = false
    }
  }, [])

  // 初始值变化时重置（避免上次编辑残留）。
  useEffect(() => {
    setAvatarText(initialAvatarText)
    setTextChanged(false)
    setColorIndex(initialColorIndex)
    setColorChanged(false)
  }, [initialAvatarText, initialColorIndex])

  const emitChange = (next: {
    avatarText?: string
    textChanged?: boolean
    colorIndex?: number
    colorChanged?: boolean
  }) => {
    onChange?.({
      avatarText: cleanAvatarText(next.avatarText ?? avatarText),
      textChanged: next.textChanged ?? textChanged,
      colorIndex: next.colorIndex,
      colorChanged: next.colorChanged ?? colorChanged,
    })
  }

  const onTextChange = (v: string) => {
    // 限制可见字符 ≤4（与服务端一致），超出即截断。
    const nextText = visibleCount(v) > MAX_VISIBLE ? cleanAvatarText(v) : v
    setAvatarText(nextText)
    setTextChanged(true)
    emitChange({ avatarText: nextText, textChanged: true, colorIndex, colorChanged })
  }

  const selectColor = (index: number) => {
    setColorIndex(index)
    setColorChanged(true)
    emitChange({ colorIndex: index, colorChanged: true })
  }

  const clearColor = () => {
    setColorIndex(undefined)
    setColorChanged(true)
    emitChange({ colorIndex: undefined, colorChanged: true })
  }

  return (
    <>
      <div className="wk-group-avatar-edit-preview-row">
        <GroupAvatarPreview
          avatarText={avatarText}
          colorIndex={colorIndex}
          name={name}
          nameAsFallback={nameAsFallback}
          size={56}
        />
      </div>

      <div className="wk-group-avatar-edit-label">
        {t("base.groupAvatarEdit.customText")}
      </div>
      <Input
        value={avatarText}
        placeholder={t("base.groupAvatarEdit.customTextPlaceholder")}
        onChange={onTextChange}
      />

      <div className="wk-group-avatar-edit-label">
        {t("base.groupAvatarEdit.color")}
      </div>
      <div className="wk-group-avatar-edit-colors">
        <button
          type="button"
          className={
            "wk-group-avatar-edit-color wk-group-avatar-edit-color-default" +
            (colorIndex == null ? " selected" : "")
          }
          onClick={clearColor}
          aria-label="avatar-color-default"
          title={t("base.groupAvatarEdit.defaultColor")}
        >
          {colorIndex == null && <IconTick />}
        </button>
        {palette.map((c) => (
          <button
            type="button"
            key={c.index}
            className={
              "wk-group-avatar-edit-color" +
              (c.index === colorIndex ? " selected" : "")
            }
            style={{
              background: c.fill,
              borderColor: c.index === colorIndex ? c.main : "transparent",
            }}
            onClick={() => selectColor(c.index)}
            aria-label={`avatar-color-${c.index}`}
          >
            {c.index === colorIndex && <IconTick style={{ color: c.main }} />}
          </button>
        ))}
      </div>
    </>
  )
}

const GroupAvatarEditModal: React.FC<GroupAvatarEditModalProps> = ({
  visible,
  name = "",
  nameAsFallback = false,
  initialAvatarText = "",
  initialColorIndex,
  saving = false,
  onSave,
  onCancel,
}) => {
  const [draft, setDraft] = useState<GroupAvatarEditResult>({
    avatarText: initialAvatarText,
    colorIndex: initialColorIndex,
  })

  useEffect(() => {
    if (visible) {
      setDraft({ avatarText: initialAvatarText, colorIndex: initialColorIndex })
    }
  }, [visible, initialAvatarText, initialColorIndex])

  const handleSave = () => {
    if (saving) return

    onSave(draft)
  }

  return (
    <WKModal
      size="md"
      className="wk-group-avatar-edit-modal"
      visible={visible}
      title={t("base.groupAvatarEdit.title")}
      onCancel={onCancel}
      footerConfig={{
        onOk: handleSave,
        isOkLoading: saving,
        okText: t("base.common.ok"),
        cancelText: t("base.common.cancel"),
      }}
      options={{
        maskClosable: !saving,
        closeOnEsc: !saving,
      }}
    >
      <GroupAvatarEditForm
        name={name}
        nameAsFallback={nameAsFallback}
        initialAvatarText={initialAvatarText}
        initialColorIndex={initialColorIndex}
        onChange={setDraft}
      />
    </WKModal>
  )
}

export default GroupAvatarEditModal
export { GroupAvatarEditModal }
