import React from 'react';
import { useI18n } from '@octo/base';
import { Button, Dropdown, Spin } from '@douyinfe/semi-ui';
import { Folder, FileText, File, MoreHorizontal, Download } from 'lucide-react';
import type { DriveEntry } from '../../bridge/types';
import { formatBytes, formatTime } from '../../utils/format';
import './index.css';

export interface FileListProps {
  entries: DriveEntry[];
  loading: boolean;
  onOpenFolder: (entry: DriveEntry) => void;
  /** Open a Type-1 doc (jump to the docs preview/editor). */
  onOpenDoc: (entry: DriveEntry) => void;
  onRename: (entry: DriveEntry) => void;
  onMove: (entry: DriveEntry) => void;
  onCopy: (entry: DriveEntry) => void;
  onDelete: (entry: DriveEntry) => void;
  /** Create/manage share links for the entry. */
  onShare: (entry: DriveEntry) => void;
  /** Download a Type-2 blob (fetch signed URL + browser download). */
  onDownload: (entry: DriveEntry) => void;
  /** downloader+ — show the inline download action on blobs. */
  canDownload: boolean;
  /** editor+ — show rename/move/copy/delete in the actions dropdown. */
  canEdit: boolean;
  /** downloader+ — show the share action in the dropdown. */
  canShare: boolean;
}

function EntryIcon({ entry }: { entry: DriveEntry }) {
  if (entry.type === 'folder') return <Folder size={18} className="drive-file__icon drive-file__icon--folder" />;
  if (entry.type === 'doc') return <FileText size={18} className="drive-file__icon drive-file__icon--doc" />;
  return <File size={18} className="drive-file__icon drive-file__icon--blob" />;
}

/** Mixed listing of folders, Type-1 docs and Type-2 blobs for one folder. */
export default function FileList({
  entries,
  loading,
  onOpenFolder,
  onOpenDoc,
  onRename,
  onMove,
  onCopy,
  onDelete,
  onShare,
  onDownload,
  canDownload,
  canEdit,
  canShare,
}: FileListProps) {
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="drive-file-list__center">
        <Spin />
      </div>
    );
  }

  if (entries.length === 0) {
    return <div className="drive-file-list__center drive-file-list__empty">{t('drive.file.empty')}</div>;
  }

  return (
    <div className="drive-file-list">
      <div className="drive-file-row drive-file-row--head">
        <span className="drive-file__name">{t('drive.file.colName')}</span>
        <span className="drive-file__size">{t('drive.file.colSize')}</span>
        <span className="drive-file__time">{t('drive.file.colUpdated')}</span>
        <span className="drive-file__ops" />
      </div>

      {entries.map((entry) => {
        const isFolder = entry.type === 'folder';
        return (
          <div key={entry.id} className="drive-file-row">
            <span className="drive-file__name">
              <EntryIcon entry={entry} />
              {isFolder ? (
                <button
                  type="button"
                  className="drive-file__name-link"
                  onClick={() => onOpenFolder(entry)}
                  title={entry.name}
                >
                  {entry.name}
                </button>
              ) : entry.type === 'doc' ? (
                <button
                  type="button"
                  className="drive-file__name-link"
                  onClick={() => onOpenDoc(entry)}
                  title={entry.name}
                >
                  {entry.name}
                </button>
              ) : (
                <span className="drive-file__name-text" title={entry.name}>
                  {entry.name}
                </span>
              )}
            </span>
            <span className="drive-file__size">{isFolder ? '—' : formatBytes(entry.size)}</span>
            <span className="drive-file__time">{formatTime(entry.updated_at)}</span>
            <span className="drive-file__ops">
              {entry.type === 'blob' && canDownload && (
                <Button
                  theme="borderless"
                  type="tertiary"
                  size="small"
                  icon={<Download size={16} />}
                  aria-label={t('drive.file.download')}
                  onClick={() => onDownload(entry)}
                />
              )}
              {(canEdit || canShare) && (
                <Dropdown
                  trigger="click"
                  position="bottomRight"
                  render={
                    <Dropdown.Menu>
                      {canEdit && <Dropdown.Item onClick={() => onRename(entry)}>{t('drive.file.rename')}</Dropdown.Item>}
                      {canEdit && <Dropdown.Item onClick={() => onMove(entry)}>{t('drive.file.move')}</Dropdown.Item>}
                      {canEdit && <Dropdown.Item onClick={() => onCopy(entry)}>{t('drive.file.copy')}</Dropdown.Item>}
                      {canShare && <Dropdown.Item onClick={() => onShare(entry)}>{t('drive.file.share')}</Dropdown.Item>}
                      {canEdit && <Dropdown.Divider />}
                      {canEdit && (
                        <Dropdown.Item type="danger" onClick={() => onDelete(entry)}>
                          {t('drive.file.delete')}
                        </Dropdown.Item>
                      )}
                    </Dropdown.Menu>
                  }
                >
                  <Button
                    theme="borderless"
                    type="tertiary"
                    size="small"
                    icon={<MoreHorizontal size={16} />}
                    aria-label={t('drive.file.actions')}
                  />
                </Dropdown>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
