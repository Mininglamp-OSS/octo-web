import React, { useState } from "react";
import { Boxes, ChevronDown, FileText, Wrench } from "lucide-react";
import { t, useI18n } from "@octo/base";
import type { ExpertSkill } from "../mock/expertMock";
import ExpertSkillBrowser from "./ExpertSkillBrowser";

interface ExpertSpecViewProps {
  instruction?: string;
  mcpConfig?: string;
  skills?: ExpertSkill[];
  /** Fetch the stored SKILL.md text for the skill at `index` (legacy fallback). */
  fetchSkillContent: (index: number) => Promise<string>;
  /** Resolve the presigned package URL for the skill at `index` (file browser). */
  fetchSkillPackageUrl?: (index: number) => Promise<string>;
  /** Open a URL as a download. */
  openDownload?: (url: string) => void;
}

/**
 * Reusable 指令 / MCP / Skills spec sections, shared by a standalone expert's
 * detail and a squad member's drill-in detail. Each section renders only when
 * its field is present. A content/downloadable skill row expands in place
 * (accordion) into an ExpertSkillBrowser: it fetches + unzips the package
 * client-side and lets the user switch between the bundled files to view each
 * one's content, plus download the whole package.
 */
export default function ExpertSpecView({
  instruction,
  mcpConfig,
  skills,
  fetchSkillContent,
  fetchSkillPackageUrl,
  openDownload,
}: ExpertSpecViewProps) {
  useI18n();
  // Index of the expanded skill (null when all collapsed); one open at a time.
  const [openSkill, setOpenSkill] = useState<number | null>(null);

  const toggle = (index: number) =>
    setOpenSkill((cur) => (cur === index ? null : index));

  return (
    <>
      {instruction && (
        <section className="wk-mcp-expert-section">
          <div className="wk-mcp-expert-section__heading">
            <FileText size={18} aria-hidden="true" />
            <div>
              <h3>{t("mcp.expert.instructionTitle")}</h3>
            </div>
          </div>
          <p className="wk-mcp-expert-instruction">{instruction}</p>
        </section>
      )}

      {mcpConfig && (
        <section className="wk-mcp-expert-section">
          <div className="wk-mcp-expert-section__heading">
            <Boxes size={18} aria-hidden="true" />
            <div>
              <h3>{t("mcp.expert.mcpTitle")}</h3>
            </div>
          </div>
          <pre className="wk-mcp-expert-code">{mcpConfig}</pre>
        </section>
      )}

      {skills && skills.length > 0 && (
        <section className="wk-mcp-expert-section">
          <div className="wk-mcp-expert-section__heading">
            <Wrench size={18} aria-hidden="true" />
            <div>
              <h3>{t("mcp.expert.skillsTitle")}</h3>
            </div>
          </div>
          <div className="wk-mcp-expert-dependency-list">
            {skills.map((skill, index) => {
              const expandable = skill.hasContent || skill.canDownload;
              if (!expandable) {
                return (
                  <span
                    className="wk-mcp-expert-dependency-item"
                    key={`${skill.name}-${index}`}
                  >
                    {skill.name}
                  </span>
                );
              }
              const isOpen = openSkill === index;
              return (
                <div className="wk-mcp-expert-skill" key={`${skill.name}-${index}`}>
                  <button
                    type="button"
                    className="wk-mcp-expert-skill__row"
                    aria-expanded={isOpen}
                    onClick={() => toggle(index)}
                  >
                    <span>{skill.name}</span>
                    <ChevronDown
                      size={16}
                      aria-hidden="true"
                      className={
                        isOpen
                          ? "wk-mcp-expert-skill__chevron is-open"
                          : "wk-mcp-expert-skill__chevron"
                      }
                    />
                  </button>
                  {isOpen && (
                    <ExpertSkillBrowser
                      skill={skill}
                      fetchContent={() => fetchSkillContent(index)}
                      fetchPackageUrl={
                        fetchSkillPackageUrl
                          ? () => fetchSkillPackageUrl(index)
                          : undefined
                      }
                      openDownload={openDownload ?? (() => undefined)}
                    />
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
