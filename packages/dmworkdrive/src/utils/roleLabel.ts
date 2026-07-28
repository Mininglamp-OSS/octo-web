import type { DriveRole } from '../bridge/types';

/** Drive role → i18n label key. Shared by the member roster and the org picker
 *  so both render role names identically (SSOT for the role→label mapping). */
export const ROLE_LABEL_KEY: Record<DriveRole, string> = {
  super_admin: 'drive.member.roleSuperAdmin',
  admin: 'drive.member.roleAdmin',
  editor: 'drive.member.roleEditor',
  uploader_downloader: 'drive.member.roleUploaderDownloader',
  downloader: 'drive.member.roleDownloader',
  preview_only: 'drive.member.rolePreview',
  custom: 'drive.member.roleCustom',
};

/** Drive role → privilege rank (higher = more privileged). Mirrors the backend
 *  `space.RoleRank` (octo-drive) verbatim — the SSOT for client-side permission
 *  gating so button visibility matches what the server would authorize. */
export const ROLE_RANK: Record<DriveRole, number> = {
  super_admin: 100,
  admin: 80,
  editor: 60,
  uploader_downloader: 40,
  downloader: 30,
  preview_only: 20,
  custom: 10,
};
