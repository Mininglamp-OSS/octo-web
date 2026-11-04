import React from "react"
import { Archive, ChevronRight } from "lucide-react"
import "./index.css"
export interface FoldedChatsEntryProps {
 title: string; mentionLabel: string; unread: number; hasUnread: boolean; mention: boolean; onClick: () => void
}
export default function FoldedChatsEntry(p: FoldedChatsEntryProps) {
 return <button type="button" className="wk-folded-entry" onClick={p.onClick}>
  <span className="wk-folded-entry-icon" aria-hidden="true"><Archive size={20} /></span><span className="wk-folded-entry-title">{p.title}</span>
  {p.mention && <span className="wk-folded-mention">{p.mentionLabel}</span>}
  {p.unread > 0 ? <span className="wk-folded-badge">{p.unread > 99 ? "99+" : p.unread}</span> : p.hasUnread ? <span className="wk-folded-dot" /> : null}
  <ChevronRight size={16} aria-hidden="true" />
 </button>
}
