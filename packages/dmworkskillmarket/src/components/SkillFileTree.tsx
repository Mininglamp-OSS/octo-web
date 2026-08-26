import React, { useMemo, useState } from "react";
import { ChevronDown, File, Folder, Lock, Trash2 } from "lucide-react";
import { t } from "@octo/base";
import type { EditableAttachment } from "../types/skill";

interface SkillFileTreeProps {
  files: EditableAttachment[];
  activePath: string;
  onSelect: (path: string) => void;
  /** Delete a file. Omitted for protected files (SKILL.md) by the parent. */
  onDelete?: (path: string) => void;
}

interface FileLeaf {
  kind: "file";
  name: string;
  path: string;
  readonly: boolean;
}
interface FolderNode {
  kind: "folder";
  name: string;
  path: string;
  children: TreeNode[];
}
type TreeNode = FileLeaf | FolderNode;

/** SKILL.md is the required entrypoint and must not be deletable. */
export const PROTECTED_PATHS = new Set(["SKILL.md"]);

/** Build a nested folder/file tree from the flat attachment paths. Folders come
 *  from the `/`-separated segments; files sort after folders, both alphabetically. */
function buildTree(files: EditableAttachment[]): TreeNode[] {
  const root: FolderNode = { kind: "folder", name: "", path: "", children: [] };
  for (const file of files) {
    const segments = file.path.split("/").filter(Boolean);
    let cursor = root;
    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      const isLeaf = i === segments.length - 1;
      if (isLeaf) {
        cursor.children.push({
          kind: "file",
          name: segment,
          path: file.path,
          readonly: file.readonly,
        });
      } else {
        const dirPath = segments.slice(0, i + 1).join("/");
        let next = cursor.children.find(
          (n): n is FolderNode => n.kind === "folder" && n.path === dirPath
        );
        if (!next) {
          next = { kind: "folder", name: segment, path: dirPath, children: [] };
          cursor.children.push(next);
        }
        cursor = next;
      }
    }
  }
  const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.kind === "folder") sortNodes(node.children);
    }
    return nodes;
  };
  return sortNodes(root.children);
}

export default function SkillFileTree({
  files,
  activePath,
  onSelect,
  onDelete,
}: SkillFileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const renderNodes = (nodes: TreeNode[], depth: number): React.ReactNode =>
    nodes.map((node) => {
      const indent = { paddingLeft: `${8 + depth * 16}px` };
      if (node.kind === "folder") {
        const isCollapsed = collapsed.has(node.path);
        return (
          <div
            key={node.path}
            className={
              isCollapsed
                ? "skill-editor-tree__node is-collapsed"
                : "skill-editor-tree__node"
            }
          >
            <button
              type="button"
              className="skill-editor-tree__row skill-editor-tree__folder"
              style={indent}
              aria-expanded={!isCollapsed}
              onClick={() => toggle(node.path)}
            >
              <ChevronDown
                size={14}
                className="skill-editor-tree__chev"
                aria-hidden="true"
              />
              <Folder size={15} aria-hidden="true" />
              <span className="skill-editor-tree__name">{node.name}</span>
            </button>
            {!isCollapsed && (
              <div className="skill-editor-tree__children">
                {renderNodes(node.children, depth + 1)}
              </div>
            )}
          </div>
        );
      }
      const isActive = node.path === activePath;
      const deletable = onDelete && !PROTECTED_PATHS.has(node.path) && !node.readonly;
      return (
        <div
          key={node.path}
          className={
            isActive
              ? "skill-editor-tree__row skill-editor-tree__file is-active"
              : "skill-editor-tree__row skill-editor-tree__file"
          }
          style={indent}
          role="button"
          tabIndex={0}
          onClick={() => onSelect(node.path)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect(node.path);
            }
          }}
          title={node.path}
        >
          {node.readonly ? (
            <Lock size={14} aria-hidden="true" />
          ) : (
            <File size={14} aria-hidden="true" />
          )}
          <span className="skill-editor-tree__name">{node.name}</span>
          {deletable && (
            <button
              type="button"
              className="skill-editor-tree__delete"
              aria-label={t("skillMarket.editor.deleteFile", {
                values: { name: node.name },
              })}
              title={t("skillMarket.editor.deleteFile", {
                values: { name: node.name },
              })}
              onClick={(e) => {
                e.stopPropagation();
                onDelete?.(node.path);
              }}
            >
              <Trash2 size={13} aria-hidden="true" />
            </button>
          )}
        </div>
      );
    });

  return <div className="skill-editor-tree">{renderNodes(tree, 0)}</div>;
}
