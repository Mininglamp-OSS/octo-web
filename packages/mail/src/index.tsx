export { default as MailModule } from "./module";
export { default as MailSidebar } from "./features/MailSidebar";
export { requestMailWorkspaceSwitch } from "./bridge/mailboxContext";
export {
  isMailAuthorizePath,
  MAIL_AUTHORIZATION_RESOLVED_EVENT,
  getMailAuthorizationSessionStorage,
  mailAuthorizeCode,
  mailAuthorizeMailbox,
  mailAuthorizeSpaceId,
  MAIL_AUTHORIZE_PATH,
  resolveMailAuthorizeSearch,
} from "./authorizationSession";
