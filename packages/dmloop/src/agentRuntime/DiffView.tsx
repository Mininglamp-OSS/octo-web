// @octo/loop — 富 diff 视图
//
// 按研发设计文档的 diff JSON 契约 {path,changeType,hunks,binary,truncated} 渲染，
// 支持 split（并排）/ unified（单栏）切换 + 行内 word diff 高亮。
//
// 关于库选型：设计文档指定「react-diff-view（默认）+ 大文件切 Monaco DiffEditor」。
// 当前 dmloop 未引入这两个依赖（package.json 仅有 lucide-react/react-markdown 等），
// 为保持增量 PR 可构建、不擅自扩容依赖树，这里先用零依赖的自渲染实现（词级高亮走
// 本包 wordDiff）。已按契约把「大文件 / 二进制 / 截断」的降级分支与渲染 seam 留好：
// 后续引入 react-diff-view / @monaco-editor/react 时，仅替换 <FileDiffBody> 内部渲染，
// 上层 props（FileDiff 契约）与交互（split/unified、阈值切换）不变。

import React, { useMemo, useState } from "react";
import { FileCode, FilePlus, FileMinus, FileText, Columns2, AlignJustify } from "lucide-react";
import type { FileDiff, DiffHunkLine } from "../api/agentRuntime/contracts";
import { wordDiff } from "./wordDiff";
import "./diffView.css";

// 超过该行数视为「大文件」，提示切换到重型编辑器（Monaco，待依赖引入）。
const LARGE_FILE_LINES = 800;

type ViewMode = "split" | "unified";

function changeIcon(t: FileDiff["changeType"]) {
  if (t === "added") return <FilePlus size={14} className="loop-diff-ic add" />;
  if (t === "deleted") return <FileMinus size={14} className="loop-diff-ic del" />;
  if (t === "renamed" || t === "copied") return <FileText size={14} className="loop-diff-ic mod" />;
  return <FileCode size={14} className="loop-diff-ic mod" />;
}

// 把一对 delete/insert 行做词级 diff，渲染成带高亮 span 的行内内容。
function InlineWord({ oldLine, newLine, side }: { oldLine: string; newLine: string; side: "old" | "new" }) {
  const segs = useMemo(() => wordDiff(oldLine, newLine), [oldLine, newLine]);
  return (
    <>
      {segs
        .filter((s) => (side === "old" ? s.kind !== "insert" : s.kind !== "delete"))
        .map((s, i) => (
          <span
            key={i}
            className={s.kind === "equal" ? undefined : side === "old" ? "loop-diff-word-del" : "loop-diff-word-ins"}
          >
            {s.value}
          </span>
        ))}
    </>
  );
}

// 把 hunk 行配成 unified 或 split 的可渲染行。
interface PairedRow {
  oldLine?: DiffHunkLine;
  newLine?: DiffHunkLine;
}

// 在一段连续变更块内，按顺序把 delete 与 insert 配对（用于 split 并排 + 行内 word diff）。
function pairHunkLines(lines: DiffHunkLine[]): PairedRow[] {
  const rows: PairedRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.type === "normal") {
      rows.push({ oldLine: line, newLine: line });
      i++;
      continue;
    }
    // 收集连续的 delete 块与其后连续的 insert 块。
    const dels: DiffHunkLine[] = [];
    const ins: DiffHunkLine[] = [];
    while (i < lines.length && lines[i].type === "delete") dels.push(lines[i++]);
    while (i < lines.length && lines[i].type === "insert") ins.push(lines[i++]);
    const n = Math.max(dels.length, ins.length);
    for (let k = 0; k < n; k++) rows.push({ oldLine: dels[k], newLine: ins[k] });
  }
  return rows;
}

function SplitBody({ diff }: { diff: FileDiff }) {
  return (
    <table className="loop-diff-table split">
      <tbody>
        {diff.hunks.map((h, hi) => (
          <React.Fragment key={hi}>
            <tr className="loop-diff-hunk-header">
              <td colSpan={4}>{h.header || `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`}</td>
            </tr>
            {pairHunkLines(h.lines).map((row, ri) => {
              const paired = row.oldLine?.type === "delete" && row.newLine?.type === "insert";
              return (
                <tr key={ri}>
                  <td className="loop-diff-ln">{row.oldLine?.oldLine ?? ""}</td>
                  <td className={`loop-diff-code ${row.oldLine?.type ?? "empty"}`}>
                    {row.oldLine
                      ? paired
                        ? <InlineWord oldLine={row.oldLine.content} newLine={row.newLine!.content} side="old" />
                        : row.oldLine.content
                      : ""}
                  </td>
                  <td className="loop-diff-ln">{row.newLine?.newLine ?? ""}</td>
                  <td className={`loop-diff-code ${row.newLine?.type ?? "empty"}`}>
                    {row.newLine
                      ? paired
                        ? <InlineWord oldLine={row.oldLine!.content} newLine={row.newLine.content} side="new" />
                        : row.newLine.content
                      : ""}
                  </td>
                </tr>
              );
            })}
          </React.Fragment>
        ))}
      </tbody>
    </table>
  );
}

function UnifiedBody({ diff }: { diff: FileDiff }) {
  return (
    <table className="loop-diff-table unified">
      <tbody>
        {diff.hunks.map((h, hi) => (
          <React.Fragment key={hi}>
            <tr className="loop-diff-hunk-header">
              <td colSpan={3}>{h.header || `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`}</td>
            </tr>
            {h.lines.map((line, li) => (
              <tr key={li}>
                <td className="loop-diff-ln">{line.oldLine ?? ""}</td>
                <td className="loop-diff-ln">{line.newLine ?? ""}</td>
                <td className={`loop-diff-code ${line.type}`}>
                  <span className="loop-diff-sign">{line.type === "insert" ? "+" : line.type === "delete" ? "-" : " "}</span>
                  {line.content}
                </td>
              </tr>
            ))}
          </React.Fragment>
        ))}
      </tbody>
    </table>
  );
}

function FileDiffBody({ diff, mode }: { diff: FileDiff; mode: ViewMode }) {
  if (diff.binary) return <div className="loop-diff-notice">Binary file not shown</div>;
  const lineCount = diff.hunks.reduce((n, h) => n + h.lines.length, 0);
  return (
    <>
      {lineCount > LARGE_FILE_LINES && (
        // 大文件降级提示：设计文档要求切 Monaco DiffEditor，依赖引入后在此挂载。
        <div className="loop-diff-notice warn">
          Large file ({lineCount} lines) — rendered in lightweight mode. A Monaco-based
          side-by-side editor is planned once the editor dependency is added.
        </div>
      )}
      {mode === "split" ? <SplitBody diff={diff} /> : <UnifiedBody diff={diff} />}
      {diff.truncated && <div className="loop-diff-notice warn">Diff truncated by server</div>}
    </>
  );
}

export interface DiffViewProps {
  diffs: FileDiff[];
  defaultMode?: ViewMode;
}

export default function DiffView({ diffs, defaultMode = "split" }: DiffViewProps) {
  const [mode, setMode] = useState<ViewMode>(defaultMode);
  if (!diffs.length) return <div className="loop-diff-empty">No changes</div>;
  return (
    <div className="loop-diff-root">
      <div className="loop-diff-toolbar">
        <button
          type="button"
          className={`loop-diff-modebtn ${mode === "split" ? "active" : ""}`}
          onClick={() => setMode("split")}
          title="Split view"
        >
          <Columns2 size={14} /> Split
        </button>
        <button
          type="button"
          className={`loop-diff-modebtn ${mode === "unified" ? "active" : ""}`}
          onClick={() => setMode("unified")}
          title="Unified view"
        >
          <AlignJustify size={14} /> Unified
        </button>
      </div>
      {diffs.map((d, i) => (
        <div className="loop-diff-file" key={`${d.path}-${i}`}>
          <div className="loop-diff-file-header">
            {changeIcon(d.changeType)}
            <span className="loop-diff-path">
              {d.changeType === "renamed" && d.oldPath ? `${d.oldPath} → ${d.path}` : d.path}
            </span>
            {typeof d.additions === "number" && <span className="loop-diff-add">+{d.additions}</span>}
            {typeof d.deletions === "number" && <span className="loop-diff-del">-{d.deletions}</span>}
          </div>
          <FileDiffBody diff={d} mode={mode} />
        </div>
      ))}
    </div>
  );
}
