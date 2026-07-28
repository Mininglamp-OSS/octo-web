import React, { useEffect, useState } from 'react';
import { useI18n } from '@octo/base';
import SpaceSidebar from '../ui/SpaceSidebar';
import NameInputModal from '../ui/NameInputModal';
import { Toast } from '../utils/toast';
import { DriveVM, useDriveVM } from './DriveVM';
import './DrivePage.css';

/**
 * Left-pane space rail (WKLayout.contentLeft). Renders the space list from the
 * shared VM and owns the create-shared-space modal (triggered from its own "+"
 * entry). Selecting a space updates the VM, which re-renders the right pane;
 * this component itself stays mounted so the sidebar never flickers.
 *
 * On mount it also ensures the file view is mounted into the right pane via
 * `onActivate` — the menu's onPress covers user clicks, but a cold-load /
 * refresh of `/drive` activates the route without firing onPress, so the rail
 * self-mounts the content pane (mirrors MarketSidebar.componentDidMount).
 */
export default function DriveSidebar({
  vm,
  onActivate,
}: {
  vm: DriveVM;
  onActivate?: () => void;
}) {
  useDriveVM(vm);
  const { t } = useI18n();
  const [spaceModalOpen, setSpaceModalOpen] = useState(false);

  useEffect(() => {
    onActivate?.();
  }, [onActivate]);

  return (
    <div className="drive-sidebar-pane">
      <SpaceSidebar
        personalSpace={vm.personalSpace}
        sharedSpaces={vm.sharedSpaces}
        activeSpaceId={vm.activeSpaceId}
        loading={vm.spacesLoading}
        onSelect={(id) => vm.selectSpace(id)}
        onCreateShared={() => setSpaceModalOpen(true)}
      />

      <NameInputModal
        visible={spaceModalOpen}
        title={t('drive.space.createTitle')}
        placeholder={t('drive.space.namePlaceholder')}
        onClose={() => setSpaceModalOpen(false)}
        onSubmit={async (name) => {
          try {
            const space = await vm.createShared(name);
            Toast.success(t('drive.toast.created'));
            vm.selectSpace(space.id);
            return true;
          } catch (err: unknown) {
            Toast.error((err as Error)?.message || t('drive.toast.opFailed'));
            return false;
          }
        }}
      />
    </div>
  );
}
