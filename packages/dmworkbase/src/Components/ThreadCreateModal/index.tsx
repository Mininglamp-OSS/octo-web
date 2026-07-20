import React, { Component } from "react"
import { I18nContext, t } from "../../i18n"
import { createThreadByNameAndNotify } from "../../bridge/thread/createThread"
import ThreadCreateDialog, { ThreadCreateLabels } from "../../ui/ThreadCreateDialog"

const THREAD_CREATE_MODAL_NAME_MAX_LENGTH = 50

export interface ThreadCreateModalProps {
  visible: boolean
  groupNo: string
  sourceMessageId?: number
  onClose: () => void
  onSuccess?: (threadId: string) => void
}

interface ThreadCreateModalState {
  loading: boolean
  error: string | null
}

export default class ThreadCreateModal extends Component<
  ThreadCreateModalProps,
  ThreadCreateModalState
> {
  static contextType = I18nContext
  declare context: React.ContextType<typeof I18nContext>

  constructor(props: ThreadCreateModalProps) {
    super(props)
    this.state = {
      loading: false,
      error: null,
    }
  }

  componentDidUpdate(prevProps: ThreadCreateModalProps) {
    // 打开时重置状态
    if (this.props.visible && !prevProps.visible) {
      this.setState({
        loading: false,
        error: null,
      })
    }
  }

  private handleSubmit = async (name: string) => {
    const { groupNo, sourceMessageId, onClose, onSuccess } = this.props

    this.setState({ loading: true, error: null })

    try {
      const result = await createThreadByNameAndNotify(groupNo, name, sourceMessageId)
      this.setState({ loading: false })
      if (result.short_id) {
        onSuccess?.(result.short_id)
      }
      onClose()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("base.module.createThread.failed")
      this.setState({ loading: false, error: msg })
    }
  }

  private handleNameChange = () => {
    if (this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    const { visible, onClose } = this.props
    const { loading, error } = this.state
    const labels: ThreadCreateLabels = {
      cancel: t("base.common.cancel"),
      create: t("base.module.createThread.ok"),
      creating: t("base.threadCreate.creating"),
      maxLength: t("base.threadCreateModal.topicMaxLength"),
      nameRequired: t("base.threadCreateModal.topicRequired"),
    }

    return (
      <ThreadCreateDialog
        visible={visible}
        title={t("base.module.createThread.title")}
        placeholder={t("base.threadCreateModal.topicPlaceholder")}
        maxLength={THREAD_CREATE_MODAL_NAME_MAX_LENGTH}
        loading={loading}
        error={error}
        labels={labels}
        showVoiceInput
        onSubmit={this.handleSubmit}
        onCancel={onClose}
        onChange={this.handleNameChange}
      />
    )
  }
}
