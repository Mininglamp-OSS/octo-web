import React from "react";
import { useI18n, WKApp } from "@octo/base";
import useMailRules from "../bridge/useMailRules";
import type { AgentMailbox, MailRule } from "../bridge/types";
import MailRuleManagementView from "../ui/MailRuleManagementView";

export default function MailRuleManagementFeature({
  mailbox,
}: {
  mailbox: AgentMailbox;
}) {
  const { t } = useI18n();
  const rules = useMailRules(mailbox.id, t("mail.error.fallback"));

  const remove = (rule: MailRule) => {
    if (
      !window.confirm(
        t("mail.rules.deleteConfirm", { values: { name: rule.name } })
      )
    )
      return;
    void rules.remove(rule);
  };

  return (
    <MailRuleManagementView
      mailbox={mailbox}
      {...rules}
      t={t}
      onBack={() => WKApp.routeRight.pop()}
      onRefresh={rules.reload}
      onSave={rules.save}
      onSetEnabled={(rule, enabled) => void rules.setEnabled(rule, enabled)}
      onDelete={remove}
    />
  );
}
