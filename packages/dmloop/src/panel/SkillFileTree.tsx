import React, { useState } from "react";
import {
  ChevronRight, ChevronDown, FileText, File, Folder, FolderOpen,
} from "lucide-react";

const SKILL_MD = "SKILL.md";

interface FileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children: FileTreeNode[];
}

function buildTree(filePaths: string[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  for (const filePath of filePaths) {
    const parts = filePath.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]!;
      const isLast = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join("/");
      let existing = current.find((n) => n.name === name);
      if (!existing) {
        existing = { name, path, isDirectory: !isLast, children: [] };
        current.push(existing);
      }
      if (!isLast) current = existing.children;
    }
  }
  function sortNodes(nodes: FileTreeNode[]): FileTreeNode[] {
    nodes.sort((a, b) => {
      if (a.path === SKILL_MD) return -1;
      if (b.path === SKILL_MD) return 1;
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) if (node.isDirectory) sortNodes(node.children);
    return nodes;
  }
  return sortNodes(root);
}

function getFileIcon(name: string) {
  if (name.endsWith(".md") || name.endsWith(".mdx")) return FileText;
  return File;
}

function TreeNodeItem({
  node, selectedPath, onSelect, depth = 0,
}: {
  node: FileTreeNode;
  selectedPath: string;
  onSelect: (path: string) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const isSelected = node.path === selectedPath;

  if (node.isDirectory) {
    const FolderIcon = expanded ? FolderOpen : Folder;
    const ChevronIcon = expanded ? ChevronDown : ChevronRight;
    return (
      <div>
        <button
          type="button"
          className="loop-ftree__row"
          onClick={() => setExpanded(!expanded)}
          style={{ paddingLeft: depth * 12 + 8 }}
        >
          <ChevronIcon size={12} className="loop-ftree__chev" />
          <FolderIcon size={14} className="loop-ftree__icon" />
          <span className="loop-ftree__name">{node.name}</span>
        </button>
        {expanded && node.children.map((child) => (
          <TreeNodeItem key={child.path} node={child} selectedPath={selectedPath} onSelect={onSelect} depth={depth + 1} />
        ))}
      </div>
    );
  }

  const Icon = getFileIcon(node.name);
  return (
    <button
      type="button"
      className={`loop-ftree__row loop-ftree__file${isSelected ? " is-selected" : ""}`}
      onClick={() => onSelect(node.path)}
      style={{ paddingLeft: depth * 12 + 8 + 16 }}
    >
      <Icon size={14} className="loop-ftree__icon" />
      <span className="loop-ftree__name">{node.name}</span>
    </button>
  );
}

export default function SkillFileTree({
  filePaths, selectedPath, onSelect, emptyText,
}: {
  filePaths: string[];
  selectedPath: string;
  onSelect: (path: string) => void;
  emptyText: string;
}) {
  const tree = buildTree(filePaths);
  if (tree.length === 0) {
    return (
      <div className="loop-ftree__empty">
        <FolderOpen size={20} />
        <p>{emptyText}</p>
      </div>
    );
  }
  return (
    <div className="loop-ftree">
      {tree.map((node) => (
        <TreeNodeItem key={node.path} node={node} selectedPath={selectedPath} onSelect={onSelect} />
      ))}
    </div>
  );
}
