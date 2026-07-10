import React, { useEffect, useState } from "react";
import { AlertCircle, Cpu, FolderPlus, Loader2, Sparkles } from "lucide-react";
import { RuntimePage, SkillPage } from "@octo/loop";
import { useI18n, WKApp } from "@octo/base";
import { listWorkspaces } from "@octo/loop/src/api/workspaceApi";
import { currentWorkspaceId, setWorkspaceContext } from "@octo/loop";
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

  const openTab = (key: PersonalTabKey) => {
    if (!workspaceReady) return;
    setTab(key);
    WKApp.routeRight.replaceToRoot(renderTab(key));
  };

  useEffect(() => {
    let cancelled = false;

    WKApp.routeRight.replaceToRoot(
      <PersonalWorkspaceState icon={<Loader2 size={36} />} title={t("personal.workspace.loading")} />,
    );

    listWorkspaces()
      .then((workspaces) => {
        if (cancelled) return;
        const selected = workspaces.find((workspace) => workspace.id === currentWorkspaceId()) ?? workspaces[0] ?? null;

        if (!selected) {
          setWorkspaceEmpty(true);
          setWorkspaceReady(false);
          WKApp.routeRight.replaceToRoot(
            <PersonalWorkspaceState
              icon={<FolderPlus size={40} />}
              title={t("personal.workspace.requiredTitle")}
              desc={t("personal.workspace.requiredDesc")}
            />,
          );
          return;
        }

        setWorkspaceContext(selected.slug, selected.id);
        setWorkspaceReady(true);
        setWorkspaceEmpty(false);
        setWorkspaceError(null);
        WKApp.routeRight.replaceToRoot(renderTab("runtime"));
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
