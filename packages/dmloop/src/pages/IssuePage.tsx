import React, { useCallback, useEffect, useState } from "react";
import {
  Typography,
  Input,
  Button,
  Spin,
  Empty,
  Modal,
  Toast,
} from "@douyinfe/semi-ui";
import { Search, Plus, LayoutGrid, List as ListIcon, ClipboardList } from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type { Issue } from "../api/types";
import { listIssues, createIssue } from "../api/issueApi";
import IssueBoard from "../panel/IssueBoard";
import IssueList from "../panel/IssueList";
import IssueDetailPage from "../panel/IssueDetailPage";

const { Title } = Typography;

type ViewMode = "board" | "list";

export default function IssuePage() {
  const { t } = useI18n();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>("board");
  const [keyword, setKeyword] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const reload = useCallback(() => {
    setLoading(true);
    listIssues({ keyword })
      .then(setIssues)
      .finally(() => setLoading(false));
  }, [keyword]);

  useEffect(reload, [reload]);

  // 点击 Issue → 跳转独立详情页（push 到右主栏，返回可 pop）。
  const openDetail = (id: string) => {
    WKApp.routeRight.push(<IssueDetailPage issueId={id} onChanged={reload} />);
  };

  const doCreate = async () => {
    const title = newTitle.trim();
    if (!title) return;
    await createIssue({ title, status: "todo" });
    setNewTitle("");
    setCreateOpen(false);
    Toast.success(t("loop.toast.created"));
    reload();
  };

  return (
    <div className="loop-page">
      <div className="loop-page__head">
        <Title heading={4}>{t("loop.nav.issue")}</Title>
        <div className="loop-viewtoggle">
          <button className={view === "board" ? "is-active" : ""} onClick={() => setView("board")}>
            <LayoutGrid size={14} />
            {t("loop.view.board")}
          </button>
          <button className={view === "list" ? "is-active" : ""} onClick={() => setView("list")}>
            <ListIcon size={14} />
            {t("loop.view.list")}
          </button>
        </div>
        <div className="loop-page__spacer" />
        <Input
          prefix={<Search size={14} />}
          placeholder={t("loop.search.issue")}
          value={keyword}
          onChange={setKeyword}
          showClear
          style={{ width: 220 }}
        />
        <Button theme="solid" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
          {t("loop.action.newIssue")}
        </Button>
      </div>

      <div className="loop-page__body">
        {loading ? (
          <div className="loop-page__center">
            <Spin />
          </div>
        ) : issues.length === 0 ? (
          <div className="loop-empty">
            <ClipboardList size={40} className="loop-empty__icon" />
            <div className="loop-empty__title">{t("loop.empty.issueTitle")}</div>
            <div className="loop-empty__desc">{t("loop.empty.issueDesc")}</div>
            <Button theme="solid" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)} style={{ marginTop: 12 }}>
              {t("loop.action.newIssue")}
            </Button>
          </div>
        ) : view === "board" ? (
          <IssueBoard issues={issues} onOpen={openDetail} onChanged={reload} />
        ) : (
          <IssueList issues={issues} onOpen={openDetail} onChanged={reload} />
        )}
      </div>

      <Modal
        title={t("loop.action.newIssue")}
        visible={createOpen}
        onOk={doCreate}
        onCancel={() => setCreateOpen(false)}
        okText={t("loop.action.create")}
        cancelText={t("loop.action.cancel")}
      >
        <Input
          autoFocus
          value={newTitle}
          onChange={setNewTitle}
          placeholder={t("loop.field.titlePlaceholder")}
          onEnterPress={doCreate}
        />
      </Modal>
    </div>
  );
}
