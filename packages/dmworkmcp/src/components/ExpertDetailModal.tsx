import React, { useEffect, useState } from "react";
import {
  Bot,
  ChevronLeft,
  Download,
  Eye,
  Route,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import { t, useI18n } from "@octo/base";
import type { ExpertItem, ExpertMember } from "../mock/expertMock";
import { getExpertSkillContent, getSquadSkillContent, getExpertSkillDownloadUrl, getSquadSkillDownloadUrl, trackExpertView } from "../api/expertService";
import { getMcpAvatarColor } from "../utils/mcpAvatar";
import { resolveExpertOwner } from "../utils/expertOwner";
import { isOfficialExpert } from "../utils/publisher";
import { formatCount } from "../utils/format";
import ExpertSpecView from "./ExpertSpecView";
import { Modal as OctoModal } from "@octo/ui";

interface ExpertDetailModalProps {
  item: ExpertItem | null;
  onClose: () => void;
}

function memberInitial(name: string): string {
  return Array.from(name.trim())[0] ?? "?";
}

/** Hash-tinted member avatar (initial on a deterministic per-member color).
 *  The tint is salted with the squad id so same-named members of different
 *  squads still differ. Bundles the tint class with its required inline
 *  background so call sites can't apply one without the other. */
function MemberAvatar({ itemId, member }: { itemId: string; member: ExpertMember }) {
  return (
    <span
      className="wk-mcp-expert-member-row__avatar wk-mcp-expert-member-row__avatar--tinted"
      style={{ background: getMcpAvatarColor(`${itemId}:${member.key ?? member.name}`) }}
      aria-hidden="true"
    >
      {memberInitial(member.name)}
    </span>
  );
}

/**
 * Expert / expert-squad detail modal. Shows the dispatch strategy, members,
 * dependencies and permission. Agents render a simplified intro (no
 * members/strategy). Squad members can be drilled into (in-place) to view their
 * own spec (指令 / MCP / Skills). Installing (添加到回路) is handled by
 * ExpertAddToLoopModal from the card's install button, not here.
 */
export default function ExpertDetailModal({ item, onClose }: ExpertDetailModalProps) {
  useI18n();
  // A drilled-into squad member; null shows the squad overview.
  const [drillMember, setDrillMember] = useState<ExpertMember | null>(null);

  // Per opened item (keyed by id + kind, so a list-item -> hydrated-detail
  // swap of the same record re-triggers neither, while a cross-kind swap at an
  // identical id — unreachable via the UI today but exercised in tests — still
  // records its own view): reset the member drill-in and record one
  // best-effort view event. trackExpertView never rejects.
  useEffect(() => {
    if (!item) return;
    setDrillMember(null);
    void trackExpertView(item.kind, item.id);
  }, [item?.id, item?.kind]);

  if (!item) return null;

  const isSquad = item.kind === "squad";
  // mapSquadDetail normalises a missing `strategies` to `[]` (not undefined), so
  // `?? DEFAULT` alone never fires — guard on length. The default rules are
  // localized (t()) so an en-US user doesn't see the Chinese fallback.
  const defaultStrategies = [
    t("mcp.expert.defaultStrategy1"),
    t("mcp.expert.defaultStrategy2"),
    t("mcp.expert.defaultStrategy3"),
    t("mcp.expert.defaultStrategy4"),
  ];
  const strategies = isSquad
    ? item.strategies && item.strategies.length
      ? item.strategies
      : defaultStrategies
    : [];
  const owner = resolveExpertOwner(item);

  const header = (
    <div className="wk-mcp-expert-detail__header">
      <span
        className="wk-mcp-expert-detail__logo"
        style={{ background: getMcpAvatarColor(item.id) }}
        aria-hidden="true"
      >
        {item.shortName}
      </span>
      <div className="wk-mcp-expert-detail__heading">
        <div className="wk-mcp-expert-detail__title-row">
          <h2 title={item.name}>{item.name}</h2>
          <span className="wk-mcp-expert-detail__category" title={item.category}>
            {item.category}
          </span>
        </div>
        <div className="wk-mcp-expert-detail__tags">
          {item.tags.map((tag) => (
            <span key={tag} className="wk-mcp-expert-tag">
              {tag}
            </span>
          ))}
        </div>
        <p className="wk-mcp-expert-detail__summary">{item.summary}</p>
        <div className="wk-mcp-expert-detail__meta">
          {isOfficialExpert(item) ? (
            <span className="wk-mcp-expert-owner">
              <span className="wk-mcp-expert-owner__item wk-mcp-detail__owner--official">
                <ShieldCheck size={13} aria-hidden="true" />
                <span className="wk-mcp-expert-owner__name">{t("mcp.card.officialPublisher")}</span>
              </span>
            </span>
          ) : (
            <span className="wk-mcp-expert-owner">
              {owner.botName && (
                <span className="wk-mcp-expert-owner__item" title={owner.botName}>
                  <Bot size={13} aria-hidden="true" />
                  <span className="wk-mcp-expert-owner__name">{owner.botName}</span>
                </span>
              )}
              {owner.botName && owner.humanName && (
                <span className="wk-mcp-expert-owner__sep">·</span>
              )}
              {owner.humanName && (
                <span className="wk-mcp-expert-owner__item" title={owner.humanName}>
                  <UserRound size={13} aria-hidden="true" />
                  <span className="wk-mcp-expert-owner__name">{owner.humanName}</span>
                </span>
              )}
            </span>
          )}
          <span className="wk-mcp-expert-detail__stats">
            <span
              className="wk-mcp-expert-detail__stat"
              title={t("mcp.expert.viewCountTitle", { values: { count: item.viewCount ?? 0 } })}
              aria-label={t("mcp.expert.viewCountTitle", { values: { count: item.viewCount ?? 0 } })}
            >
              <Eye size={13} aria-hidden="true" />
              {formatCount(item.viewCount ?? 0)}
            </span>
            <span
              className="wk-mcp-expert-detail__stat"
              title={t("mcp.expert.installCountTitle", { values: { count: item.installCount ?? 0 } })}
              aria-label={t("mcp.expert.installCountTitle", { values: { count: item.installCount ?? 0 } })}
            >
              <Download size={13} aria-hidden="true" />
              {formatCount(item.installCount ?? 0)}
            </span>
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <OctoModal
      visible={Boolean(item)}
      onCancel={onClose}
      title={null}
      width="min(880px, calc(100vw - 32px))"
      className="wk-mcp-expert-modal"
      closeLabel={t("mcp.common.close")}
      header={header}
    >
      <div className="wk-mcp-expert-detail__layout wk-mcp-expert-detail__layout--agent">
        <div className="wk-mcp-expert-detail__overview">
            {isSquad && drillMember && (
              <>
                <button
                  type="button"
                  className="wk-mcp-expert-member-back"
                  onClick={() => setDrillMember(null)}
                >
                  <ChevronLeft size={15} aria-hidden="true" />
                  {t("mcp.expert.backToSquad")}
                </button>
                <div className="wk-mcp-expert-member-detail__header">
                  <MemberAvatar itemId={item.id} member={drillMember} />
                  <div className="wk-mcp-expert-member-detail__heading">
                    <strong>
                      {drillMember.name}
                      {drillMember.leader && (
                        <span className="wk-mcp-expert-tag wk-mcp-expert-tag--leader">
                          {t("mcp.expert.leader")}
                        </span>
                      )}
                    </strong>
                    <span>{drillMember.role}</span>
                  </div>
                </div>
                <ExpertSpecView
                  instruction={drillMember.instruction}
                  mcpConfig={drillMember.mcpConfig}
                  skills={drillMember.skills}
                  // member_key is optional on the wire. Without it the backend
                  // cannot address this member's skill package, so fail the
                  // fetch deliberately client-side instead of issuing a request
                  // with a guessed empty key (wrong lookup / opaque 4xx).
                  fetchSkillContent={(i) =>
                    drillMember.key
                      ? getSquadSkillContent(item.id, drillMember.key, i)
                      : Promise.reject(
                          new Error(t("mcp.expert.memberKeyMissing"))
                        )
                  }
                  fetchSkillPackageUrl={(i) =>
                    drillMember.key
                      ? getSquadSkillDownloadUrl(item.id, drillMember.key, i)
                      : Promise.reject(
                          new Error(t("mcp.expert.memberKeyMissing"))
                        )
                  }
                />
              </>
            )}

            {isSquad && !drillMember && (
              <section className="wk-mcp-expert-section">
                <div className="wk-mcp-expert-section__heading">
                  <Route size={18} aria-hidden="true" />
                  <div>
                    <h3>{t("mcp.expert.strategyTitle")}</h3>
                    <p>{t("mcp.expert.strategyHint")}</p>
                  </div>
                </div>
                <ol className="wk-mcp-expert-strategy-list">
                  {strategies.map((strategy, index) => (
                    <li key={index}>
                      <span>{index + 1}</span>
                      <p>{strategy}</p>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {isSquad && !drillMember && (
              <section className="wk-mcp-expert-section">
                <div className="wk-mcp-expert-section__heading">
                  <Users size={18} aria-hidden="true" />
                  <div>
                    <h3>{t("mcp.expert.membersTitle")}</h3>
                    <p>
                      {t("mcp.expert.memberCount", {
                        values: { count: item.members.length },
                      })}
                    </p>
                  </div>
                </div>
                <div className="wk-mcp-expert-member-list">
                  {item.members.map((member, index) => (
                    <button
                      type="button"
                      className="wk-mcp-expert-member-row wk-mcp-expert-member-row--button"
                      key={member.key ?? `${member.name}-${index}`}
                      onClick={() => setDrillMember(member)}
                    >
                      <MemberAvatar itemId={item.id} member={member} />
                      <div className="wk-mcp-expert-member-row__copy">
                        <strong>
                          {member.name}
                          {member.leader && (
                            <span className="wk-mcp-expert-tag wk-mcp-expert-tag--leader">
                              {t("mcp.expert.leader")}
                            </span>
                          )}
                        </strong>
                        <span>{member.role}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {!isSquad && (
              <ExpertSpecView
                instruction={item.instruction}
                mcpConfig={item.mcpConfig}
                skills={item.skills}
                fetchSkillContent={(i) => getExpertSkillContent(item.id, i)}
                fetchSkillPackageUrl={(i) => getExpertSkillDownloadUrl(item.id, i)}
              />
            )}
          </div>
      </div>
    </OctoModal>
  );
}
