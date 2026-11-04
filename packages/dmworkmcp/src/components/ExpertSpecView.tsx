import React, { useState } from "react";
import { Boxes, ChevronDown, FileText, Wrench } from "lucide-react";
import { t, useI18n } from "@octo/base";
import type { ExpertConnector, ExpertSkill } from "../mock/expertMock";
import DependencyMetadata from "../ui/DependencyMetadata";
import BoundVersionBadge from "./BoundVersionBadge";
import ExpertSkillBrowser from "./ExpertSkillBrowser";
import { redactMcpConfig } from "../utils/redactMcpConfig";

interface ExpertSpecViewProps {
  instruction?: string;
  mcpConfig?: string;
  connectors?: ExpertConnector[];
  skills?: ExpertSkill[];
  fetchSkillContent: (index: number) => Promise<string>;
  fetchSkillPackageUrl?: (index: number) => Promise<string>;
}

let nextSpecId = 0;

/** Shared by expert detail and the pinned member of an expert team. */
export default function ExpertSpecView({
  instruction,
  mcpConfig,
  connectors,
  skills,
  fetchSkillContent,
  fetchSkillPackageUrl,
}: ExpertSpecViewProps) {
  useI18n();
  const [id] = useState(() => `expert-spec-${++nextSpecId}`);
  const [openSkill, setOpenSkill] = useState<string | null>(null);
  const [openConnector, setOpenConnector] = useState<string | null>(null);
  const metadata = {
    authorLabel: t("mcp.expert.dependencyAuthor"),
    unknownAuthor: t("mcp.expert.dependencyUnknownAuthor"),
    noSummary: t("mcp.expert.dependencyNoSummary"),
  };
  // Only legacy experts without connector relations use their inline config.
  const mcps: ExpertConnector[] =
    connectors !== undefined
      ? connectors
      : mcpConfig
      ? [
          {
            pluginId: "legacy-inline",
            name: t("mcp.expert.dependencyLegacyConfig"),
            config: mcpConfig,
          },
        ]
      : [];

  return (
    <>
      {instruction && (
        <section className="wk-mcp-expert-section">
          <div className="wk-mcp-expert-section__heading">
            <FileText size={18} aria-hidden="true" />
            <h3>{t("mcp.expert.instructionTitle")}</h3>
          </div>
          <p className="wk-mcp-expert-instruction">{instruction}</p>
        </section>
      )}
      {!!skills?.length && (
        <section className="wk-mcp-expert-section">
          <div className="wk-mcp-expert-section__heading">
            <Wrench size={18} aria-hidden="true" />
            <h3>{t("mcp.expert.skillsTitle")}</h3>
          </div>
          <div className="wk-mcp-expert-dependency-list">
            {skills.map((skill, index) => {
              const key = `${skill.pluginId || skill.name}:${
                skill.versionId || "legacy"
              }:${index}`;
              const isOpen = openSkill === key;
              const panelId = `${id}-skill-${index}`;
              return (
                <div className="wk-mcp-expert-skill" key={key}>
                  <button
                    type="button"
                    id={`${panelId}-trigger`}
                    className="wk-mcp-expert-skill__row"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => setOpenSkill(isOpen ? null : key)}
                  >
                    <span className="wk-mcp-dependency-name">{skill.name}</span>
                    <BoundVersionBadge versionId={skill.versionId} version={skill.version} />
                    <ChevronDown
                      size={16}
                      aria-hidden="true"
                      className={`wk-mcp-expert-skill__chevron${
                        isOpen ? " is-open" : ""
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <div
                      id={panelId}
                      role="region"
                      aria-labelledby={`${panelId}-trigger`}
                      className="wk-mcp-dependency-body"
                    >
                      <DependencyMetadata
                        {...metadata}
                        creatorName={skill.creatorName}
                        botName={skill.botName}
                        summary={skill.summary}
                      />
                      {skill.hasContent || skill.canDownload ? (
                        <ExpertSkillBrowser
                          key={key}
                          skill={skill}
                          fetchContent={() => fetchSkillContent(index)}
                          fetchPackageUrl={
                            fetchSkillPackageUrl
                              ? () => fetchSkillPackageUrl(index)
                              : undefined
                          }
                        />
                      ) : (
                        <p className="wk-mcp-expert-skill__state">
                          {t("mcp.expert.dependencyNoContent")}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
      {!!mcps.length && (
        <section className="wk-mcp-expert-section">
          <div className="wk-mcp-expert-section__heading">
            <Boxes size={18} aria-hidden="true" />
            <h3>{t("mcp.expert.mcpTitle")}</h3>
          </div>
          <div className="wk-mcp-expert-dependency-list">
            {mcps.map((connector, index) => {
              const key = `${connector.pluginId}:${index}`;
              const isOpen = openConnector === key;
              const panelId = `${id}-mcp-${index}`;
              return (
                <div className="wk-mcp-expert-skill" key={key}>
                  <button
                    type="button"
                    id={`${panelId}-trigger`}
                    className="wk-mcp-expert-skill__row"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => setOpenConnector(isOpen ? null : key)}
                  >
                    <span className="wk-mcp-dependency-name">
                      {connector.name}
                    </span>
                    <span className="wk-mcp-bound-version">{t("mcp.expert.versionless")}</span>
                    <ChevronDown
                      size={16}
                      aria-hidden="true"
                      className={`wk-mcp-expert-skill__chevron${
                        isOpen ? " is-open" : ""
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <div
                      id={panelId}
                      role="region"
                      aria-labelledby={`${panelId}-trigger`}
                      className="wk-mcp-dependency-body"
                    >
                      <DependencyMetadata
                        {...metadata}
                        creatorName={connector.creatorName}
                        botName={connector.botName}
                        summary={connector.summary}
                      />
                      {connector.config && (
                        <pre className="wk-mcp-expert-code">
                          {redactMcpConfig(connector.config) ??
                            t("mcp.expert.mcpUnavailable")}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}
