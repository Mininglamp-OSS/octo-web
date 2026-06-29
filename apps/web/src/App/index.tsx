import { ChatPage, EndpointCategory, WKApp, Menus, shouldSkipChannelForSpace, shouldSkipPersonConversationForSpace, RuntimesPage, t } from '@octo/base';
import { ContactsList } from '@octo/contacts';
import React, { useEffect } from 'react';
// lucide icons replaced with filled SVGs per Figma
import './index.css';
import AppLayout from '../Layout';
import { WKSDK, ChannelTypePerson } from 'wukongimjssdk';
import { setFaviconBadge, clearFaviconBadge } from '../utils/faviconBadge';
import { ChatIcon } from '../Components/Icons/ChatIcon';
import { ContactsIcon } from '../Components/Icons/ContactsIcon';
import { RuntimesIcon } from '../Components/Icons/RuntimesIcon';
import { SummaryIcon } from '../Components/Icons/SummaryIcon';
import { Toast } from '@douyinfe/semi-ui';
import { clearDeprecatedFriendApplyReddotOnce } from './friendApplyReddotCleanup';

let _summaryBadgeCount = 0;
let _badgeListenerSetup = false;

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
  registerMenus()
  return (
    <AppLayout />
  );
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

let _menusRegistered = false
async function registerMenus() {
  if (_menusRegistered) return
  _menusRegistered = true

  WKSDK.shared().conversationManager.addConversationListener(() => {
    WKApp.menus.refresh()
  })

  WKApp.endpointManager.setMethod("menus.friendapply.change", () => {
    WKApp.menus.refresh()
  }, {
    category: EndpointCategory.friendApplyDataChange,
  })

  // Listen for summary badge count updates (emitted from dmworksummary)
  if (!_badgeListenerSetup) {
    _badgeListenerSetup = true;
    WKApp.mittBus.on("summary-badge-update" as any, (payload: { count: number }) => {
      _summaryBadgeCount = payload?.count ?? 0;
      WKApp.menus.refresh();
    });
  }

  WKApp.menus.register("chat", (_context) => {
    const m = new Menus("chat", "/", t("app.nav.chat"), <ChatIcon />, <ChatIcon />)
    let badge = 0;

    for (const conversation of WKSDK.shared().conversationManager.conversations) {
      const channelInfo = WKSDK.shared().channelManager.getChannelInfo(conversation.channel)
      if (channelInfo?.mute) {
        continue
      }
      // Space 过滤：复用 shouldSkipChannelForSpace 完整逻辑（含 channelSpaceMap 缓存）
      if (shouldSkipChannelForSpace(conversation.channel)) {
        continue
      }
      if (shouldSkipPersonConversationForSpace(conversation)) continue
      // Person 频道在 Space 模式下优先使用 per-Space 未读计数
      const currentSpaceId = WKApp.shared.currentSpaceId
      if (currentSpaceId
          && conversation.channel.channelType === ChannelTypePerson
          && conversation.extra?.spaceUnread !== undefined) {
        badge += conversation.extra.spaceUnread
      } else {
        badge += conversation.unread
      }
    }

    // badge 和 favicon 角标已下线
    clearFaviconBadge()

    if ((window as any).__POWERED_ELECTRON__) {
      (window as any).ipc.send("conversation-anager-unread-count", badge);
    }

    return m
  }, 1000)

  WKApp.menus.register("contacts", (param) => {
    const m = new Menus("contacts", "/contacts", t("app.nav.contacts"), <ContactsIcon />, <ContactsIcon />)
    return m
  }, 4000)

  // PR-2 (准备上线): 运行时菜单常驻显示, 不再 conditional. 之前的
  // hasRuntimes / checkRuntimes / 15s polling / mittBus 订阅已删 — 用户
  // 进 /runtimes 页面后通过顶部 + 创建 Runtime 拿命令自助启 daemon-cli;
  // 不再依赖"先有 daemon 才看见菜单"那条 chicken-and-egg 链.
  WKApp.menus.register("runtimes", () => {
    return new Menus("runtimes", "/runtimes", t("app.nav.runtimes"), <RuntimesIcon />, <RuntimesIcon />)
  }, 7000)

  WKApp.menus.register("summary", (_context) => {
    const m = new Menus("summary", "/summary", t("app.nav.summary"), <SummaryIcon />, <SummaryIcon />)
    if (_summaryBadgeCount > 0) {
      m.badge = _summaryBadgeCount;
    }
    m.onPress = () => {
      WKApp.routeLeft.popToRoot()
      const page = WKApp.route.get("/summary/create")
      if (page && React.isValidElement(page)) {
        WKApp.routeRight.replaceToRoot(page)
      }
    }
    return m
  }, 6000)

  WKApp.route.register("/", () => {
    return <ChatPage></ChatPage>
  })

  WKApp.route.register("/contacts", () => {
    return <ContactsList></ContactsList>
  })

  WKApp.route.register("/runtimes", () => {
    return <RuntimesPage />
  })

}

export default App;
