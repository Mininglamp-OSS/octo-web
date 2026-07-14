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
  const [workspaceEmpty, setWorkspaceEmpty] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  // Loop 与 Personal 共享 @octo/loop 里的模块级 workspace 全局。存下本页选定的 workspace,
  // 以便在 tab 切换 / 导航再激活时重新断言,避免被 Loop 的选择污染(#619 评审)。
  const selectedWsRef = useRef<{ slug: string; id: string } | null>(null);
  // machine 模式(0 workspace)标记:nav 重激活 / tab 切换时据此清空 workspace 作用域并重铺,
  // 而不是像 workspace 模式那样重设 slug。避免 selectedWsRef 为 null 时右栏被清空不重铺。
  const machineModeRef = useRef(false);
  const tabRef = useRef<PersonalTabKey>("runtime");
  tabRef.current = tab;

  const openTab = (key: PersonalTabKey) => {
    if (!workspaceReady) return;
    const ws = selectedWsRef.current;
    if (machineModeRef.current) {
      setWorkspaceContext("", ""); // 机器级模式:清空作用域,列表走 /machine-runtimes
    } else if (ws) {
      setWorkspaceContext(ws.slug, ws.id); // 铺视图前先把全局上下文拨回本页的 workspace
    }
    setTab(key);
    WKApp.routeRight.replaceToRoot(renderTab(key));
  };

  useEffect(() => {
    let cancelled = false;

    WKApp.routeRight.replaceToRoot(
      <PersonalWorkspaceState icon={<Loader2 size={36} />} title={t("personal.workspace.loading")} />,
    );

    workspaceApi.listWorkspaces()
      .then((workspaces) => {
        if (cancelled) return;
        const selection = resolveWorkspaceSelection(workspaces, currentWorkspaceId());

        if (selection.mode === "machine") {
          // 0 workspace:机器级模式。清空 workspace 作用域(不发 x-workspace-slug),
          // 运行时列表转而走 /machine-runtimes;不显示「请先加入 workspace」。
          machineModeRef.current = true;
          selectedWsRef.current = null;
          setWorkspaceContext("", "");
          setWorkspaceReady(true);
          setWorkspaceEmpty(false);
          setWorkspaceError(null);
          WKApp.routeRight.replaceToRoot(renderTab(tabRef.current));
          return;
        }

        machineModeRef.current = false;
        selectedWsRef.current = { slug: selection.slug, id: selection.id };
        setWorkspaceContext(selection.slug, selection.id);
        setWorkspaceReady(true);
        setWorkspaceEmpty(false);
        setWorkspaceError(null);
        WKApp.routeRight.replaceToRoot(renderTab(tabRef.current));
      })
      .catch((error) => {
        if (cancelled) return;
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

    return () => {
      cancelled = true;
    };
    // 只在挂载时跑一次(对齐 LoopPage):依赖 [t] 会让切语言时重跑,闪回加载态、丢失当前 tab/弹框。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 顶部一级导航「Personal」被再次点击时,onMenuClick 会先 popToRoot 清空右栏,且本页常驻不重挂
  // (挂载副作用不会重跑)。这里监听激活事件:重新断言 workspace 上下文并铺回当前 tab,
  // 修复「切回后右栏空白」与「用别处 workspace 的上下文拉数据」两个问题(#619 评审)。
  useEffect(() => {
    const onNavMenuActivated = ({ menuId }: { menuId: string }) => {
      if (menuId !== "dmpersonal") return;
      // 用 ref 判就绪(避免 [] 依赖下的陈旧闭包):machine 模式已就绪但无 selectedWs;
      // workspace 模式以 selectedWsRef 非空为就绪标志。两者皆未定=加载中,挂载副作用会自铺。
      if (machineModeRef.current) {
        setWorkspaceContext("", "");
      } else {
        const ws = selectedWsRef.current;
        if (!ws) return;
        setWorkspaceContext(ws.slug, ws.id);
      }
      WKApp.routeRight.replaceToRoot(renderTab(tabRef.current));
    };
    WKApp.mittBus.on("wk:nav-menu-activated", onNavMenuActivated);
    return () => WKApp.mittBus.off("wk:nav-menu-activated", onNavMenuActivated);
  }, []);

  return (
    <div className="dmpersonal-sidebar">
      <div className="dmpersonal-sidebar__title">{t("personal.menu.title")}</div>
      <nav className="dmpersonal-sidebar__menu">
        {PERSONAL_TABS.map((item) => (
          <button
            key={item.key}
            className={`dmpersonal-sidebar__item ${tab === item.key ? "is-active" : ""}`}
            disabled={!workspaceReady}
            onClick={() => openTab(item.key)}
          >
            {item.icon}
            <span>{t(`personal.nav.${item.key}`)}</span>
          </button>
        ))}
      </nav>
      {(workspaceEmpty || workspaceError) && (
        <div className="dmpersonal-sidebar__hint">
          {workspaceError || t("personal.workspace.requiredTitle")}
        </div>
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
