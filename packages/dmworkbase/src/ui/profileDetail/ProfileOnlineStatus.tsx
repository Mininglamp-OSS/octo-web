import React from "react";
import { i18n, t } from "../../i18n";
import "./ProfileOnlineStatus.css";

export interface ProfileOnlineStatusChannelInfo {
  online?: boolean;
  lastOffline?: number;
  orgData?: Record<string, any>;
}

export interface ProfileOnlineStatusInfo {
  tone: "online" | "offline";
  text: string;
}

type Translate = typeof t;

const REFRESH_INTERVAL_MS = 1000;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasKnownOfflineState(channelInfo: ProfileOnlineStatusChannelInfo) {
  const orgData = channelInfo.orgData || {};
  if (orgData.onlineStatusKnown === true) return true;
  if (orgData.online !== undefined && orgData.online !== null) return true;
  if (isFiniteNumber(channelInfo.lastOffline) && channelInfo.lastOffline > 0) return true;
  return false;
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function formatLastOnline(lastOffline: number, nowMs: number) {
  const date = new Date(lastOffline * 1000);
  if (Number.isNaN(date.getTime())) return "";
  const currentYear = new Date(nowMs).getFullYear();
  const dateText = `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(
    date.getHours()
  )}:${pad2(date.getMinutes())}`;
  if (date.getFullYear() === currentYear) {
    return dateText;
  }
  return `${date.getFullYear()}-${dateText}`;
}

export function getProfileOnlineStatus(
  channelInfo?: ProfileOnlineStatusChannelInfo,
  nowMs = Date.now(),
  translate: Translate = t
): ProfileOnlineStatusInfo | undefined {
  if (!channelInfo) return undefined;

  if (channelInfo.online === true) {
    return {
      tone: "online",
      text: translate("base.profileOnlineStatus.online"),
    };
  }

  if (!hasKnownOfflineState(channelInfo)) {
    return undefined;
  }

  const lastOffline = channelInfo.lastOffline;
  if (!isFiniteNumber(lastOffline) || lastOffline <= 0) {
    return {
      tone: "offline",
      text: translate("base.profileOnlineStatus.offline"),
    };
  }

  const elapsedSeconds = Math.max(0, Math.floor(nowMs / 1000 - lastOffline));
  if (elapsedSeconds < 60) {
    return {
      tone: "offline",
      text: translate("base.profileOnlineStatus.justOffline"),
    };
  }

  if (elapsedSeconds < 60 * 60) {
    return {
      tone: "offline",
      text: translate("base.profileOnlineStatus.minutesAgo", {
        values: { count: Math.max(1, Math.floor(elapsedSeconds / 60)) },
      }),
    };
  }

  if (elapsedSeconds < 24 * 60 * 60) {
    return {
      tone: "offline",
      text: translate("base.profileOnlineStatus.hoursAgo", {
        values: { count: Math.floor(elapsedSeconds / 3600) },
      }),
    };
  }

  return {
    tone: "offline",
    text: translate("base.profileOnlineStatus.lastOnline", {
      values: { time: formatLastOnline(lastOffline, nowMs) },
    }),
  };
}

export interface ProfileOnlineStatusProps {
  channelInfo?: ProfileOnlineStatusChannelInfo;
  className?: string;
}

function ProfileOnlineStatus({ channelInfo, className }: ProfileOnlineStatusProps) {
  const [nowMs, setNowMs] = React.useState(() => Date.now());

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  React.useEffect(() => {
    return i18n.subscribe(() => setNowMs(Date.now()));
  }, []);

  const status = getProfileOnlineStatus(channelInfo, nowMs);
  if (!status) return null;

  return (
    <div
      className={`wk-profile-online-status wk-profile-online-status--${status.tone}${
        className ? ` ${className}` : ""
      }`}
      role="status"
      aria-live="polite"
      aria-label={status.text}
    >
      <span className="wk-profile-online-status-dot" aria-hidden="true" />
      <span className="wk-profile-online-status-text">{status.text}</span>
    </div>
  );
}

export default ProfileOnlineStatus;
