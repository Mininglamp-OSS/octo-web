import { Toast } from "@douyinfe/semi-ui";
import { WKApp, t } from "@octo/base";
import { wkConfirm } from "@octo/base/src/Components/WKModal";

export function createWorkspaceNavigationGuard() {
  let pending: { modal?: ReturnType<typeof wkConfirm> } | undefined;
  const cancel = () => {
    const previous = pending;
    pending = undefined;
    previous?.modal?.destroy();
  };
  return {
    cancel,
    run(proceed: () => void, onCancel?: () => void) {
      cancel();
      const guard = WKApp.shared.pendingAttachmentGuard;
      if (!guard || guard()) {
        proceed();
        return;
      }
      const request: { modal?: ReturnType<typeof wkConfirm> } = {};
      pending = request;
      const finish = (callback?: () => void) => {
        if (pending !== request) return;
        pending = undefined;
        callback?.();
      };
      let confirming = false;
      const discard = WKApp.shared.pendingAttachmentDiscard;
      request.modal = wkConfirm({
        title: t("base.chatPage.unsentAttachmentTitle"),
        content: t("base.chatPage.unsentAttachmentContent"),
        okText: t("base.chatPage.continueSwitch"),
        cancelText: t("base.common.cancel"),
        onOk: async () => {
          if (pending !== request || confirming) return;
          confirming = true;
          request.modal?.update?.({ maskClosable: false, closeOnEsc: false });
          try { await discard?.(); }
          catch { if (pending === request) Toast.error(t("base.messageInput.attachment.draftCleanupFailed")); }
          finally { confirming = false; }
          finish(proceed);
        },
        onCancel: () => { if (!confirming) finish(onCancel); },
      });
    },
  };
}
