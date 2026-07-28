import React from 'react';
import { ChevronRight } from 'lucide-react';
import './index.css';

export interface Crumb {
  id: number;
  name: string;
}

export interface BreadcrumbProps {
  /** Path from space root to current folder (root included at index 0). */
  path: Crumb[];
  onNavigate: (index: number) => void;
}

/** Folder path trail. The last crumb is the current folder (not clickable). */
export default function Breadcrumb({ path, onNavigate }: BreadcrumbProps) {
  return (
    <nav className="drive-breadcrumb" aria-label="breadcrumb">
      {path.map((crumb, i) => {
        const isLast = i === path.length - 1;
        return (
          <React.Fragment key={`${crumb.id}-${i}`}>
            {i > 0 && <ChevronRight size={14} className="drive-breadcrumb__sep" />}
            {isLast ? (
              <span className="drive-breadcrumb__current" title={crumb.name}>
                {crumb.name}
              </span>
            ) : (
              <button
                type="button"
                className="drive-breadcrumb__link"
                onClick={() => onNavigate(i)}
                title={crumb.name}
              >
                {crumb.name}
              </button>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
