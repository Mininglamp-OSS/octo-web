import React, { useState } from "react";
import { TextArea, Toast } from "@douyinfe/semi-ui";
import { t } from "../../i18n";
import { wkConfirm } from "../../Components/WKModal/confirm";

/**
 * 文档访问申请「拒绝」二次确认弹窗。
 *
 * 「拒绝」不是直接提交：审批人需在弹窗里填写**必填**的拒绝原因，原因随
 * `inputs[deny_reason]`（服务端在卡片里声明的隐藏 Input.Text id，见 cardtmpl
 * DocsDenyReasonInputID）一并上行，最终经 DecisionRequest.Inputs 透传给 docs 后端。
 * 这里只做本地采集与校验，不改动既有 no-data 提交契约。
 */

export const DOCS_APPROVAL_OWNER = "docs";
export const DOCS_APPROVAL_ACTION_TYPE = "access_request.decision";
/** 与服务端 cardtmpl.DocsDenyReasonInputID 对齐——拒绝原因的声明输入 id。 */
export const DOCS_DENY_REASON_INPUT_ID = "deny_reason";

const MAX_REASON = 200;

/** 判断一个 Action.Submit 的 data 是否为文档访问申请的「拒绝」动作（类型守卫：命中后
 * data 收窄为非空，调用方无需再 `?.`）。 */
export function isDocsDenyAction(
  data: Record<string, unknown> | undefined
): data is Record<string, unknown> {
  return (
    !!data &&
    data.owner === DOCS_APPROVAL_OWNER &&
    data.action_type === DOCS_APPROVAL_ACTION_TYPE &&
    data.decision === "deny"
  );
}

export interface DocsDenyDialogContext {
  docTitle?: string;
  actorName?: string;
  requestNo?: string;
}

function DenyReasonBody(props: {
  ctx: DocsDenyDialogContext;
  onChange: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  const desc =
    props.ctx.actorName && props.ctx.docTitle
      ? t("base.message.interactiveCard.denyDialog.descWithContext", {
          values: { actor: props.ctx.actorName, title: props.ctx.docTitle },
        })
      : t("base.message.interactiveCard.denyDialog.desc");
  return (
    <div className="wk-docs-deny-dialog">
      {props.ctx.requestNo ? (
        <div className="wk-docs-deny-dialog-no">
          {t("base.message.interactiveCard.denyDialog.requestNo", {
            values: { no: props.ctx.requestNo },
          })}
        </div>
      ) : null}
      <p className="wk-docs-deny-dialog-desc">{desc}</p>
      <div className="wk-docs-deny-dialog-label">
        {t("base.message.interactiveCard.denyDialog.reasonLabel")}
        <span className="wk-docs-deny-dialog-required">
          {t("base.message.interactiveCard.denyDialog.required")}
        </span>
      </div>
      <TextArea
        autosize={{ minRows: 3, maxRows: 6 }}
        maxLength={MAX_REASON}
        placeholder={t("base.message.interactiveCard.denyDialog.placeholder")}
        value={value}
        onChange={(next) => {
          setValue(next);
          props.onChange(next);
        }}
      />
      <div className="wk-docs-deny-dialog-counter">
        {t("base.message.interactiveCard.denyDialog.counter", {
          values: { max: MAX_REASON },
        })}
      </div>
    </div>
  );
}

/**
 * 打开拒绝原因弹窗。resolve 拒绝原因（已 trim、非空）表示确认拒绝；resolve null
 * 表示取消（不提交）。原因为空时保持弹窗打开并轻提示，不 resolve。
 */
export function openDocsDenyReasonDialog(
  ctx: DocsDenyDialogContext
): Promise<string | null> {
  return new Promise((resolve) => {
    const box = { reason: "" };
    let settled = false;
    const done = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    wkConfirm({
      title: t("base.message.interactiveCard.denyDialog.title"),
      okText: t("base.message.interactiveCard.denyDialog.confirm"),
      cancelText: t("base.message.interactiveCard.denyDialog.cancel"),
      okType: "danger",
      maskClosable: false,
      content: <DenyReasonBody ctx={ctx} onChange={(value) => (box.reason = value)} />,
      onOk: () => {
        const reason = box.reason.trim();
        if (!reason) {
          Toast.warning(t("base.message.interactiveCard.denyDialog.reasonRequired"));
          // 拒绝一个 promise 让 wkConfirm 保持弹窗打开（见 WKModal/confirm.tsx）。
          return Promise.reject(new Error("deny reason required"));
        }
        done(reason);
        return undefined;
      },
      onCancel: () => done(null),
    });
  });
}
