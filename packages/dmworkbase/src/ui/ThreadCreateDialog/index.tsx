import React, { FormEvent, useEffect, useRef, useState } from "react"
import classNames from "classnames"
import { X } from "lucide-react"
import VoiceInputButton from "../../Components/VoiceInputButton"
import { THREAD_NAME_MAX_LENGTH } from "../../Service/nameLimits"
import "./index.css"

export interface ThreadCreateLabels {
  cancel: string
  create: string
  creating: string
  maxLength: string
  nameRequired: string
}

export interface ThreadCreateFormProps {
  label?: string
  placeholder?: string
  initialValue?: string
  maxLength?: number
  loading?: boolean
  error?: string | null
  labels: ThreadCreateLabels
  showVoiceInput?: boolean
  showCounter?: boolean
  formVariant?: "modal" | "confirm"
  resetKey?: string | number
  onSubmit: (name: string) => void
  onCancel?: () => void
  onChange?: (name: string) => void
}

export interface ThreadCreateDialogProps extends ThreadCreateFormProps {
  visible: boolean
  title: string
}

function getNameError(name: string, maxLength: number, labels: ThreadCreateLabels) {
  const trimmed = name.trim()
  if (!trimmed) return labels.nameRequired
  if (trimmed.length > maxLength) return labels.maxLength
  return null
}

export function ThreadCreateForm({
  label,
  placeholder,
  initialValue = "",
  maxLength = THREAD_NAME_MAX_LENGTH,
  loading = false,
  error,
  labels,
  showVoiceInput = false,
  showCounter = false,
  formVariant = "modal",
  resetKey,
  onSubmit,
  onCancel,
  onChange,
}: ThreadCreateFormProps) {
  const [name, setName] = useState(initialValue)
  const [localError, setLocalError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setName(initialValue)
    setLocalError(null)
  }, [initialValue, resetKey])

  const currentError = localError || error || null
  const trimmedName = name.trim()
  const exceedsMaxLength = trimmedName.length > maxLength
  const canSubmit = trimmedName.length > 0 && !exceedsMaxLength && !loading

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextError = getNameError(name, maxLength, labels)
    if (nextError) {
      setLocalError(nextError)
      return
    }
    onSubmit(trimmedName)
  }

  const updateName = (nextName: string) => {
    setName(nextName)
    setLocalError(null)
    onChange?.(nextName)
  }

  return (
    <form
      className={classNames("wk-thread-create-form", {
        "wk-thread-create-form--confirm": formVariant === "confirm",
      })}
      onSubmit={handleSubmit}
    >
      {label && <label className="wk-thread-create-form__label">{label}</label>}
      <div className="wk-thread-create-form__input-row">
        <input
          ref={inputRef}
          className={classNames("wk-thread-create-form__input", {
            "wk-thread-create-form__input--error": currentError || exceedsMaxLength,
          })}
          type="text"
          value={name}
          placeholder={placeholder}
          maxLength={maxLength}
          autoFocus
          disabled={loading}
          onChange={(event) => {
            updateName(event.target.value)
          }}
        />
        {showVoiceInput && (
          <VoiceInputButton
            inputRef={inputRef}
            onTranscribed={(text, mode, savedRange) => {
              let nextName = text
              if (mode === "selection" && savedRange) {
                nextName = name.slice(0, savedRange.from) + text + name.slice(savedRange.to)
              } else if (mode !== "all") {
                const pos = savedRange?.from ?? name.length
                nextName = name.slice(0, pos) + text + name.slice(pos)
              }
              updateName(nextName)
            }}
            size="sm"
          />
        )}
      </div>
      {(currentError || showCounter) && (
        <div className="wk-thread-create-form__meta">
          <span className="wk-thread-create-form__error">{currentError}</span>
          {showCounter && (
            <span
              className={classNames("wk-thread-create-form__counter", {
                "wk-thread-create-form__counter--error": exceedsMaxLength,
              })}
            >
              {name.length} / {maxLength}
            </span>
          )}
        </div>
      )}
      <div className="wk-thread-create-form__footer">
        {onCancel && (
          <button
            className="wk-thread-create-form__button wk-thread-create-form__button--cancel"
            disabled={loading}
            onClick={onCancel}
            type="button"
          >
            {labels.cancel}
          </button>
        )}
        <button
          className="wk-thread-create-form__button wk-thread-create-form__button--submit"
          disabled={!canSubmit}
          type="submit"
        >
          {loading ? labels.creating : labels.create}
        </button>
      </div>
    </form>
  )
}

export default function ThreadCreateDialog({
  visible,
  title,
  onCancel,
  ...formProps
}: ThreadCreateDialogProps) {
  const [openSession, setOpenSession] = useState(0)

  useEffect(() => {
    if (visible) {
      setOpenSession((current) => current + 1)
    }
  }, [visible])

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      onCancel?.()
    }
  }

  if (!visible) return null

  return (
    <div className="wk-thread-modal" onKeyDown={handleKeyDown}>
      <div className="wk-thread-modal-overlay" onClick={onCancel} />
      <div className="wk-thread-modal-content">
        <div className="wk-thread-modal-header">
          <div className="wk-thread-modal-title">{title}</div>
          <div className="wk-thread-modal-close" onClick={onCancel}>
            <X size={18} />
          </div>
        </div>
        <div className="wk-thread-modal-body">
          <ThreadCreateForm {...formProps} resetKey={openSession} onCancel={onCancel} />
        </div>
      </div>
    </div>
  )
}
