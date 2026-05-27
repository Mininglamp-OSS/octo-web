import React from 'react';
import { useI18n } from '@octo/base';
import type { MatterStatus } from '../../bridge/types';
import './index.css';

export interface MatterStatusBadgeProps {
  status: MatterStatus;
  className?: string;
}

const STATUS_LABELS: Record<MatterStatus, string> = {
  open: 'todo.status.pending',
  done: 'todo.status.done',
  archived: 'todo.status.archived',
};

export default function MatterStatusBadge({ status, className }: MatterStatusBadgeProps) {
  const { t } = useI18n();
  return (
    <span
      className={`wk-matter-status-badge wk-matter-status-badge--${status}${className ? ` ${className}` : ''}`}
    >
      {t(STATUS_LABELS[status])}
    </span>
  );
}

export { MatterStatusBadge };
