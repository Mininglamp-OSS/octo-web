import React, { useEffect, useRef, useState } from "react";
import { Toast } from "@douyinfe/semi-ui";
import { getPinyin, WKApp } from "@octo/base";
import type { Workspace } from "../api/types";
import { invalidateRuntimeMap, invalidateAgentStatus } from "../api/agentApi";
import { invalidateDirectory } from "../api/directory";
import { currentWorkspaceId, setWorkspaceContext } from "../api/http";
import { resolveIssueByIdentifier } from "../api/issueApi";
import { createWorkspace, listWorkspaces } from "../api/workspaceApi";
import {
  consumePendingLoopIssueDeepLink,
  readPendingLoopIssueDeepLink,
  replaceFleetIssueDeepLink,
  replaceLoopRootPath,
} from "../issueDeepLink";
import { slugSuffix, withRandomSuffix } from "../ui/slug";
import type {
  LoopIssueDetailRenderHelpers,
  LoopTabKey,
  LoopWorkspaceRenderHelpers,
} from "./types";

export interface UseLoopWorkspaceOptions {
  t: (key: string) => string;
  renderTab: (
    key: LoopTabKey,
    workspace: Workspace | null,
    helpers: LoopWorkspaceRenderHelpers
  ) => JSX.Element;
  renderIssueDetail: (
    issueId: string,
    helpers: LoopIssueDetailRenderHelpers
  ) => JSX.Element;
  renderEmptyGuide: () => JSX.Element;
}

export interface UseLoopWorkspaceResult {
  tab: LoopTabKey;
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
  hasWorkspace: boolean;
  loaded: boolean;
  wsModalOpen: boolean;
  wsName: string;
  wsSlug: string;
  wsBusy: boolean;
  createOpen: boolean;
  openTab: (key: LoopTabKey) => void;
  openNewLoop: () => void;
  switchWorkspace: (workspace: Workspace) => void;
  openCreateWorkspace: () => void;
  closeCreateWorkspace: () => void;
  submitCreateWorkspace: () => Promise<void>;
  changeWorkspaceName: (name: string) => void;
  changeWorkspaceSlug: (slug: string) => void;
  closeCreateIssue: () => void;
  handleIssueCreated: () => void;
}

// 切换工作区时统一重置所有工作区级缓存(目录/运行时/agent 状态),避免残留上个工作区数据。
function resetWorkspaceCaches() {
  invalidateDirectory();
  invalidateRuntimeMap();
  invalidateAgentStatus();
}

function findWorkspace(list: Workspace[], id: string) {
  return list.find((w) => w.id === id) ?? null;
}

export function useLoopWorkspace({
  t,
  renderTab,
  renderIssueDetail,
  renderEmptyGuide,
}: UseLoopWorkspaceOptions): UseLoopWorkspaceResult {
  const [tab, setTab] = useState<LoopTabKey>("issue");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [wsId, setWsId] = useState<string>(currentWorkspaceId());
  const [loaded, setLoaded] = useState(false);
  const [wsModalOpen, setWsModalOpen] = useState(false);
  const [wsName, setWsName] = useState("");
  const [wsSlug, setWsSlug] = useState("");
  const [wsSlugTouched, setWsSlugTouched] = useState(false);
  const [wsSlugSuffix, setWsSlugSuffix] = useState("");
  const [wsBusy, setWsBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  // tab 的同步镜像:mount-once 的 space-changed 副作用闭包(deps=[])会冻结当时的 tab,
  // 用 ref 让 applyWorkspace 始终读到最新 tab,避免切 space 后右栏恒被铺成初始 issue。
  const tabRef = useRef<LoopTabKey>("issue");
  tabRef.current = tab;
  // space-changed 重解析的过期守卫:快速连切 space 时并发的 listWorkspaces 可能乱序返回,
  // 只有最后一次解析允许写回 workspace context,否则慢的旧响应会把旧 slug 落回、撞新 space 的 403。
  const spaceResolveSeqRef = useRef(0);
  // Set when a space change arrives while LoopPage is backgrounded (its
  // space-changed handler is gated to the active menu). On reactivation the
  // nav-menu-activated handler consumes it to force a fresh re-resolve instead
  // of painting the stale old-space workspaces/wsId it still holds in state.
  const pendingSpaceReresolveRef = useRef(false);
  const paneResolveSeqRef = useRef(0);
  const renderTabRef = useRef(renderTab);
  const renderIssueDetailRef = useRef(renderIssueDetail);
  const renderEmptyGuideRef = useRef(renderEmptyGuide);
  const workspacesRef = useRef<Workspace[]>([]);
  renderTabRef.current = renderTab;
  renderIssueDetailRef.current = renderIssueDetail;
  renderEmptyGuideRef.current = renderEmptyGuide;
  workspacesRef.current = workspaces;

  const reloadWorkspaces = async (): Promise<Workspace[]> => {
    const seq = spaceResolveSeqRef.current;
    const list = await listWorkspaces().catch(() => [] as Workspace[]);
    if (seq !== spaceResolveSeqRef.current) return workspacesRef.current;
    setWorkspaces(list);
    return list;
  };

  const renderTabView = (key: LoopTabKey, workspace: Workspace | null) =>
    renderTabRef.current(key, workspace, { reloadWorkspaces });

  const notifyIssueChanged = () => {
    setTimeout(() => WKApp.mittBus.emit("wk:loop-issues-refresh"), 0);
  };

  const canWriteLoopPane = (spaceSeq: number, paneSeq: number) => {
    if (paneSeq !== paneResolveSeqRef.current) return false;
    if (spaceSeq !== spaceResolveSeqRef.current) return false;
    if (WKApp.currentMenuId !== "loop") {
      pendingSpaceReresolveRef.current = true;
      return false;
    }
    return true;
  };

  const openIssueDeepLink = async (
    workspace: Workspace,
    issueIdentifier: string,
    list: Workspace[]
  ) => {
    const spaceSeq = spaceResolveSeqRef.current;
    const paneSeq = paneResolveSeqRef.current;
    setWorkspaceContext(workspace.slug, workspace.id, workspace.name);
    setWsId(workspace.id);
    setTab("issue");
    tabRef.current = "issue";
    resetWorkspaceCaches();
    setWorkspaces(list);
    WKApp.routeRight.replaceToRoot(<div className="loop-page" />);

    const issue = await resolveIssueByIdentifier(issueIdentifier);
    if (!canWriteLoopPane(spaceSeq, paneSeq)) return;
    if (!issue) {
      WKApp.routeRight.replaceToRoot(renderTabView("issue", workspace));
      replaceLoopRootPath();
      return;
    }

    WKApp.routeRight.replaceToRoot(
      renderIssueDetailRef.current(issue.id, {
        reloadWorkspaces,
        onIssueChanged: notifyIssueChanged,
        onClose: () => {
          replaceLoopRootPath();
          WKApp.routeRight.replaceToRoot(renderTabView("issue", workspace));
          return false;
        },
      })
    );
    replaceFleetIssueDeepLink(workspace.slug, issue.identifier);
  };

  const applyPendingIssueDeepLink = (list: Workspace[]): boolean => {
    let pending = null;
    try {
      pending = readPendingLoopIssueDeepLink(window.sessionStorage);
    } catch {
      pending = null;
    }
    if (!pending) return false;
    const workspace = list.find((w) => w.slug === pending.workspaceSlug) ?? null;
    if (!workspace) return false;
    try {
      consumePendingLoopIssueDeepLink(window.sessionStorage);
    } catch {
      // Storage can be unavailable; the in-memory fallback is cleared by consume when possible.
    }
    void openIssueDeepLink(workspace, pending.issueIdentifier, list);
    return true;
  };

  const showEmptyGuide = () => {
    WKApp.routeRight.replaceToRoot(renderEmptyGuideRef.current());
  };

  const applyWorkspace = (workspace: Workspace | null, list: Workspace[]) => {
    if (workspace) {
      setWorkspaceContext(workspace.slug, workspace.id, workspace.name);
      setWsId(workspace.id);
      resetWorkspaceCaches();
      WKApp.routeRight.replaceToRoot(renderTabView(tabRef.current, workspace));
    } else {
      setWorkspaceContext("", "");
      setWsId("");
      showEmptyGuide();
    }
    setWorkspaces(list);
  };

  const openTab = (key: LoopTabKey) => {
    // 重解析窗口期(切 space 后 loaded=false 直到新 space 的 workspace 解析完成)不响应:
    // 此时 workspaces/wsId 尚属旧 space,点击会用旧作用域渲染 workspace 级页面。
    if (!loaded) return;
    // User navigation wins over any pending deep-link resolve.
    paneResolveSeqRef.current += 1;
    replaceLoopRootPath();
    setTab(key);
    WKApp.routeRight.replaceToRoot(renderTabView(key, findWorkspace(workspaces, wsId)));
  };

  // 新建回路 → 唤起统一建单弹窗（对齐 multica，不再拉起独立 AI 页）。成功后落回路看板并刷新。
  const openNewLoop = () => {
    if (!loaded) return;
    setCreateOpen(true);
  };

  // Re-resolve the workspace scope for the current octo space: clear the old
  // scope, unmount the stale right pane, re-list, and repaint. Shared by the
  // space-changed handler (when LoopPage is active) and by reactivation
  // (nav-menu-activated) when a space change happened while it was backgrounded.
  const reResolveSpace = () => {
    const seq = ++spaceResolveSeqRef.current;
    setWorkspaceContext("", "");
    setWsId("");
    // Close any open create modals so a submit cannot land during the
    // re-resolve window and write a workspace under the wrong space.
    setWsModalOpen(false);
    setCreateOpen(false);
    // setLoaded(false): mark not-ready for the re-resolve window so the
    // wk:nav-menu-activated `if (!loaded) return` guard holds and no entry uses
    // the old space's workspaces closure.
    setLoaded(false);
    resetWorkspaceCaches();
    // Unmount the stale right pane immediately so the previous space's IssuePage
    // (and its polling / create entry) stops firing during the re-resolve window.
    WKApp.routeRight.replaceToRoot(<div className="loop-page" />);
    listWorkspaces()
      .then((list) => {
        // Out-of-order guard: only the latest resolve applies, dropping a stale
        // response that would write the old slug back and hit the new space's 403.
        if (seq !== spaceResolveSeqRef.current) return;
        // If the user navigated away while this resolve was in flight, do NOT
        // write the shared pane/context (would clobber the now-active page).
        // Defer to reactivation instead.
        if (WKApp.currentMenuId !== "loop") {
          pendingSpaceReresolveRef.current = true;
          return;
        }
        setLoaded(true);
        if (applyPendingIssueDeepLink(list)) return;
        const first = findWorkspace(list, currentWorkspaceId()) ?? list[0] ?? null;
        applyWorkspace(first, list);
      })
      .catch(() => {
        if (seq !== spaceResolveSeqRef.current) return;
        if (WKApp.currentMenuId !== "loop") {
          pendingSpaceReresolveRef.current = true;
          return;
        }
        setLoaded(true);
        // Clear the stale old-space list on a failed re-resolve — otherwise the
        // switcher dropdown keeps the previous space's workspaces, re-enabled by
        // setLoaded(true) and clickable, so switchWorkspace would bind an
        // old-space slug under the new space's X-Space-Id → cross-space 403.
        setWorkspaces([]);
        showEmptyGuide();
      });
  };

  useEffect(() => {
    // mount 初始解析也纳入 spaceResolveSeqRef 域:若初始 listWorkspaces 尚未返回、
    // 用户就切了 space,space-changed 会递增 seq 使这次 mount 响应过期被丢弃,避免旧 space
    // 的 workspace slug 被写回 http 层、撞新 space 的隔离 403(与 space-changed 共享守卫)。
    const seq = ++spaceResolveSeqRef.current;
    listWorkspaces()
      .then((list) => {
        if (seq !== spaceResolveSeqRef.current) return;
        // If the page was backgrounded before this mount resolve landed, don't
        // write the shared pane/context; defer to reactivation.
        if (WKApp.currentMenuId !== "loop") {
          pendingSpaceReresolveRef.current = true;
          return;
        }
        setLoaded(true);
        if (applyPendingIssueDeepLink(list)) return;
        const first = findWorkspace(list, currentWorkspaceId()) ?? list[0] ?? null;
        applyWorkspace(first, list);
      })
      .catch(() => {
        if (seq !== spaceResolveSeqRef.current) return;
        if (WKApp.currentMenuId !== "loop") {
          pendingSpaceReresolveRef.current = true;
          return;
        }
        setLoaded(true);
        // Clear the switcher list on a failed resolve: showEmptyGuide only
        // repaints the right pane, so without this the dropdown would keep the
        // previous list, re-enabled by setLoaded(true) and clickable.
        setWorkspaces([]);
        showEmptyGuide();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 顶部一级导航「Loop」被再次点击时，onMenuClick 会先 routeRight.popToRoot() 清空右栏
  // （LoopPage 常驻不重挂，useEffect 不会重跑）。这里监听激活事件，把体验对齐「首次进入」
  // ——重置到默认的 Issue（回路）视图，避免右栏残留空白/报错。
  useEffect(() => {
    const onNavMenuActivated = ({ menuId }: { menuId: string }) => {
      if (menuId !== "loop") return;
      // A space change arrived while this page was backgrounded: its handler was
      // deferred, so state still holds the old space. Force a fresh re-resolve
      // instead of painting stale workspaces/wsId.
      if (pendingSpaceReresolveRef.current) {
        pendingSpaceReresolveRef.current = false;
        reResolveSpace();
        return;
      }
      // workspace 列表尚未加载完时不处理：挂载副作用会在加载完成后自行铺默认视图，
      // 避免 workspaces 还是 [] 时误闪空态引导。
      if (!loaded) return;
      const workspace = findWorkspace(workspaces, wsId);
      if (!workspace) {
        showEmptyGuide();
        return;
      }
      replaceLoopRootPath();
      setTab("issue");
      WKApp.routeRight.replaceToRoot(renderTabView("issue", workspace));
      // 已停在 issue tab 时 key(issue:wsId) 不变不会重挂 → 补发刷新事件，让当前 IssuePage 重新拉数(data→view)。
      setTimeout(() => WKApp.mittBus.emit("wk:loop-issues-refresh"), 0);
    };
    WKApp.mittBus.on("wk:nav-menu-activated", onNavMenuActivated);
    return () => WKApp.mittBus.off("wk:nav-menu-activated", onNavMenuActivated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaces, wsId, loaded]);

  // 切换 octo space 时,当前 wsId + @octo/loop 模块级 workspace 全局属于上一个 space,
  // 必须作废重判 —— 否则会带旧 workspace 作用域向新 space 发 workspace 维度请求,撞后端
  // space 隔离闸门(workspace does not belong to this space / not a member of this space)。
  // 先 setWorkspaceContext("","") 清 http 层旧 slug,避免重列期间任何请求带旧作用域;再重新
  // listWorkspaces 并铺新 space 的默认 workspace,新 space 无 workspace 时 applyWorkspace(null)
  // 自然落入空态引导(showEmptyGuide)。
  useEffect(() => {
    const onSpaceChanged = () => {
      // Only the active page may touch the single shared right pane / http-layer
      // workspace context. When LoopPage is backgrounded (kept mounted), defer:
      // flag a pending re-resolve that reactivation (below) consumes, so we never
      // fight the active page for the pane nor paint stale old-space data.
      if (WKApp.currentMenuId !== "loop") {
        pendingSpaceReresolveRef.current = true;
        return;
      }
      reResolveSpace();
    };
    WKApp.mittBus.on("space-changed", onSpaceChanged);
    return () => WKApp.mittBus.off("space-changed", onSpaceChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchWorkspace = (workspace: Workspace) => {
    // 重解析窗口期不响应:下拉里的 w 属于旧 space 的 workspaces,选它会把旧 slug 写回。
    if (!loaded) return;
    // User navigation wins over any pending deep-link resolve.
    paneResolveSeqRef.current += 1;
    replaceLoopRootPath();
    setWorkspaceContext(workspace.slug, workspace.id, workspace.name);
    setWsId(workspace.id);
    resetWorkspaceCaches();
    WKApp.routeRight.replaceToRoot(renderTabView(tabRef.current, workspace));
  };

  const openCreateWorkspace = () => {
    if (!loaded) return;
    setWsName("");
    setWsSlug("");
    setWsSlugTouched(false);
    setWsSlugSuffix(slugSuffix());
    setWsModalOpen(true);
  };

  const closeCreateWorkspace = () => setWsModalOpen(false);

  const changeWorkspaceName = (name: string) => {
    setWsName(name);
    if (!wsSlugTouched) {
      setWsSlug(name.trim() ? withRandomSuffix(getPinyin(name), wsSlugSuffix) : "");
    }
  };

  const changeWorkspaceSlug = (slug: string) => {
    setWsSlug(slug);
    setWsSlugTouched(true);
  };

  const submitCreateWorkspace = async () => {
    const name = wsName.trim();
    if (!name) {
      Toast.warning(t("loop.workspace.nameRequired"));
      return;
    }
    const autoSlug = !wsSlugTouched;
    let slug = wsSlug.trim() || withRandomSuffix(getPinyin(name), wsSlugSuffix);
    if (!slug) {
      Toast.warning(t("loop.workspace.slugRequired"));
      return;
    }
    // Capture (do NOT bump) the resolve generation: creating a workspace writes
    // workspace context after awaits, so if the user switches octo space
    // mid-create, space-changed bumps the seq and the post-await applyWorkspace
    // below is dropped (would otherwise bind this space's slug under the new
    // space's X-Space-Id → isolation 403). Capturing rather than bumping is
    // deliberate: onSpaceChanged owns `loaded` restoration through its own
    // generation, and a create must not invalidate that resolve (else `loaded`
    // could stay false forever, wedging the page).
    const seq = spaceResolveSeqRef.current;
    setWsBusy(true);
    try {
      // auto slug re-rolls its random suffix on the backend's 409 (slug is
      // globally unique) so the happy path needs no manual input; a user-typed
      // slug is surfaced as taken, never silently changed.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          // Re-check before each create so a space switch during a 409 retry
          // doesn't create a stray workspace in the newly-selected space.
          if (seq !== spaceResolveSeqRef.current) return;
          const created = await createWorkspace({ name, slug });
          setWsModalOpen(false);
          const list = await reloadWorkspaces();
          // A space switch during creation invalidates this write; the
          // space-changed resolve owns the pane now.
          if (seq !== spaceResolveSeqRef.current) return;
          // Navigated away mid-create (no space-changed, so seq is unchanged):
          // don't write the shared pane/context in the background; defer.
          if (WKApp.currentMenuId !== "loop") {
            pendingSpaceReresolveRef.current = true;
            return;
          }
          const createdWorkspace = findWorkspace(list, created.id) ?? created;
          applyWorkspace(createdWorkspace, list);
          setTab("issue");
          WKApp.routeRight.replaceToRoot(renderTabView("issue", createdWorkspace));
          Toast.success(t("loop.workspace.created"));
          return;
        } catch (e) {
          if ((e as { status?: number })?.status !== 409) throw e;
          if (!autoSlug || attempt === 2) {
            Toast.error(t("loop.workspace.slugTaken"));
            return;
          }
          slug = withRandomSuffix(getPinyin(name), slugSuffix());
        }
      }
    } catch (e) {
      Toast.error((e as Error)?.message ?? "create failed");
    } finally {
      setWsBusy(false);
    }
  };

  const closeCreateIssue = () => setCreateOpen(false);

  const handleIssueCreated = () => {
    setCreateOpen(false);
    openTab("issue");
    // 若已在 issue tab（同 key 不重挂），补发刷新使新回路即时出现。
    setTimeout(() => WKApp.mittBus.emit("wk:loop-issues-refresh"), 0);
    Toast.success(t("loop.toast.created"));
  };

  const currentWorkspace = findWorkspace(workspaces, wsId);

  return {
    tab,
    workspaces,
    currentWorkspace,
    hasWorkspace: workspaces.length > 0,
    loaded,
    wsModalOpen,
    wsName,
    wsSlug,
    wsBusy,
    createOpen,
    openTab,
    openNewLoop,
    switchWorkspace,
    openCreateWorkspace,
    closeCreateWorkspace,
    submitCreateWorkspace,
    changeWorkspaceName,
    changeWorkspaceSlug,
    closeCreateIssue,
    handleIssueCreated,
  };
}
