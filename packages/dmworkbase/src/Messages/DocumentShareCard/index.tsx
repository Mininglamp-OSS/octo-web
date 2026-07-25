import React from "react";
import MessageBase from "../Base";
import { MessageBaseCellProps, MessageCell } from "../MessageCell";
import { I18nContext } from "../../i18n";
import {
  DocumentShareCard,
  type DocSharePermissionState,
  type DocSharePlaceholder,
  type DocSharePreview,
  type DocSharePreviewStatus,
  type DocumentShareCardStrings,
} from "../../ui/DocumentShareCard";
import { DocumentShareCardContent } from "./DocumentShareCardContent";
import { buildDocNavUrl, permissionState } from "./docIdentity";
import { fetchDocPreview } from "./preview";

interface DocShareCardCellState {
  status: DocSharePreviewStatus;
  preview?: DocSharePreview;
}

/**
 * 文档转发卡片渲染 Cell（contentType=18）。挂载时按接收者本人权限即时拉 ACL-safe 首屏预览，
 * 无信任门（自定义内容类型，非 type-17 互动卡）。焦点/可见性重查让"别处授权后切回本页"自动更新。
 */
export class DocumentShareCardCell extends MessageCell<MessageBaseCellProps> {
  static contextType = I18nContext;
  declare context: React.ContextType<typeof I18nContext>;

  state: DocShareCardCellState = { status: "loading" };
  private aborter?: AbortController;

  componentDidMount(): void {
    super.componentDidMount();
    this.aborter = new AbortController();
    void this.loadPreview(false);
    window.addEventListener("focus", this.handleRecheck);
    document.addEventListener("visibilitychange", this.handleVisibility);
  }

  componentWillUnmount(): void {
    this.aborter?.abort();
    window.removeEventListener("focus", this.handleRecheck);
    document.removeEventListener("visibilitychange", this.handleVisibility);
    super.componentWillUnmount();
  }

  private handleVisibility = (): void => {
    if (document.visibilityState === "visible") this.handleRecheck();
  };

  private handleRecheck = (): void => {
    void this.loadPreview(true);
  };

  /** 拉取并写回预览/权限态。force=true 时强制绕过缓存拿最新 ACL 结果。 */
  private loadPreview(force: boolean): Promise<void> {
    const content = this.props.message.content as DocumentShareCardContent;
    return fetchDocPreview(content.kind, content.docId, content.spaceId, { force }).then((res) => {
      if (this.aborter?.signal.aborted) return;
      this.setState({ status: res.status, preview: res.preview });
    });
  }

  private handleOpen = (): void => {
    const content = this.props.message.content as DocumentShareCardContent;
    // P1-b：不信任 wire url，用已校验的 docId/spaceId 本地重建同源相对路径再导航。
    const url = buildDocNavUrl(content.docId, content.spaceId);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  /** 复制文档链接：用已校验 docId/spaceId 在本源重建绝对链接（不回显 wire url，安全且可分享）。 */
  private handleCopy = (): void => {
    const content = this.props.message.content as DocumentShareCardContent;
    const rel = buildDocNavUrl(content.docId, content.spaceId);
    if (!rel) return;
    void navigator.clipboard?.writeText(`${window.location.origin}${rel}`);
  };

  private buildStrings(content: DocumentShareCardContent, state: DocSharePermissionState): DocumentShareCardStrings {
    const { t } = this.context;
    return {
      subtitle: content.ownerName
        ? t("base.docShareCard.createdBy", { values: { name: content.ownerName } })
        : undefined,
      permissionLabel: t(`base.docShareCard.permission.${state}`),
      copyLabel: t("base.docShareCard.copy"),
      openLabel: t("base.docShareCard.open"),
    };
  }

  /**
   * 决定预览区显内容还是占位：有权限(reader/writer)+取数就绪+有内容 → 显首屏预览；
   * 否则给占位（无权限→申请引导 / 失效 / 检查中 / 空文档），与 octo 原型一致，ACL-safe。
   */
  private buildPreviewOrPlaceholder(
    state: DocSharePermissionState,
  ): { preview?: DocSharePreview; placeholder?: DocSharePlaceholder } {
    const { t } = this.context;
    if ((state === "reader" || state === "writer") && this.state.status === "ready" && this.state.preview) {
      return { preview: this.state.preview };
    }
    if (state === "no_access") {
      return {
        placeholder: {
          icon: "lock",
          title: t("base.docShareCard.placeholder.no_access.title"),
          desc: t("base.docShareCard.placeholder.no_access.desc"),
        },
      };
    }
    if (state === "unavailable") {
      return {
        placeholder: {
          icon: "warning",
          title: t("base.docShareCard.placeholder.unavailable.title"),
          desc: t("base.docShareCard.placeholder.unavailable.desc"),
        },
      };
    }
    if (state === "checking") {
      return { placeholder: { icon: "info", title: t("base.docShareCard.placeholder.checking.title") } };
    }
    return { placeholder: { icon: "info", title: t("base.docShareCard.placeholder.empty.title") } };
  }

  render() {
    const { message, context } = this.props;
    const content = message.content as DocumentShareCardContent;
    const state = permissionState(this.state.status);
    const strings = this.buildStrings(content, state);
    const { preview, placeholder } = this.buildPreviewOrPlaceholder(state);

    return (
      <MessageBase hiddeBubble={true} message={message} context={context}>
        <DocumentShareCard
          kind={content.kind}
          title={content.title}
          state={state}
          strings={strings}
          preview={preview}
          placeholder={placeholder}
          onOpen={this.handleOpen}
          onCopy={this.handleCopy}
        />
      </MessageBase>
    );
  }
}

export default DocumentShareCardCell;
