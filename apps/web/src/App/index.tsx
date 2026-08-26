import { addImChannelInfoListener, ChatPage, EndpointCategory, WKApp, Menus, t, isElectronPowered, sendElectronConversationUnreadCount } from '@octo/base';
import { ContactsList } from '@octo/contacts';
import React, { useEffect } from 'react';
// lucide icons replaced with filled SVGs per Figma
import './index.css';
import AppLayout from '../Layout';
import { WKSDK } from 'wukongimjssdk';
import { ChatIcon } from '../Components/Icons/ChatIcon';
import { ContactsIcon } from '../Components/Icons/ContactsIcon';
import { Toast } from '@douyinfe/semi-ui';
import { clearDeprecatedFriendApplyReddotOnce } from './friendApplyReddotCleanup';
import { createOctoDocumentTitleController } from '../features/documentTitle/octoDocumentTitle';
import { getElectronUnreadMessageCount } from './electronUnreadCount';

/**
 * 全局 ?verified=1 处理：CAS 实名认证完成后 verify-service 会 302 回
 * `${origin}${pathname}?verified=1`。不论落到 App 哪个路径都应该：
 *   1. 弹「实名认证已完成」 toast，防止用户疑惑白屏/重弹登录。
 *   2. 清除 URL 里的 verified=1 参数（可能有多个，例如上游 double-append 历史 bug）。
 *   3. 触发 MeInfo 俧的 reloadSelfProfile 同步新实名状态。
 */
function useRealnameVerifiedLandingHandler() {
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.getAll('verified').some((v) => v === '1')) {
        // 在 login 模块和 SDK 初始化稳定后弹提示（延迟一帧避免 toast 被 early render 吃掉）
        requestAnimationFrame(() => {
          Toast.success(t("app.toast.realnameVerified"));
        });
        // 移除所有 verified 参数（背上游 double-append 历史 bug 经过后真的可能有两个）
        params.delete('verified');
        const rest = params.toString();
        const clean = window.location.pathname
          + (rest ? '?' + rest : '')
          + window.location.hash;
        window.history.replaceState(null, '', clean);
      }
    } catch (e) {
      // URL API 在 SSR / 非浏览器环境下可能不可用——静默忽略不阻塞渲染。
    }
  }, []);
}

function App() {
  useRealnameVerifiedLandingHandler()
  useDeprecatedFriendApplyReddotCleanup()
  useOctoDocumentTitle()
  registerMenus()
  return (
    <AppLayout />
  );
}

function useOctoDocumentTitle() {
  useEffect(() => {
    const controller = createOctoDocumentTitleController()
    controller.start()
    return () => controller.stop()
  }, [])
}

function useDeprecatedFriendApplyReddotCleanup() {
  const isLogined = WKApp.loginInfo.isLogined()
  const uid = WKApp.loginInfo.uid

  useEffect(() => {
    if (!isLogined || !uid) {
      return
    }
    void clearDeprecatedFriendApplyReddotOnce({
      isLoggedIn: () => WKApp.loginInfo.isLogined(),
      getUid: () => WKApp.loginInfo.uid,
      clearReddot: () => WKApp.apiClient.delete(`/user/reddot/friendApply`),
      emitUnreadCount: (count) => {
        WKApp.mittBus.emit('friend-applys-unread-count', count)
      },
      setUnreadCount: (currentUid, count) => {
        WKApp.loginInfo.setStorageItem(`${currentUid}-friend-applys-unread-count`, count)
      },
      refreshMenus: () => {
        WKApp.menus.refresh()
      },
      warn: (message, error) => {
        console.warn(message, error)
      },
    })
  }, [isLogined, uid])
}

function syncElectronUnreadMessageCount() {
  if (isElectronPowered()) {
    sendElectronConversationUnreadCount(getElectronUnreadMessageCount())
  }
}

let _menusRegistered = false
async function registerMenus() {
  if (_menusRegistered) return
  _menusRegistered = true

  WKSDK.shared().conversationManager.addConversationListener(() => {
    WKApp.menus.refresh()
    syncElectronUnreadMessageCount()
  })
  addImChannelInfoListener(WKSDK.shared(), syncElectronUnreadMessageCount)
  WKApp.mittBus.on("conversation-list-refreshed", syncElectronUnreadMessageCount)

  // The conversation list can be restored after registration; the listener
  // above will send the subsequent snapshot in that case.
  syncElectronUnreadMessageCount()

  WKApp.endpointManager.setMethod("menus.friendapply.change", () => {
    WKApp.menus.refresh()
  }, {
    category: EndpointCategory.friendApplyDataChange,
  })

  WKApp.menus.register("chat", (_context) => {
    const m = new Menus("chat", "/", t("app.nav.chat"), <ChatIcon />, <ChatIcon />)

    return m
  }, 1000)

  WKApp.menus.register("contacts", (param) => {
    const m = new Menus("contacts", "/contacts", t("app.nav.contacts"), <ContactsIcon />, <ContactsIcon />)
    return m
  }, 4000)

  WKApp.route.register("/", () => {
    return <ChatPage></ChatPage>
  })

  WKApp.route.register("/contacts", () => {
    return <ContactsList></ContactsList>
  })

}

export default App;
