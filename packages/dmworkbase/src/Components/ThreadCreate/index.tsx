import React, { Component } from "react"
import { Toast } from "@douyinfe/semi-ui"
import { X } from "lucide-react"
import ThreadIcon from "../Icons/ThreadIcon"
import WKApp from "../../App"
import { I18nContext, t } from "../../i18n"
import { THREAD_NAME_MAX_LENGTH } from "../../Service/nameLimits"
import "./index.css"

export interface ThreadCreateProps {
  groupNo: string
  sourceMessageId?: number
  onSuccess?: () => void
  onCancel?: () => void
}

interface ThreadCreateState {
  name: string
  loading: boolean
}

export class ThreadCreate extends Component<ThreadCreateProps, ThreadCreateState> {
  static contextType = I18nContext
  declare context: React.ContextType<typeof I18nContext>

  constructor(props: ThreadCreateProps) {
    super(props)
    this.state = {
      name: "",
      loading: false,
    }
  }

  handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({ name: e.target.value })
  }

  handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !this.state.loading && this.state.name.trim()) {
      this.handleSubmit()
    }
  }

  handleSubmit = async () => {
    const { groupNo, sourceMessageId, onSuccess } = this.props
    const { name } = this.state

    if (!name.trim()) {
      Toast.warning(t("base.threadCreate.nameRequired"))
      return
    }

    if (name.length > THREAD_NAME_MAX_LENGTH) {
      Toast.warning(t("base.threadCreate.nameMaxLength"))
      return
    }

    this.setState({ loading: true })

    try {
      await WKApp.dataSource.channelDataSource.threadCreate(
        groupNo,
        name.trim(),
        sourceMessageId
      )
      Toast.success(t("base.threadCreate.success"))
      onSuccess?.()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("base.module.createThread.failed")
      Toast.error(msg)
      this.setState({ loading: false })
    }
  }

  render() {
    const { onCancel } = this.props
    const { name, loading } = this.state

    return (
      <div className="wk-thread-create">
        <div className="wk-thread-create-header">
          <ThreadIcon className="wk-thread-create-icon" size={24} />
          <span className="wk-thread-create-title">{t("base.module.createThread.title")}</span>
          {onCancel && (
            <div className="wk-thread-create-close" onClick={onCancel}>
              <X size={18} />
            </div>
          )}
        </div>
        <div className="wk-thread-create-body">
          <input
            className="wk-thread-create-input"
            type="text"
            placeholder={t("base.threadCreate.namePlaceholder")}
            value={name}
            onChange={this.handleNameChange}
            onKeyDown={this.handleKeyDown}
            maxLength={THREAD_NAME_MAX_LENGTH}
            autoFocus
          />
        </div>
        <div className="wk-thread-create-footer">
          {onCancel && (
            <button
              className="wk-thread-create-btn wk-thread-create-btn-cancel"
              onClick={onCancel}
              disabled={loading}
            >
              {t("base.common.cancel")}
            </button>
          )}
          <button
            className="wk-thread-create-btn wk-thread-create-btn-submit"
            onClick={this.handleSubmit}
            disabled={loading || !name.trim()}
          >
            {loading ? t("base.threadCreate.creating") : t("base.module.createThread.ok")}
          </button>
        </div>
      </div>
    )
  }
}

export default ThreadCreate
