import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, Cpu, Loader2, Sparkles } from "lucide-react";
import { currentWorkspaceId, resolveWorkspaceSelection, RuntimePage, setWorkspaceContext, SkillPage, workspaceApi } from "@octo/loop";
import { useI18n, WKApp } from "@octo/base";
import "@octo/loop/src/pages/loop.css";
import "./personal.css";

type PersonalTabKey = "runtime" | "skill";

const PERSONAL_TABS: { key: PersonalTabKey; icon: React.ReactNode }[] = [
  { key: "runtime", icon: <Cpu size={16} /> },
  { key: "skill", icon: <Sparkles size={16} /> },
];

function renderTab(key: PersonalTabKey): JSX.Element {
  switch (key) {
    case "runtime":
      return <RuntimePage key="runtime" />;
    case "skill":
      return <SkillPage key="skill" />;
    default:
      return <RuntimePage key="runtime" />;
  }
}

export default function PersonalPage() {
  const { t } = useI18n();
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
        <PersonalWorkspaceState icon={<Loader2 size={36} />} title={t("personal.workspace.loading")} />,
      );
    }
    workspaceApi.listWorkspaces()
      .then((workspaces) => {
        if (!mountedRef.current || seq !== resolveSeqRef.current) return;
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
        const message = error?.message ? String(error.message) : t("personal.workspace.loadFailed");
        setWorkspaceError(message);
        setWorkspaceReady(false);
        WKApp.routeRight.replaceToRoot(
          <PersonalWorkspaceState
            icon={<AlertCircle size={40} />}
            title={t("personal.workspace.loadFailed")}
            desc={message}
          />,
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
    return () => WKApp.mittBus.off("wk:nav-menu-activated", onNavMenuActivated);
  }, []);

  return (
    <div className="dmpersonal-sidebar">
      <div className="dmpersonal-sidebar__title">
        <span>{t("personal.menu.title")}</span>
        <span className="dmpersonal-sidebar__beta">{t("personal.beta")}</span>
      </div>
      <nav className="dmpersonal-sidebar__menu">
        {PERSONAL_TABS.map((item) => (
          <button
            key={item.key}
            className={`dmpersonal-sidebar__item ${tab === item.key ? "is-active" : ""}`}
            disabled={!workspaceReady || (machineMode && item.key === "skill")}
            onClick={() => openTab(item.key)}
          >
            {item.icon}
            <span>{t(`personal.nav.${item.key}`)}</span>
          </button>
        ))}
      </nav>
      {workspaceError && (
        <div className="dmpersonal-sidebar__hint">{workspaceError}</div>
      )}
    </div>
  );
}

function PersonalWorkspaceState({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc?: string;
}) {
  return (
    <div className="loop-page">
      <div className="dmpersonal-state">
        <div className="dmpersonal-state__icon">{icon}</div>
        <div className="dmpersonal-state__title">{title}</div>
        {desc && <div className="dmpersonal-state__desc">{desc}</div>}
      </div>
    </div>
  );
}
