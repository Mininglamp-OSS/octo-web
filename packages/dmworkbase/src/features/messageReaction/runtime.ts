import { Toast } from "@douyinfe/semi-ui";

import WKApp from "../../App";
import { t } from "../../i18n";
import MessageReactionService from "../../Service/MessageReactionService";
import { canWriteMessageReaction } from "../../Service/featureFlags";
import {
  createMessageReactionController,
  MESSAGE_REACTION_UPDATED_EVENT,
} from "./controller";

export const messageReactionController = createMessageReactionController({
  toggle: (request) => MessageReactionService.toggle(request),
  currentUser: () => {
    const uid = WKApp.loginInfo.uid;
    if (!uid) return undefined;
    return {
      uid,
      name: WKApp.loginInfo.selfDisplayName?.() || WKApp.loginInfo.name || uid,
    };
  },
  emitUpdated: (messageId) => {
    WKApp.mittBus.emit(MESSAGE_REACTION_UPDATED_EVENT, messageId);
  },
  showError: (key) => {
    Toast.error(t(key));
  },
  canWrite: canWriteMessageReaction,
});
