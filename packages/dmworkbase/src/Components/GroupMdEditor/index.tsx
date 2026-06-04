import React, { Component } from "react";
import { Button, TextArea, Spin } from "@douyinfe/semi-ui";
import { Toast } from "@douyinfe/semi-ui";
import { Channel } from "wukongimjssdk";
import WKApp from "../../App";
import { ChannelTypeCommunityTopic } from "../../Service/Const";
import { parseThreadChannelId } from "../../Service/Thread";
import { I18nContext } from "../../i18n";
import { wkConfirm } from "../WKModal";
import MarkdownContent from "../../Messages/Text/MarkdownContent";
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
            <TextArea
              value={content}
              onChange={(value) => this.setState({ content: value })}
              placeholder={t("base.groupMd.placeholder")}
              autosize={{ minRows: 15 }}
              style={{ fontFamily: "monospace" }}
            />
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
