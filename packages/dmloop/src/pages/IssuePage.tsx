import React, { useCallback, useEffect, useState } from "react";
import {
  Typography,
  Input,
  Button,
  Spin,
  Empty,
  SideSheet,
  Modal,
  Toast,
} from "@douyinfe/semi-ui";
import { Search, Plus, LayoutGrid, List as ListIcon } from "lucide-react";
import { useI18n } from "@octo/base";
import type { Issue } from "../api/types";
import { listIssues, createIssue } from "../api/issueApi";
import IssueBoard from "../panel/IssueBoard";
import IssueList from "../panel/IssueList";
import IssueDetail from "../panel/IssueDetail";

const { Title } = Typography;

type ViewMode = "board" | "list";

export default function IssuePage() {
  const { t } = useI18n();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>("board");
  const [keyword, setKeyword] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const reload = useCallback(() => {
    setLoading(true);
    listIssues({ keyword })
      .then(setIssues)
      .finally(() => setLoading(false));
  }, [keyword]);

  useEffect(reload, [reload]);

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
          <button
            className={view === "board" ? "is-active" : ""}
            onClick={() => setView("board")}
          >
            <LayoutGrid size={14} />
            {t("loop.view.board")}
          </button>
          <button
            className={view === "list" ? "is-active" : ""}
            onClick={() => setView("list")}
          >
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
        <Button
          theme="solid"
          icon={<Plus size={14} />}
          onClick={() => setCreateOpen(true)}
        >
          {t("loop.action.newIssue")}
        </Button>
      </div>

      <div className="loop-page__body">
        {loading ? (
          <div className="loop-page__center">
            <Spin />
          </div>
        ) : issues.length === 0 ? (
          <div className="loop-page__center">
            <Empty description={t("loop.empty.issue")} />
          </div>
        ) : view === "board" ? (
          <IssueBoard issues={issues} onOpen={setActiveId} onChanged={reload} />
        ) : (
          <IssueList issues={issues} onOpen={setActiveId} onChanged={reload} />
        )}
      </div>

      <SideSheet
        title={t("loop.detail.issueTitle")}
        visible={!!activeId}
        onCancel={() => setActiveId(null)}
        width={520}
      >
        {activeId && <IssueDetail issueId={activeId} onChanged={reload} />}
      </SideSheet>

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
