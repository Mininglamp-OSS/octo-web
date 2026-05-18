import React, { Component } from "react"
import { X } from "lucide-react"
import ThreadIcon from "../Icons/ThreadIcon"
import classNames from "classnames"
import WKApp from "../../App"
import VoiceInputButton from "../VoiceInputButton"
import "./index.css"

export interface ThreadCreateModalProps {
  visible: boolean
  groupNo: string
  sourceMessageId?: number
  onClose: () => void
  onSuccess?: (threadId: string) => void
}

interface ThreadCreateModalState {
  name: string
  loading: boolean
  error: string | null
}

export default class ThreadCreateModal extends Component<
  ThreadCreateModalProps,
  ThreadCreateModalState
> {
  private inputRef = React.createRef<HTMLInputElement>();

  constructor(props: ThreadCreateModalProps) {
    super(props)
    this.state = {
      name: "",
      loading: false,
      error: null,
    }
  }

  componentDidUpdate(prevProps: ThreadCreateModalProps) {
    // 打开时重置状态
    if (this.props.visible && !prevProps.visible) {
      this.setState({
        name: "",
        loading: false,
        error: null,
      })
    }
  }

  private handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({ name: e.target.value, error: null })
  }

  private handleSubmit = async () => {
    const { groupNo, sourceMessageId, onClose, onSuccess } = this.props
    const { name } = this.state

    // 验证
    const trimmedName = name.trim()
    if (!trimmedName) {
      this.setState({ error: "请输入话题名称" })
      return
    }
    if (trimmedName.length > 50) {
      this.setState({ error: "话题名称不能超过50个字符" })
      return
    }

    this.setState({ loading: true, error: null })

    try {
      const result = await WKApp.dataSource.channelDataSource.threadCreate(
        groupNo,
        trimmedName,
        sourceMessageId
      )
      this.setState({ loading: false })
      onSuccess?.(result.short_id)
      onClose()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "创建失败"
      this.setState({ loading: false, error: msg })
    }
  }

  private handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !this.state.loading) {
      this.handleSubmit()
    }
    if (e.key === "Escape") {
      this.props.onClose()
    }
  }

  render() {
    const { visible, onClose } = this.props
    const { name, loading, error } = this.state

    if (!visible) return null

    return (
      <div className="wk-thread-modal" onKeyDown={this.handleKeyDown}>
        <div className="wk-thread-modal-overlay" onClick={onClose} />
        <div className="wk-thread-modal-content">
          <div className="wk-thread-modal-header">
            <ThreadIcon className="wk-thread-modal-icon" size={24} />
            <div className="wk-thread-modal-title">创建子区</div>
            <div className="wk-thread-modal-close" onClick={onClose}>
              <X size={18} />
            </div>
          </div>

          <div className="wk-thread-modal-body">
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input
                ref={this.inputRef}
                className={classNames(
                  "wk-thread-modal-input",
                  error && "wk-thread-modal-input-error"
                )}
                type="text"
                placeholder="输入话题名称"
                value={name}
                onChange={this.handleNameChange}
                maxLength={50}
                autoFocus
                style={{ flex: 1 }}
              />
              <VoiceInputButton
                inputRef={this.inputRef}
                onTranscribed={(text, mode, savedRange) => {
                  let newValue: string;
                  if (mode === "all") {
                    newValue = text;
                  } else if (mode === "selection" && savedRange) {
                    // Note: savedRange indices are from recording start; assumes input is read-only during recording
                    const prev = this.state.name;
                    newValue = prev.slice(0, savedRange.from) + text + prev.slice(savedRange.to);
                  } else {
                    const prev = this.state.name;
                    const pos = savedRange?.from ?? prev.length;
                    newValue = prev.slice(0, pos) + text + prev.slice(pos);
                  }
                  this.setState({ name: newValue.slice(0, 50), error: null });
                }}
                size="sm"
              />
            </div>
            {error && <div className="wk-thread-modal-error">{error}</div>}
          </div>

          <div className="wk-thread-modal-footer">
            <button
              className="wk-thread-modal-btn wk-thread-modal-btn-cancel"
              onClick={onClose}
            >
              取消
            </button>
            <button
              className="wk-thread-modal-btn wk-thread-modal-btn-submit"
              onClick={this.handleSubmit}
              disabled={loading || !name.trim()}
            >
              {loading ? "创建中..." : "创建"}
            </button>
          </div>
        </div>
      </div>
    )
  }
}
