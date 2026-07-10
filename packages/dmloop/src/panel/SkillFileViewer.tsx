import React, { useMemo, useState } from "react";
import { Button } from "@douyinfe/semi-ui";
import { Pencil, Eye } from "lucide-react";
import { useI18n } from "@octo/base";
import { parseFrontmatter } from "../ui/frontmatter";
import LoopMarkdown from "../ui/LoopMarkdown";

function isMarkdown(path: string) {
  return path.endsWith(".md") || path.endsWith(".mdx");
}

/** 单文件查看/编辑：md 支持预览/编辑切换 + frontmatter；其它文件仅编辑。 */
export default function SkillFileViewer({
  path, content, readOnly, onChange,
}: {
  path: string;
  content: string;
  readOnly?: boolean;
  onChange: (content: string) => void;
}) {
  const { t } = useI18n();
  const isMd = isMarkdown(path);
  const [mode, setMode] = useState<"preview" | "edit">(isMd ? "preview" : "edit");

  const { frontmatter, body } = useMemo(
    () => (isMd ? parseFrontmatter(content) : { frontmatter: null, body: content }),
    [content, isMd],
  );
  const frontmatterRows = useMemo(() => Object.entries(frontmatter ?? {}), [frontmatter]);

  const showPreview = isMd && mode === "preview";

  return (
    <div className="loop-fv">
      <div className="loop-fv__head">
        <span className="loop-fv__path">{path}</span>
        {isMd && (
          <div className="loop-fv__modes" role="tablist" aria-label={path}>
            <Button
              size="small"
              theme={mode === "edit" ? "light" : "borderless"}
              icon={<Pencil size={13} />}
              className={`loop-fv__mode${mode === "edit" ? " is-active" : ""}`}
              onClick={() => setMode("edit")}
            >
              {t("loop.skill.detail.edit")}
            </Button>
            <Button
              size="small"
              theme={mode === "preview" ? "light" : "borderless"}
              icon={<Eye size={13} />}
              className={`loop-fv__mode${mode === "preview" ? " is-active" : ""}`}
              onClick={() => setMode("preview")}
            >
              {t("loop.skill.detail.preview")}
            </Button>
          </div>
        )}
      </div>
      <div className="loop-fv__body">
        {showPreview ? (
          <div className="loop-fv__preview">
            {path === "SKILL.md" && frontmatterRows.length > 0 && (
              <table className="loop-fv__frontmatter">
                <tbody>
                  {frontmatterRows.map(([key, value]) => (
                    <tr key={key}>
                      <th>{key}</th>
                      <td>{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <LoopMarkdown content={body || t("loop.skill.detail.noContent")} />
          </div>
        ) : (
          <textarea
            className="loop-fv__editor loop-mono"
            value={content}
            readOnly={readOnly}
            onChange={(e) => onChange(e.target.value)}
            placeholder={t("loop.skill.detail.contentPlaceholder")}
            spellCheck={false}
          />
        )}
      </div>
    </div>
  );
}
