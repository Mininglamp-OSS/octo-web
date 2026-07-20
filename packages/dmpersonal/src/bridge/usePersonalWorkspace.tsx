import React, { useEffect, useRef, useState } from "react";
import {
  currentWorkspaceId,
  resolveWorkspaceSelection,
  setWorkspaceContext,
  workspaceApi,
} from "@octo/loop";
import { WKApp } from "@octo/base";
import type {
  PersonalTabKey,
  PersonalWorkspaceStateRenderArgs,
} from "./types";

export type {
  PersonalTabKey,
  PersonalWorkspaceStateRenderArgs,
} from "./types";

export interface UsePersonalWorkspaceOptions {
  t: (key: string) => string;
  renderTab: (key: PersonalTabKey) => JSX.Element;
  renderWorkspaceState: (
    args: PersonalWorkspaceStateRenderArgs
  ) => JSX.Element;
}

export interface UsePersonalWorkspaceResult {
  tab: PersonalTabKey;
  workspaceReady: boolean;
  workspaceError: string | null;
  machineMode: boolean;
  openTab: (key: PersonalTabKey) => void;
}

export function usePersonalWorkspace({
  t,
  renderTab,
  renderWorkspaceState,
}: UsePersonalWorkspaceOptions): UsePersonalWorkspaceResult {
  const [tab, setTab] = useState<PersonalTabKey>("runtime");
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  // machine 模式(0 workspace)标记:machine 模式禁用 Skills、清空 workspace 作用域。
  // 用 state 驱动 tab 禁用渲染,用 ref 供导航激活副作用同步读取。
  const [machineMode, setMachineMode] = useState(false);
  // Loop 与 Personal 共享 @octo/loop 里的模块级 workspace 全局。存下本页选定的 workspace,
  // 以便在 tab 切换 / 导航再激活时重新断言,避免被 Loop 的选择污染(#619 评审)。
  const selectedWsRef = useRef<{ slug: string; id: string } | null>(null);
  const machineModeRef = useRef(false);
  const tabRef = useRef<PersonalTabKey>("runtime");
  tabRef.current = tab;
  const mountedRef = useRef(true);
  // 请求代号:resolveAndPaint 由导航事件驱动,快速切换可能并发多个 listWorkspaces;
  // 每次进入自增,回来时若代号已过期就丢弃,保证"最后一次点击胜出"、不被慢的旧响应覆盖。
  const resolveSeqRef = useRef(0);

  // 解析当前 workspace 归属并铺右栏。每次调用都重新 listWorkspaces —— 本页常驻不重挂,
  // 且 workspace 可能在别处(如 Loop)被创建/删除,machine↔workspace 模式必须每次重判,
  // 不能沿用挂载时缓存的判断(#729 评审:否则建了 workspace 仍卡在 machine 模式)。
  const resolveAndPaint = (showLoading: boolean) => {
    const seq = ++resolveSeqRef.current;
    if (showLoading) {
      WKApp.routeRight.replaceToRoot(
        renderWorkspaceState({
          status: "loading",
          title: t("personal.workspace.loading"),
        })
      );
    }
    workspaceApi
      .listWorkspaces()
      .then((workspaces) => {
        if (!mountedRef.current || seq !== resolveSeqRef.current) return;
        // If the page was backgrounded before this resolve landed, don't write
        // the shared pane/context (would clobber the now-active page). Bail;
        // reactivation re-resolves via wk:nav-menu-activated (resolveRef).
        if (WKApp.currentMenuId !== "dmpersonal") return;
        // 优先用本页自己存的 workspace,仅当它不存在(如在别处被删)时才回落到共享全局。
        // 直接读 currentWorkspaceId() 会让 Personal 跟随 Loop 最后选中的 workspace(#619 污染)。
        const targetId = selectedWsRef.current?.id ?? currentWorkspaceId();
        const selection = resolveWorkspaceSelection(workspaces, targetId);
        if (selection.mode === "machine") {
          // 0 workspace:机器级模式。清空 workspace 作用域(不发 x-workspace-slug),
          // 运行时列表走 /machine-runtimes;Skills 需 workspace,禁用。
          machineModeRef.current = true;
          setMachineMode(true);
          selectedWsRef.current = null;
          setWorkspaceContext("", "");
          // machine 模式禁用 Skills:若当前正停在 Skills tab,回落到 runtime。
          if (tabRef.current === "skill") {
            tabRef.current = "runtime";
            setTab("runtime");
          }
        } else {
          machineModeRef.current = false;
          setMachineMode(false);
          selectedWsRef.current = { slug: selection.slug, id: selection.id };
          setWorkspaceContext(selection.slug, selection.id);
        }
        setWorkspaceReady(true);
        setWorkspaceError(null);
        WKApp.routeRight.replaceToRoot(renderTab(tabRef.current));
      })
      .catch((error) => {
        if (!mountedRef.current || seq !== resolveSeqRef.current) return;
        // Backgrounded before the failure landed → don't paint the shared pane.
        if (WKApp.currentMenuId !== "dmpersonal") return;
        const message = error?.message
          ? String(error.message)
          : t("personal.workspace.loadFailed");
        setWorkspaceError(message);
        setWorkspaceReady(false);
        WKApp.routeRight.replaceToRoot(
          renderWorkspaceState({
            status: "error",
            title: t("personal.workspace.loadFailed"),
            desc: message,
          })
        );
      });
  };
  // 始终指向最新的 resolveAndPaint,供 []-依赖的副作用调用(避免陈旧闭包,同时不让
  // 副作用因 t 变化而重挂——对齐 LoopPage 的 mount-once 行为,切语言不闪回加载态)。
  const resolveRef = useRef(resolveAndPaint);
  resolveRef.current = resolveAndPaint;

  const openTab = (key: PersonalTabKey) => {
    if (!workspaceReady) return;
    if (machineModeRef.current && key === "skill") return; // skill 需 workspace,机器级模式禁用
    const ws = selectedWsRef.current;
    if (machineModeRef.current) {
      setWorkspaceContext("", "");
    } else if (ws) {
      setWorkspaceContext(ws.slug, ws.id);
    }
    setTab(key);
    WKApp.routeRight.replaceToRoot(renderTab(key));
  };

  useEffect(() => {
    mountedRef.current = true;
    resolveRef.current(true);
    return () => {
      mountedRef.current = false;
    };
    // 只在挂载时跑一次(对齐 LoopPage):依赖 [t] 会让切语言时重跑,闪回加载态、丢失当前 tab/弹框。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 顶部一级导航「Personal」被再次点击时,onMenuClick 会先 popToRoot 清空右栏,且本页常驻不重挂
  // (挂载副作用不会重跑)。这里监听激活事件:重新解析 workspace 归属(machine↔workspace 可能已变)
  // 并铺回当前 tab,修复「切回后右栏空白」「用别处 workspace 上下文拉数据」以及「建 workspace 后
  // 仍卡在机器级模式」(#729 评审)。
  useEffect(() => {
    const onNavMenuActivated = ({ menuId }: { menuId: string }) => {
      if (menuId !== "dmpersonal") return;
      // showLoading=true:框架会先 popToRoot 清空右栏,重解析是异步的,先铺加载态避免空白闪一下。
      resolveRef.current(true);
    };
    WKApp.mittBus.on("wk:nav-menu-activated", onNavMenuActivated);
    return () =>
      WKApp.mittBus.off("wk:nav-menu-activated", onNavMenuActivated);
  }, []);

  // 切换 octo space 时,本页存的 workspace 归属(selectedWsRef + @octo/loop 模块级
  // workspace 全局)属于上一个 space,必须作废重判 —— 否则会带旧 workspace 作用域向新
  // space 发 workspace 维度请求,撞后端 space 隔离闸门(workspace does not belong to
  // this space / not a member of this space)。
  //
  // 三份 workspace 状态必须一起复位,缺一不可:
  //  - selectedWsRef:本页自留、优先于共享全局的选择(#619 防污染),不清则重解析仍选中旧 ws;
  //  - machineModeRef:决定 openTab 的分支,不清则窗口期分支判断用旧值;
  //  - setWorkspaceContext("",""):清 @octo/loop 的 http 层模块级 slug/id。这一步关键——
  //    resolveAndPaint(showLoading=true) 不置 workspaceReady=false,从 emit 到重解析完成的
  //    loading 窗口内 nav 按钮不禁用,用户此刻点 tab 会走 openTab;若 http 层仍留旧 slug,
  //    RuntimePage 会用旧 slug 打 /runtimes(consistency group 内)→ 403 重现本 bug。
  //    先把 http 作用域降为空(machine),窗口期任何请求都无 slug 发出、安全走 /machine-runtimes。
  // 复位后 resolveAndPaint 重新 listWorkspaces:新 space 无 workspace 时自然落入 machine 空态。
  useEffect(() => {
    const onSpaceChanged = () => {
      // Only the active page may touch the single shared right pane / http-layer
      // workspace context. When backgrounded, do NOT clear the shared context
      // (that would wipe the active Loop page's slug) — but still reset our own
      // PRIVATE state and drop workspaceReady, so the reactivation window is
      // gated by !workspaceReady (openTab bails) instead of letting a click
      // write the old space's slug back → 403. Reactivation re-resolves via
      // wk:nav-menu-activated (resolveRef.current(true)).
      if (WKApp.currentMenuId !== "dmpersonal") {
        selectedWsRef.current = null;
        machineModeRef.current = false;
        setWorkspaceReady(false);
        return;
      }
      selectedWsRef.current = null;
      machineModeRef.current = false;
      setWorkspaceContext("", "");
      // Gate the re-resolve window: openTab bails on !workspaceReady, so the
      // Skills / runtime tabs cannot be opened against the old space's workspace
      // scope until resolveAndPaint re-establishes the new space's selection.
      setWorkspaceReady(false);
      resolveRef.current(true);
    };
    WKApp.mittBus.on("space-changed", onSpaceChanged);
    return () => WKApp.mittBus.off("space-changed", onSpaceChanged);
  }, []);

  return {
    tab,
    workspaceReady,
    workspaceError,
    machineMode,
    openTab,
  };
}
