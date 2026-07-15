import React, { Component } from "react";
import { Button, Spin } from "@douyinfe/semi-ui";
import { Toast } from "@douyinfe/semi-ui";
import { Channel, WKSDK } from "wukongimjssdk";
import WKApp from "../../App";
import { ChannelTypeCommunityTopic } from "../../Service/Const";
import { parseThreadChannelId } from "../../Service/Thread";
import { I18nContext } from "../../i18n";
import { wkConfirm } from "../WKModal";
import MarkdownContent from "../../Messages/Text/MarkdownContent";
import VoiceInputButton, { ReplaceMode, SelectionRange } from "../VoiceInputButton";
import { withMdFlags } from "./mdFlagCache";
import "./index.css";

export interface GroupMdEditorProps {
  channel: Channel;
  canEdit: boolean;
}

interface GroupMdEditorState {
  loading: boolean;
  content: string;
  originalContent: string;
  mode: "edit" | "preview";
  saving: boolean;
  version: number;
}

const MAX_BYTES = 10240;

function getByteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

export function normalizeGroupMdContent(content: string): string {
  if (
    !content ||
    content.includes("\n") ||
    (!content.includes("\\n") && !content.includes("\\r\\n"))
  ) {
    return content;
  }
  return content.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n");
}

export class GroupMdEditor extends Component<
  GroupMdEditorProps,
  GroupMdEditorState
> {
  static contextType = I18nContext;
  declare context: React.ContextType<typeof I18nContext>;

  private textareaRef = React.createRef<HTMLTextAreaElement>();

  private handleVoiceTranscribed = (
    text: string,
    mode: ReplaceMode,
    savedRange?: SelectionRange
  ) => {
    if (mode === "all") {
      this.setState({ content: text });
    } else if (mode === "selection" && savedRange) {
      this.setState((prev) => ({
        content:
          prev.content.slice(0, savedRange.from) +
          text +
          prev.content.slice(savedRange.to),
      }));
    } else {
      this.setState((prev) => {
        const pos = savedRange?.from ?? prev.content.length;
        return { content: prev.content.slice(0, pos) + text + prev.content.slice(pos) };
      });
    }
  };

  constructor(props: GroupMdEditorProps) {
    super(props);
    this.state = {
      loading: true,
      content: "",
      originalContent: "",
      mode: props.canEdit ? "edit" : "preview",
      saving: false,
      version: 0,
    };
  }

  componentDidMount() {
    this.loadContent();
  }

  private isThreadMd(): boolean {
    return this.props.channel.channelType === ChannelTypeCommunityTopic;
  }

  private getThreadInfo(): { groupNo: string; shortId: string } | null {
    return parseThreadChannelId(this.props.channel.channelID);
  }

  // 保存/删除 md 后，channelInfo 缓存里的 has_group_md / has_thread_md 标志位（及版本号）
  // 已过期，设置面板副标题「已配置 v{n} / 未配置」不会刷新。
  //
  // 这里【不走】deleteChannelInfo + fetchChannelInfo：SDK 的 fetchChannelInfo 按 channelKey
  // 用 requestQueueMap 去重，而 deleteChannelInfo 只清 channelInfocacheMap；若保存瞬间恰有
  // 「携旧标志」的 fetch 在途，delete+fetch 会退化成 no-op 并被旧请求覆盖，复发副标题不刷新。
  // 与 syncThreadArchiveState(#345) / syncGroupDisbandState(#447) 同款收口：把权威值原地
  // 写回缓存并 notifyListeners，绕过该去重竞态。
  //
  // configured / version 由调用方用后端返回的权威 version 派生（version > 0 即已配置），
  // 而非前端假设——与副标题「已配置 v{version}」及编辑器 version>0 显示版本标签的判断一致。
  // 仅写副标题依赖的标志位与版本号，不动 *_md_updated_at（当前无处显示）。
  private applyMdFlagToCache = (configured: boolean, version: number) => {
    const { channel } = this.props;
    try {
      const channelManager = WKSDK.shared().channelManager;
      const channelInfo = channelManager.getChannelInfo(channel);
      // 缓存未命中（罕见：设置面板通常已 fetch 过）：无本地权威可原地写回，
      // 退回 SDK 拉取兜底，仍以后端为准。
      if (!channelInfo) {
        void channelManager.fetchChannelInfo(channel);
        return;
      }
      channelInfo.orgData = withMdFlags(
        (channelInfo.orgData as Record<string, unknown>) || {},
        this.isThreadMd(),
        configured,
        version
      );
      channelManager.setChannleInfoForCache(channelInfo);
      channelManager.notifyListeners(channelInfo);
    } catch {
      // 缓存写回失败不影响本次保存/删除结果：面板下次进入会重新拉取。
    }
  };

  loadContent = async () => {
    try {
      let resp;
      if (this.isThreadMd()) {
        const parsed = this.getThreadInfo();
        if (!parsed) {
          this.setState({ loading: false });
          return;
        }
        resp = await WKApp.dataSource.channelDataSource.getThreadMd(
          parsed.groupNo,
          parsed.shortId
        );
      } else {
        resp = await WKApp.dataSource.channelDataSource.getGroupMd(
          this.props.channel
        );
      }
      const content = normalizeGroupMdContent(resp?.content || "");
      this.setState({
        content,
        originalContent: content,
        version: resp?.version || 0,
        loading: false,
      });
    } catch {
      this.setState({ loading: false });
    }
  };

  handleSave = async () => {
    const { content } = this.state;

    const byteLen = getByteLength(content);
    if (byteLen > MAX_BYTES) {
      Toast.error(this.context.t("base.groupMd.contentOverLimit"));
      return;
    }

    this.setState({ saving: true });
    try {
      let resp;
      if (this.isThreadMd()) {
        const parsed = this.getThreadInfo();
        if (!parsed) {
          this.setState({ saving: false });
          return;
        }
        resp = await WKApp.dataSource.channelDataSource.updateThreadMd(
          parsed.groupNo,
          parsed.shortId,
          content
        );
      } else {
        resp = await WKApp.dataSource.channelDataSource.updateGroupMd(
          this.props.channel,
          content
        );
      }
      this.setState({
        originalContent: content,
        version: resp.version,
        saving: false,
      });
      Toast.success(this.context.t("base.groupMd.saved"));
      // 保存成功：用后端返回的权威 version 派生已配置状态（version>0 即已配置）。
      this.applyMdFlagToCache(resp.version > 0, resp.version);
    } catch (err: any) {
      Toast.error(err?.msg || this.context.t("base.groupMd.saveFailed"));
      this.setState({ saving: false });
    }
  };

  handleDelete = () => {
    wkConfirm({
      title: this.context.t("base.groupMd.deleteTitle"),
      content: this.context.t("base.groupMd.deleteContent"),
      onOk: async () => {
        try {
          if (this.isThreadMd()) {
            const parsed = this.getThreadInfo();
            if (!parsed) {
              Toast.error(this.context.t("base.groupMd.parseThreadFailed"));
              return;
            }
            await WKApp.dataSource.channelDataSource.deleteThreadMd(
              parsed.groupNo,
              parsed.shortId
            );
          } else {
            await WKApp.dataSource.channelDataSource.deleteGroupMd(
              this.props.channel
            );
          }
          this.setState({
            content: "",
            originalContent: "",
            version: 0,
          });
          Toast.success(this.context.t("base.groupMd.deleted"));
          // 删除成功：确定已无 md，标志位置未配置、版本归零。
          this.applyMdFlagToCache(false, 0);
        } catch (err: any) {
          Toast.error(err?.msg || this.context.t("base.groupMd.deleteFailed"));
        }
      },
    });
  };

  render() {
    const { canEdit } = this.props;
    const { loading, content, originalContent, mode, saving, version } =
      this.state;
    const byteLen = getByteLength(content);
    const overLimit = byteLen > MAX_BYTES;
    const { t } = this.context;

    if (loading) {
      return (
        <div className="wk-groupmd-editor">
          <div className="wk-groupmd-loading">
            <Spin size="large" />
          </div>
        </div>
      );
    }

    return (
      <div className="wk-groupmd-editor">
        {canEdit && (
          <div className="wk-groupmd-toolbar">
            <div className="wk-groupmd-tabs">
              <Button
                type={mode === "edit" ? "primary" : "tertiary"}
                size="small"
                onClick={() => this.setState({ mode: "edit" })}
              >
                {t("base.groupMd.edit")}
              </Button>
              <Button
                type={mode === "preview" ? "primary" : "tertiary"}
                size="small"
                onClick={() => this.setState({ mode: "preview" })}
              >
                {t("base.groupMd.preview")}
              </Button>
            </div>
            <div className="wk-groupmd-actions">
              {originalContent && (
                <Button
                  type="danger"
                  size="small"
                  onClick={this.handleDelete}
                >
                  {t("base.groupMd.delete")}
                </Button>
              )}
              <Button
                type="primary"
                size="small"
                loading={saving}
                disabled={content === originalContent || overLimit}
                onClick={this.handleSave}
              >
                {t("base.groupMd.save")}
              </Button>
            </div>
          </div>
        )}

        {canEdit && (
          <div
            className={`wk-groupmd-bytecount ${overLimit ? "wk-groupmd-bytecount-over" : ""}`}
          >
            {byteLen} / {MAX_BYTES} bytes
            {version > 0 && <span className="wk-groupmd-version">v{version}</span>}
          </div>
        )}

        {mode === "edit" && canEdit ? (
          <div className="wk-groupmd-edit-area">
            <div style={{ position: "relative" }}>
              <textarea
                ref={this.textareaRef}
                className="wk-groupmd-textarea"
                value={content}
                onChange={(e) => this.setState({ content: e.target.value })}
                placeholder={t("base.groupMd.placeholder")}
                rows={15}
                style={{ fontFamily: "monospace" }}
              />
              <VoiceInputButton
                inputRef={this.textareaRef}
                onTranscribed={this.handleVoiceTranscribed}
                getCurrentText={() => this.state.content}
                showModeMenu
                size="md"
                className="wk-vib--textarea-corner"
              />
            </div>
          </div>
        ) : (
          <div className="wk-groupmd-preview">
            {content ? (
              <div className="wk-groupmd-preview-content">
                <MarkdownContent content={content} enableMath />
              </div>
            ) : (
              <div className="wk-groupmd-empty">{t("base.groupMd.empty")}</div>
            )}
          </div>
        )}
      </div>
    );
  }
}
