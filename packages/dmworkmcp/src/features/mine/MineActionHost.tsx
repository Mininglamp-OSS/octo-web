import React, { useCallback, useEffect, useRef, useState } from "react";
import { Toast } from "@douyinfe/semi-ui";
import { t, useI18n } from "@octo/base";
import {
  EditSkillModal,
  DeleteConfirmModal,
  getCategories,
  getSkill,
  NewSkillModal,
  SkillDetailModal,
  type Category,
  type MineActionRequest,
  type Skill,
} from "@dmwork/skillmarket";
import McpCreateModal from "../../components/McpCreateModal";
import McpDetailModal from "../../components/McpDetailModal";
import ExpertBotPublishModal from "../../components/ExpertBotPublishModal";
import ExpertEditModal from "../../components/ExpertEditModal";
import ExpertDetailModal from "../../components/ExpertDetailModal";
import ReviewSubmitModal, {
  type ReviewSubmitTarget,
} from "../../components/ReviewSubmitModal";
import { fetchMcpDetail } from "../../api/mcpService";
import {
  getExpert,
  getSquad,
  loadExpertReviewSnapshot,
} from "../../api/expertService";
import type { ExpertItem } from "../../mock/expertMock";
import type { McpDetail } from "../../types/mcp";

interface MineActionHostProps {
  request: MineActionRequest | null;
  onClose: () => void;
  onChanged: () => void;
}

/** Opens the owning detail/edit/upgrade flow over the mixed 全部 list without
 * navigating away. Each flow remains the same component its type page uses. */
export default function MineActionHost({
  request,
  onClose,
  onChanged,
}: MineActionHostProps) {
  useI18n();
  const [skill, setSkill] = useState<Skill | null>(null);
  const [skillFlow, setSkillFlow] = useState<"edit" | "upgrade" | null>(null);
  const [skillDetailId, setSkillDetailId] = useState<string | null>(null);
  const [deletingSkill, setDeletingSkill] = useState<Skill | null>(null);
  const [skillCategories, setSkillCategories] = useState<Category[]>([]);
  const [connector, setConnector] = useState<McpDetail | null>(null);
  const [connectorFlow, setConnectorFlow] = useState<"edit" | "upgrade" | null>(
    null
  );
  const [connectorDetailId, setConnectorDetailId] = useState<string | null>(
    null
  );
  const [expert, setExpert] = useState<ExpertItem | null>(null);
  const [expertDetail, setExpertDetail] = useState<ExpertItem | null>(null);
  const [reviewTarget, setReviewTarget] = useState<ReviewSubmitTarget | null>(
    null
  );
  const [botTarget, setBotTarget] = useState<ExpertItem | null>(null);
  const changedRef = useRef(false);

  const clear = useCallback(() => {
    setSkill(null);
    setSkillFlow(null);
    setSkillDetailId(null);
    setDeletingSkill(null);
    setSkillCategories([]);
    setConnector(null);
    setConnectorFlow(null);
    setConnectorDetailId(null);
    setExpert(null);
    setExpertDetail(null);
    setReviewTarget(null);
    setBotTarget(null);
  }, []);

  const close = useCallback(() => {
    clear();
    onClose();
  }, [clear, onClose]);

  const notifyChanged = useCallback(() => {
    if (changedRef.current) return;
    changedRef.current = true;
    onChanged();
  }, [onChanged]);

  useEffect(() => {
    if (!request) {
      clear();
      return undefined;
    }
    let active = true;
    changedRef.current = false;
    clear();

    const load = async () => {
      if (request.type === "skill") {
        if (request.action === "view") {
          const categories = await getCategories();
          if (!active) return;
          setSkillCategories(categories);
          setSkillDetailId(request.pluginId);
          return;
        }
        const [item, categories] = await Promise.all([
          getSkill(request.pluginId),
          getCategories(),
        ]);
        if (!active) return;
        setSkillCategories(categories);
        setSkillFlow(request.action);
        setSkill(item);
        return;
      }

      if (request.type === "connector") {
        if (request.action === "view") {
          setConnectorDetailId(request.pluginId);
          return;
        }
        const item = await fetchMcpDetail(request.pluginId);
        if (active) {
          setConnectorFlow(request.action);
          setConnector(item);
        }
        return;
      }

      const item = await (request.type === "squad"
        ? getSquad(request.pluginId)
        : getExpert(request.pluginId));
      if (!active) return;
      if (request.action === "view") {
        setExpertDetail(item);
      } else if (request.action === "edit") {
        setExpert(item);
      } else {
        setReviewTarget({
          pluginId: item.id,
          name: item.name,
          version: item.version,
          isUpgrade: true,
          loadSnapshot: () => loadExpertReviewSnapshot(item.id),
          needs: { relations: true, content: true },
        });
      }
    };

    void load().catch((error) => {
      if (!active) return;
      Toast.error(
        error instanceof Error
          ? error.message
          : t("skillMarket.common.loadFailed")
      );
      close();
    });
    return () => {
      active = false;
    };
  }, [clear, close, request?.requestId]);

  return (
    <>
      <SkillDetailModal
        skillId={skillDetailId}
        categories={skillCategories}
        onClose={close}
        onEdit={(item) => {
          const pending = item.displayStatus === "pending_review";
          if (pending) {
            Toast.warning(t("skillMarket.review.pendingBlocksEdit"));
            return;
          }
          const listedToOrg =
            item.listingState === "published" && item.visibility === "space";
          setSkillDetailId(null);
          setSkillFlow(listedToOrg ? "upgrade" : "edit");
          setSkill(item);
        }}
        onDelete={(item) => setDeletingSkill(item)}
      />
      <EditSkillModal
        skill={skillFlow === "edit" ? skill : null}
        categories={skillCategories}
        onClose={close}
        onUpdated={notifyChanged}
        onPublished={(message) => {
          Toast.success(message);
          notifyChanged();
        }}
      />
      <NewSkillModal
        visible={Boolean(skill) && skillFlow === "upgrade"}
        categories={skillCategories}
        reviewSkill={skill}
        reviewInitial={null}
        onClose={close}
        onCreated={(message) => {
          Toast.success(message ?? t("skillMarket.review.submittedToast"));
          notifyChanged();
        }}
      />
      <DeleteConfirmModal
        skill={deletingSkill}
        onClose={() => setDeletingSkill(null)}
        onDeleted={() => {
          Toast.success(t("skillMarket.list.deleted"));
          notifyChanged();
          close();
        }}
      />
      <McpCreateModal
        visible={Boolean(connector)}
        editing={connector}
        reviewMode={connectorFlow === "upgrade"}
        onClose={close}
        onSaved={notifyChanged}
        onPublished={(message) => {
          Toast.success(message);
          notifyChanged();
        }}
        onReviewSubmitted={(message) => {
          Toast.success(message);
          notifyChanged();
        }}
      />
      <McpDetailModal
        mcpId={connectorDetailId}
        onClose={close}
        canManage
        onEdit={(item) => {
          if (item.displayStatus === "pending_review") {
            Toast.warning(t("mcp.review.pendingBlocksEdit"));
            return;
          }
          const listedToOrg =
            item.listingState === "published" && item.visibility === "space";
          setConnectorDetailId(null);
          setConnectorFlow(listedToOrg ? "upgrade" : "edit");
          setConnector(item);
        }}
        onDeleted={() => {
          notifyChanged();
          close();
        }}
      />
      <ReviewSubmitModal
        target={reviewTarget}
        onClose={close}
        onSubmitted={(message) => {
          Toast.success(message);
          notifyChanged();
        }}
      />
      <ExpertEditModal
        item={expert}
        onClose={close}
        onSaved={(message) => {
          Toast.success(message);
          notifyChanged();
        }}
        onEditContent={(item) => {
          setExpert(null);
          setBotTarget(item);
        }}
      />
      <ExpertDetailModal item={expertDetail} onClose={close} />
      <ExpertBotPublishModal
        visible={Boolean(botTarget)}
        kind={botTarget?.kind === "squad" ? "squad" : "agent"}
        mode="update"
        editingId={botTarget?.id}
        onClose={close}
        onToast={(message) => Toast.success(message)}
      />
    </>
  );
}
