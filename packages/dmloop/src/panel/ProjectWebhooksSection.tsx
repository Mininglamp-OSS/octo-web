import React, { useEffect, useState } from "react";
import { Button, Input, Switch, Spin, Toast, Modal, Typography } from "@douyinfe/semi-ui";
import LoopButton from "../ui/LoopButton";
import { Plus, Trash2, Copy } from "lucide-react";
import { useI18n } from "@octo/base";
import type { WebhookSubscription } from "../api/types";
import { listWebhooks, createWebhook, updateWebhook, deleteWebhook } from "../api/webhookApi";
import { confirmDelete } from "../ui/confirmDelete";

const { Text } = Typography;

/** 项目 Webhook 配置分区：列表 + 启用开关 + 删除 + 新增（创建后一次性展示 secret）。 */
export default function ProjectWebhooksSection({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<WebhookSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    listWebhooks(projectId).then(setRows).finally(() => setLoading(false));
  };
  useEffect(reload, [projectId]);

  const add = async () => {
    const value = url.trim();
    if (!value) { Toast.warning(t("loop.webhook.urlRequired")); return; }
    setBusy(true);
    try {
      const created = await createWebhook({ url: value, project_id: projectId });
      setUrl("");
      Toast.success(t("loop.webhook.created"));
      if (created.secret) setSecret(created.secret);
      reload();
    } catch (e) {
      Toast.error((e as Error)?.message ?? t("loop.webhook.createFailed"));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (row: WebhookSubscription, enabled: boolean) => {
    try {
      await updateWebhook(row.id, { enabled });
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, enabled } : r)));
    } catch (e) {
      Toast.error((e as Error)?.message ?? t("loop.webhook.updateFailed"));
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteWebhook(id);
      Toast.success(t("loop.webhook.deleted"));
      reload();
    } catch (e) {
      Toast.error((e as Error)?.message ?? t("loop.webhook.deleteFailed"));
    }
  };

  const copySecret = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      Toast.success(t("loop.webhook.copied"));
    } catch {
      Toast.error(t("loop.webhook.copyFailed"));
    }
  };

  return (
    <div className="loop-wh">
      <div className="loop-wh__hint">{t("loop.webhook.hint")}</div>

      {loading ? (
        <div style={{ padding: "8px 0" }}><Spin size="small" /></div>
      ) : rows.length === 0 ? (
        <div className="loop-wh__empty">{t("loop.webhook.empty")}</div>
      ) : (
        rows.map((row) => (
          <div key={row.id} className="loop-wh__row">
            <span className="loop-wh__url" title={row.url}>{row.url}</span>
            <Switch
              size="small"
              checked={row.enabled}
              onChange={(v) => toggle(row, v)}
              aria-label={t("loop.webhook.enabled")}
            />
            <Button
              theme="borderless"
              type="danger"
              size="small"
              icon={<Trash2 size={14} />}
              aria-label={t("loop.webhook.delete")}
              onClick={() =>
                confirmDelete({
                  title: t("loop.webhook.deleteConfirm"),
                  content: t("loop.webhook.deleteConfirmDesc"),
                  okText: t("loop.action.delete"),
                  cancelText: t("loop.action.cancel"),
                  onOk: () => remove(row.id),
                })
              }
            />
          </div>
        ))
      )}

      <div className="loop-wh__add">
        <Input
          value={url}
          onChange={setUrl}
          placeholder={t("loop.webhook.urlPlaceholder")}
          onEnterPress={add}
        />
        <LoopButton icon={<Plus size={14} />} loading={busy} onClick={add}>
          {t("loop.webhook.add")}
        </LoopButton>
      </div>

      <Modal
        className="loop-modal"
        visible={!!secret}
        title={t("loop.webhook.secretTitle")}
        onCancel={() => setSecret(null)}
        onOk={() => setSecret(null)}
        okText={t("loop.webhook.done")}
        hasCancel={false}
      >
        <Text type="tertiary" style={{ fontSize: 13, lineHeight: 1.6 }}>
          {t("loop.webhook.secretDesc")}
        </Text>
        <div className="loop-wh__secret">
          <code>{secret}</code>
          <Button icon={<Copy size={14} />} onClick={copySecret}>{t("loop.webhook.copy")}</Button>
        </div>
      </Modal>
    </div>
  );
}
