import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Button } from '@douyinfe/semi-ui';
import { FolderPlus, FilePlus2, UserPlus, Users } from 'lucide-react';
import Breadcrumb from '../ui/Breadcrumb';
import SpaceSidebar from '../ui/SpaceSidebar';
import FileList from '../ui/FileList';
import UploadButton from '../ui/UploadButton';
import type { DriveEntry, Space } from '../bridge/types';
import '../pages/DrivePage.css';

/**
 * Whole-page Drive chrome — space rail, breadcrumb, toolbar and file list in one
 * frame.
 *
 * The per-component stories cover each part in isolation, but two of the visual
 * states this module owns only exist across parts: the brand keyboard focus ring
 * (rows, rail items, breadcrumb links and the header actions all share one
 * treatment) and the dark-mode CTA. The toolbar in particular has no story of its
 * own, because in the app it lives inside DriveContent behind a VM and live API
 * hooks.
 *
 * The header below therefore mirrors `DriveContent`'s action row rather than
 * rendering DriveContent itself: same wrapper classes, same real `UploadButton`,
 * same `drive-btn` Semi buttons. Keep it in sync if that markup changes.
 *
 * Focus states need real keyboard input — `:focus-visible` keys off the browser's
 * keyboard modality, which synthetic events don't set — so press Tab to walk the
 * ring rather than expecting a play function to stage it.
 */

function space(id: string, name: string, type: Space['type']): Space {
  return {
    id,
    type,
    name,
    super_admin_uid: 'u1',
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
  };
}

function entry(over: Partial<DriveEntry> & Pick<DriveEntry, 'id' | 'name' | 'type'>): DriveEntry {
  return {
    space_id: 's1',
    parent_id: 0,
    is_folder: over.type === 'folder',
    size: 0,
    source: 'user-upload',
    owner_uid: 'u1',
    created_at: '2026-07-20T09:00:00.000Z',
    updated_at: '2026-07-22T14:30:00.000Z',
    ...over,
  };
}

const personalSpace = space('p1', '个人空间', 'personal');
const sharedSpaces = [space('s1', '产品设计', 'shared'), space('s2', '市场活动', 'shared')];

const entries: DriveEntry[] = [
  entry({ id: 1, name: 'Design assets', type: 'folder' }),
  entry({ id: 2, name: 'Product spec', type: 'doc', source: 'user-mount', ref_id: 'doc-abc' }),
  entry({ id: 3, name: 'quarterly-report.pdf', type: 'blob', size: 2_483_910, content_type: 'application/pdf' }),
  entry({ id: 4, name: 'logo.png', type: 'blob', size: 91_233, content_type: 'image/png' }),
];

const path = [
  { id: 0, name: '我的空间' },
  { id: 10, name: 'Design assets' },
];

const noop = () => {};

function DriveChrome() {
  return (
    <div className="drive-page">
      <div className="drive-sidebar-pane" style={{ width: 240, flex: '0 0 240px' }}>
        <SpaceSidebar
          personalSpace={personalSpace}
          sharedSpaces={sharedSpaces}
          activeSpaceId="s1"
          loading={false}
          onSelect={noop}
          onCreateShared={noop}
        />
      </div>

      <main className="drive-main">
        <div className="drive-main__header">
          <Breadcrumb path={path} onNavigate={noop} />
          <div className="drive-main__actions">
            <UploadButton onFiles={noop} />
            <Button className="drive-btn" icon={<FolderPlus size={16} />} onClick={noop}>
              新建文件夹
            </Button>
            <Button className="drive-btn" icon={<FilePlus2 size={16} />} onClick={noop}>
              挂载文档
            </Button>
            <Button className="drive-btn" icon={<UserPlus size={16} />} onClick={noop}>
              邀请
            </Button>
            <Button className="drive-btn" icon={<Users size={16} />} onClick={noop}>
              成员
            </Button>
          </div>
        </div>

        <div className="drive-main__body">
          <FileList
            entries={entries}
            loading={false}
            onOpenFolder={noop}
            onOpenDoc={noop}
            onRename={noop}
            onMove={noop}
            onCopy={noop}
            onDelete={noop}
            onShare={noop}
            onDownload={noop}
            canDownload
            canEdit
            canShare
          />
        </div>
      </main>
    </div>
  );
}

const meta: Meta<typeof DriveChrome> = {
  title: 'Drive/Chrome',
  component: DriveChrome,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div style={{ height: 520, display: 'flex' }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof DriveChrome>;

/**
 * Keyboard focus fixture. Tab from the top: rail items, then the breadcrumb
 * ancestor link, then the five header actions, then each file row's name and its
 * action buttons. Every stop should draw the same 2px `--wk-text-accent` ring;
 * file rows additionally take docs' selected tint and a 600 title. Clicking with
 * the mouse must leave no ring behind.
 */
export const Focused: Story = {};

/**
 * Dark mode. Checks the documented CTA deviation (the upload pill switches to
 * the inverse pairing so it stays visible against `--wk-bg-base`) and that the
 * focus ring stays legible on the dark page.
 */
export const Dark: Story = {
  globals: { theme: 'dark' },
};
