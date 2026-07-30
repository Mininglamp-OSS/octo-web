import React from 'react';
import { useI18n } from '@octo/base';
import { Button, Spin } from '@douyinfe/semi-ui';
import { User, Users, Plus } from 'lucide-react';
import type { Space } from '../../bridge/types';
import { spaceDisplayName } from '../../utils/spaceName';
import './index.css';

export interface SpaceSidebarProps {
  personalSpace: Space | null;
  sharedSpaces: Space[];
  activeSpaceId: string | null;
  loading: boolean;
  onSelect: (spaceId: string) => void;
  onCreateShared: () => void;
}

/** Left rail: personal space + shared spaces, with a create-shared entry. */
export default function SpaceSidebar({
  personalSpace,
  sharedSpaces,
  activeSpaceId,
  loading,
  onSelect,
  onCreateShared,
}: SpaceSidebarProps) {
  const { t } = useI18n();

  const renderItem = (space: Space, icon: React.ReactNode) => {
    const name = spaceDisplayName(space, t);
    return (
      <button
        key={space.id}
        type="button"
        className={`drive-space-item${space.id === activeSpaceId ? ' drive-space-item--active' : ''}`}
        onClick={() => onSelect(space.id)}
        title={name}
      >
        <span className="drive-space-item__icon">{icon}</span>
        <span className="drive-space-item__name">{name}</span>
      </button>
    );
  };

  return (
    <aside className="drive-sidebar">
      <div className="drive-sidebar__group">
        {personalSpace && renderItem(personalSpace, <User size={16} />)}
      </div>

      <div className="drive-sidebar__group">
        <div className="drive-sidebar__label">
          <span>{t('drive.space.shared')}</span>
          <Button
            theme="borderless"
            type="tertiary"
            size="small"
            icon={<Plus size={14} />}
            aria-label={t('drive.space.create')}
            onClick={onCreateShared}
          />
        </div>
        {sharedSpaces.map((s) => renderItem(s, <Users size={16} />))}
        {!loading && sharedSpaces.length === 0 && (
          <div className="drive-sidebar__empty">{t('drive.space.noShared')}</div>
        )}
      </div>

      {loading && (
        <div className="drive-sidebar__loading">
          <Spin size="small" />
        </div>
      )}
    </aside>
  );
}
