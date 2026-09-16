import WKApp from "../App";

/** No listeners: field revisions also catch transitions that return to the same value. */
export function captureCurrentImConversationSyncContext(): () => boolean {
  const app = WKApp.shared;
  const login = WKApp.loginInfo;
  const config = WKApp.apiClient.config;
  const spaceRevision = app.spaceRevision;
  const sessionRevision = login.sessionRevision;
  const originRevision = config.originRevision;
  const spaceId = app.currentSpaceId;
  const uid = login.uid;
  const token = login.token;
  const apiURL = config.apiURL;

  return () => (
    WKApp.shared === app &&
    WKApp.loginInfo === login &&
    WKApp.apiClient.config === config &&
    app.spaceRevision === spaceRevision &&
    login.sessionRevision === sessionRevision &&
    config.originRevision === originRevision &&
    app.currentSpaceId === spaceId &&
    login.uid === uid &&
    login.token === token &&
    config.apiURL === apiURL
  );
}
