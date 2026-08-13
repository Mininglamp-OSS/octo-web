import React from "react";
import { MailOpen } from "lucide-react";
import { useI18n } from "@octo/base";
import "../ui/MailContent/index.css";

export default function MailReaderEmpty() {
  const { t } = useI18n();
  return (
    <div className="octo-mail-content">
      <div className="octo-mail-content-state">
        <span className="octo-mail-content-state__mark">
          <MailOpen size={22} />
        </span>
        <strong>{t("mail.empty.readerTitle")}</strong>
        <span>{t("mail.empty.readerDescription")}</span>
      </div>
    </div>
  );
}
