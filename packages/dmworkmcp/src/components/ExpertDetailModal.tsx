import React, { useEffect, useMemo, useState } from "react";
import {
  Bot,
  Check,
  Copy,
  Route,
  UserRound,
  Users,
} from "lucide-react";
import { t, useI18n, WKButton, WKModal } from "@octo/base";
import type { ExpertItem, ExpertMember } from "../mock/expertMock";
import { DEFAULT_STRATEGIES } from "../mock/expertMock";
import { getExpertSkillContent, getSquadSkillContent, getExpertSkillDownloadUrl, getSquadSkillDownloadUrl, openDownloadUrl } from "../api/expertService";
import { buildExpertPrompt } from "../utils/buildExpertPrompt";
import { getMcpAvatarColor } from "../utils/mcpAvatar";
import { resolveExpertOwner } from "../utils/expertOwner";
import ExpertSpecView from "./ExpertSpecView";

interface ExpertDetailModalProps {
  item: ExpertItem | null;
  onClose: () => void;
  /** Copy the install prompt; returns whether the copy succeeded. */
  onCopy: (item: ExpertItem) => void | Promise<void>;
}

function memberInitial(name: string): string {
  return Array.from(name.trim())[0] ?? "?";
}

/**
 * Expert / expert-squad detail modal. Shows the dispatch strategy, members,
 * dependencies, permission and the copyable install prompt. Agents render a
 * simplified intro (no members/strategy). Squad members can be drilled into
 * (in-place) to view their own spec (指令 / MCP / Skills).
 */
export default function ExpertDetailModal({ item, onClose, onCopy }: ExpertDetailModalProps) {
  useI18n();
  const [copied, setCopied] = useState(false);
  // A drilled-into squad member; null shows the squad overview.
  const [drillMember, setDrillMember] = useState<ExpertMember | null>(null);

  // Reset copied feedback + member drill-in whenever a different item is opened.
  useEffect(() => {
    if (item) {
      setCopied(false);
      setDrillMember(null);
    }
  }, [item?.id]);

  const prompt = useMemo(() => (item ? buildExpertPrompt(item) : ""), [item]);

  if (!item) return null;

  const isSquad = item.kind === "squad";
  const strategies = isSquad ? item.strategies ?? DEFAULT_STRATEGIES : [];
  const owner = resolveExpertOwner(item);

  const handleCopy = async () => {
    await onCopy(item);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  // Drilled into a squad member: no standalone install prompt for a member.
  const showPrompt = !(isSquad && drillMember);
  const twoColumn = isSquad && !drillMember;

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
        </div>
      </div>
    </div>
  );

  const promptPanel = (
    <aside className="wk-mcp-expert-prompt">
      <div className="wk-mcp-expert-prompt__header">
        <h3>{t("mcp.expert.installPromptTitle")}</h3>
        <p>{t("mcp.expert.installPromptHint")}</p>
      </div>
      <pre className="wk-mcp-expert-prompt__preview">{prompt}</pre>
      <div className="wk-mcp-expert-prompt__footer">
        <WKButton
          variant="primary"
          className="wk-mcp-expert-prompt__copy"
          icon={copied ? <Check size={15} /> : <Copy size={15} />}
          onClick={handleCopy}
        >
          {copied ? t("mcp.expert.copied") : t("mcp.expert.copyPrompt")}
        </WKButton>
      </div>
    </aside>
  );

  return (
    <WKModal
      visible={Boolean(item)}
      onCancel={onClose}
      title={null}
      width="min(880px, calc(100vw - 32px))"
      className="wk-mcp-expert-modal"
      header={header}
    >
      <div
        className={
          twoColumn
            ? "wk-mcp-expert-detail__layout"
            : "wk-mcp-expert-detail__layout wk-mcp-expert-detail__layout--agent"
        }
      >
        <div className="wk-mcp-expert-detail__overview">
            {isSquad && drillMember && (
              <>
                <button
                  type="button"
                  className="wk-mcp-expert-member-back"
                  onClick={() => setDrillMember(null)}
                >
                  {t("mcp.expert.backToSquad")}
                </button>
                <div className="wk-mcp-expert-member-detail__header">
                  <span
                    className="wk-mcp-expert-member-row__avatar"
                    aria-hidden="true"
                  >
                    {memberInitial(drillMember.name)}
                  </span>
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
                  fetchSkillContent={(i) =>
                    getSquadSkillContent(item.id, drillMember.key ?? "", i)
                  }
                  fetchSkillPackageUrl={(i) =>
                    getSquadSkillDownloadUrl(item.id, drillMember.key ?? "", i)
                  }
                  openDownload={openDownloadUrl}
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
                      <span className="wk-mcp-expert-member-row__avatar" aria-hidden="true">
                        {memberInitial(member.name)}
                      </span>
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
                openDownload={openDownloadUrl}
              />
            )}
          </div>

          {showPrompt && promptPanel}
      </div>
    </WKModal>
  );
}
