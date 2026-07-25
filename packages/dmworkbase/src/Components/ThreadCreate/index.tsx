import React, { Component } from "react"
import { Toast } from "@douyinfe/semi-ui"
import { X } from "lucide-react"
import ThreadIcon from "../Icons/ThreadIcon"
import { I18nContext, t } from "../../i18n"
import { THREAD_NAME_MAX_LENGTH } from "../../Service/nameLimits"
import { createThreadByNameAndNotify } from "../../bridge/thread/createThread"
import { ThreadCreateForm, ThreadCreateLabels } from "../../ui/ThreadCreateDialog"
import "./index.css"

export interface ThreadCreateProps {
  groupNo: string
  sourceMessageId?: number
  onSuccess?: () => void
  onCancel?: () => void
}

interface ThreadCreateState {
  loading: boolean
  error: string | null
}

export class ThreadCreate extends Component<ThreadCreateProps, ThreadCreateState> {
  static contextType = I18nContext
  declare context: React.ContextType<typeof I18nContext>

  constructor(props: ThreadCreateProps) {
    super(props)
    this.state = {
      loading: false,
      error: null,
    }
  }

  handleSubmit = async (name: string) => {
    const { groupNo, sourceMessageId, onSuccess } = this.props

    this.setState({ loading: true, error: null })

    try {
      await createThreadByNameAndNotify(groupNo, name, sourceMessageId)
      Toast.success(t("base.threadCreate.success"))
      onSuccess?.()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("base.module.createThread.failed")
      Toast.error(msg)
      this.setState({ loading: false, error: msg })
    }
  }

  handleNameChange = () => {
    if (this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    const { onCancel } = this.props
    const { loading, error } = this.state
    const labels: ThreadCreateLabels = {
      cancel: t("base.common.cancel"),
      create: t("base.module.createThread.ok"),
      creating: t("base.threadCreate.creating"),
      maxLength: t("base.threadCreate.nameMaxLength"),
      nameRequired: t("base.threadCreate.nameRequired"),
    }

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
          <ThreadCreateForm
            placeholder={t("base.threadCreate.namePlaceholder")}
            maxLength={THREAD_NAME_MAX_LENGTH}
            loading={loading}
            error={error}
            labels={labels}
            onSubmit={this.handleSubmit}
            onCancel={onCancel}
            onChange={this.handleNameChange}
          />
        </div>
      </div>
    )
  }
}

export default ThreadCreate
