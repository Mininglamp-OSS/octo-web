import React, { useEffect, useState } from "react";
import { Modal } from "@douyinfe/semi-ui";
import { useI18n } from "@octo/base";
import type { FormalController } from "./NativeFormalContentBinding";
import type { SummaryGenerationSpec } from "../../Service/SummaryContentContract";
import type { ChatCandidate } from "../../types/summary";
import FormalContentPanel from "../../ui/SummaryWorkbench/FormalContentPanel";
import ChatSelectorModal from "../../components/ChatSelectorModal";
import "./NativeFormalConfiguration.css";

export default function NativeFormalConfiguration({ controller, sourceNames, onClose, onSaved }: {
  controller: FormalController;
  sourceNames: Record<string, string>;
  onClose: () => void;
  // Called after a successful save. generated=true when 保存并立即生成一次 kicked off a
  // run (the host closes the modal + starts streaming); false for a plain 保存配置与计划.
  onSaved: (generated: boolean) => void;
}) {
  const { t } = useI18n();
  const [draftSpec, setDraftSpec] = useState<SummaryGenerationSpec | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [chats, setChats] = useState<ChatCandidate[]>([]);
  useEffect(() => {
    const spec = controller.configuration?.spec;
    if (!spec) return;
    setDraftSpec(spec);
    setChats(spec.sources.map((source) => ({
      chat_id: source.source_id, chat_type: source.source_type === 1 ? "group" : source.source_type === 2 ? "thread" : "direct",
      name: sourceNames[source.source_id] || source.source_id, member_count: null,
    })));
  }, [controller.configuration]);
  return <>
    <Modal visible title={t("summary.formal.configure")} width={480} footer={null} onCancel={onClose}>
      <div className="summary-native-configuration-body">
        <FormalContentPanel configurationOnly title="" content={controller.content}
          state={{ configuration: controller.configuration, versions: [], hasMore: false, pending: controller.pending,
            errorKey: controller.errorKey, noticeKey: controller.noticeKey, draftSpec, sourceLabels: chats.map((chat) => chat.name) }}
          actions={{ onDraftSpecChange: setDraftSpec, onChooseSources: () => setSelecting(true),
            onConfigure: () => void controller.loadConfiguration(),
            onSaveConfiguration: async (request, generate) => {
              // 保存后关闭弹窗回详情页；「保存并立即生成一次」再由宿主开启流式。
              const ok = await controller.saveConfiguration(request, generate);
              if (ok) onSaved(generate);
              return ok;
            },
            onRefine: controller.refine, onRegenerate: () => void controller.regenerate(), onEdit: controller.edit,
            onRestore: controller.restore, onVersions: () => {}, onCancel: () => {}, onApply: () => {},
            onReload: () => void controller.loadConfiguration() }}
          renderVersion={() => null} />
      </div>
    </Modal>
    {/* This existing selector loads on a visibility transition, not mount. */}
    <ChatSelectorModal visible={selecting} selected={chats} onCancel={() => setSelecting(false)}
      onConfirm={(selected: ChatCandidate[]) => {
        setChats(selected);
        if (draftSpec) setDraftSpec({ ...draftSpec, sources: selected.map((chat) => ({
          source_id: chat.chat_id, source_type: chat.chat_type === "group" ? 1 : chat.chat_type === "thread" ? 2 : 3,
          confirmation: "user_confirmed",
        })) });
        setSelecting(false);
      }} />
  </>;
}
