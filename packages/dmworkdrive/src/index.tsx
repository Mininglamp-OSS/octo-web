// @octo/drive — network drive module for dmwork web

// Module
export { default as DriveModule } from './module';

// Landing pages + path helpers — the host Layout intercepts the share/invite
// deep-link shapes pre-login (share renders anonymously; invite bounces through
// login and back), mirroring how it handles the standalone `/d/:docId` link.
export { default as ShareLandingPage } from './pages/ShareLandingPage';
export { default as InviteLandingPage } from './pages/InviteLandingPage';
export {
  shareTokenFromPath,
  inviteTokenFromPath,
  isDriveSharePath,
  isDriveInvitePath,
} from './utils/links';

// Types
export * from './bridge/types';

// API
export * as driveApi from './api/driveApi';
export { DriveApiError, assertSafePresignedURL, putToPresignedUrl } from './api/driveApi';
