import React, { useEffect, useState } from "react";
import { useI18n } from "@octo/base";
import type { SummaryFormalContent, SummaryGenerationSpec } from "../../Service/SummaryContentContract";
import useFormalContent from "../../bridge/summaryWorkbench/useFormalContent";
import FormalContentPanel from "../../ui/SummaryWorkbench/FormalContentPanel";
import CitationText from "../../components/CitationText";
import ChatSelectorModal from "../../components/ChatSelectorModal";
import type { ChatCandidate } from "../../types/summary";

interface FormalContentFeatureProps {
  taskId: number;
  title: string;
  spaceId: string;
  initial: SummaryFormalContent;
}

export function FormalContentFeature({ taskId, title, spaceId, initial }: FormalContentFeatureProps) {
  const { t } = useI18n();
  const controller = useFormalContent(spaceId, taskId, initial);
  const [draftSpec, setDraftSpec] = useState<SummaryGenerationSpec | null>(null);
  const [selectingSources, setSelectingSources] = useState(false);
  const [chats, setChats] = useState<ChatCandidate[]>([]);
  useEffect(() => {
    const spec = controller.configuration?.spec;
    if (!spec) return;
    setDraftSpec(spec);
    setChats(spec.sources.map((source: SummaryGenerationSpec["sources"][number]) => ({
      chat_id: source.source_id,
      chat_type: source.source_type === 1 ? "group" : source.source_type === 2 ? "thread" : "direct",
      name: source.source_id, member_count: null,
    })));
  }, [controller.configuration]);
  if (controller.accessLost) return <p role="alert">{t("summary.formal.errors.unavailable")}</p>;
  return <>
    <FormalContentPanel title={title} content={controller.content}
      state={{
        configuration: controller.configuration, versions: controller.versions, hasMore: Boolean(controller.cursor),
        pending: controller.pending, errorKey: controller.errorKey, noticeKey: controller.noticeKey,
        draftSpec, sourceLabels: chats.map((chat: ChatCandidate) => chat.name),
      }}
      actions={{
        onDraftSpecChange: setDraftSpec, onChooseSources: () => setSelectingSources(true),
        onConfigure: () => void controller.loadConfiguration(), onSaveConfiguration: controller.saveConfiguration,
        onRefine: controller.refine, onRegenerate: () => void controller.regenerate(),
        onEdit: controller.edit, onRestore: controller.restore, onVersions: (more) => void controller.loadVersions(more),
        onCancel: () => void controller.cancel(), onApply: (generation) => void controller.apply(generation),
        onReload: () => void controller.reload(),
      }}
      renderVersion={(version) => <CitationText content={version.content} citations={version.citations}
        teamCitations={version.team_citations} hidePlainCitations={version.citation_visibility === "permission_hidden"}
        disableTeamMemberPreview={version.team_citation_visibility === "historical_identity_only"} />}
    />
    <ChatSelectorModal visible={selectingSources} selected={chats} onCancel={() => setSelectingSources(false)}
      onConfirm={(selected: ChatCandidate[]) => {
        setChats(selected);
        if (draftSpec) setDraftSpec({ ...draftSpec, sources: selected.map((chat) => ({
          source_id: chat.chat_id, source_type: chat.chat_type === "group" ? 1 : chat.chat_type === "thread" ? 2 : 3,
          confirmation: "user_confirmed",
        })) });
        setSelectingSources(false);
      }} />
  </>;
}

export default FormalContentFeature;
