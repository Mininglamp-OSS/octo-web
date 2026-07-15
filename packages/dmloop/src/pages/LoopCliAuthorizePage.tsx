import React, { useEffect, useMemo, useState } from "react";
import { Avatar, Toast, Typography } from "@douyinfe/semi-ui";
import LoopButton from "../ui/LoopButton";
import { Laptop, ShieldCheck } from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type { Workspace } from "../api/types";
import { issueLoopCliToken } from "../api/authApi";
import { listWorkspaces } from "../api/workspaceApi";
import { currentWorkspaceId, setWorkspaceContext } from "../api/http";
import { clearPendingLoopCliAuthorizeSearch } from "../cliAuthorizeSession";
import { isSafeCliCallback } from "../ui/cliCallback";
import "./loop.css";

const { Text, Title } = Typography;

function redirectToCli(
  callbackURL: string,
  token: string,
  state: string | null
): void {
  // TODO(security follow-up): replace this JWT-in-query
  // handoff with server-bound device authorization or a one-time PKCE code.
  const target = new URL(callbackURL);
  target.searchParams.set("token", token);
  if (state) target.searchParams.set("state", state);
  window.location.href = target.toString();
}

interface LoopCliAuthorizePageProps {
  initialSearch?: string;
}

export default function LoopCliAuthorizePage({
  initialSearch = window.location.search,
}: LoopCliAuthorizePageProps) {
  const { t } = useI18n();
  const params = useMemo(
    () => new URLSearchParams(initialSearch),
    [initialSearch]
  );
  const cliCallback = params.get("cli_callback") ?? "";
  const cliState = params.get("cli_state");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [authorizing, setAuthorizing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!cliCallback || !isSafeCliCallback(cliCallback)) {
      setError(t("loop.cliAuthorize.invalidCallback"));
      setLoading(false);
      return;
    }
    if (!WKApp.loginInfo.token || !WKApp.shared.currentSpaceId) {
      setError(t("loop.cliAuthorize.loginRequired"));
      setLoading(false);
      return;
    }
    listWorkspaces()
      .then((list) => {
        if (cancelled) return;
        const selected =
          list.find((w) => w.id === currentWorkspaceId()) ?? list[0] ?? null;
        if (!selected) {
          setError(t("loop.cliAuthorize.noWorkspace"));
          return;
        }
        setWorkspaceContext(selected.slug, selected.id);
        setWorkspace(selected);
      })
      .catch((err) => {
        if (!cancelled)
          setError(
            (err as Error)?.message ?? t("loop.cliAuthorize.loadFailed")
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cliCallback, t]);

  const authorize = async () => {
    if (!workspace || !cliCallback || !isSafeCliCallback(cliCallback)) return;
    setAuthorizing(true);
    setError("");
    try {
      const { token } = await issueLoopCliToken();
      clearPendingLoopCliAuthorizeSearch(window.sessionStorage);
      redirectToCli(cliCallback, token, cliState);
    } catch (err) {
      const msg =
        (err as Error)?.message ?? t("loop.cliAuthorize.authorizeFailed");
      setError(msg);
      Toast.error(msg);
      setAuthorizing(false);
    }
  };

  return (
    <div className="loop-cli-auth">
      <div className="loop-cli-auth__panel">
        <div className="loop-cli-auth__icon">
          <Laptop size={26} />
        </div>
        <Title heading={3} className="loop-cli-auth__title">
          {t("loop.cliAuthorize.title")}
        </Title>
        <Text type="secondary" className="loop-cli-auth__desc">
          {t("loop.cliAuthorize.description")}
        </Text>

        <div className="loop-cli-auth__workspace">
          <Avatar size="small" color="blue" shape="square">
            {(workspace?.name ?? "L").slice(0, 1)}
          </Avatar>
          <div className="loop-cli-auth__workspace-meta">
            <Text strong>
              {workspace?.name ?? t("loop.cliAuthorize.workspaceLoading")}
            </Text>
            <Text type="tertiary" size="small">
              {workspace?.slug ??
                (loading ? t("loop.cliAuthorize.loading") : "-")}
            </Text>
          </div>
        </div>

        {error && <div className="loop-cli-auth__error">{error}</div>}

        <LoopButton
          block
          icon={<ShieldCheck size={16} />}
          loading={authorizing}
          disabled={loading || !!error || !workspace}
          onClick={authorize}
        >
          {t("loop.cliAuthorize.authorize")}
        </LoopButton>
      </div>
    </div>
  );
}
