import React from "react";
import classnames from "classnames";
import { ChevronDown, ChevronRight } from "lucide-react";
import type {
  ContactsDirectoryProps,
  ContactsDirectorySectionProps,
} from "./types";
import "./index.css";

export function ContactsDirectory({ children }: ContactsDirectoryProps) {
  return <>{children}</>;
}

export default ContactsDirectory;

export function ContactsDirectorySection({
  sectionKey,
  expanded,
  icon,
  label,
  count,
  children,
  onToggle,
}: ContactsDirectorySectionProps) {
  return (
    <div
      className={classnames(
        "wk-contacts-accordion",
        expanded && "wk-contacts-accordion--expanded"
      )}
    >
      <div
        className="wk-contacts-accordion-header"
        onClick={() => onToggle(sectionKey)}
      >
        <span className="wk-contacts-accordion-arrow">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
        <span className="wk-contacts-accordion-icon">{icon}</span>
        <span className="wk-contacts-accordion-label">{label}</span>
        {count > 0 && (
          <span className="wk-contacts-accordion-count">({count})</span>
        )}
      </div>
      {expanded && children}
    </div>
  );
}
