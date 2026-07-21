import React from "react";
import { IconGithubLogo } from "@douyinfe/semi-icons";
import { Popover, Spin } from "@douyinfe/semi-ui";
import { WKButton } from "@octo/base";
import { QRCodeSVG } from "qrcode.react";
import { loginT as t } from "./i18n";
import {
  resolveMobileUpdaterUrl,
  useMobileDownloadUrl,
} from "./mobileDownloadUpdater";
import "./MobileDownloadPopover.css";

export const ANDROID_UPDATER_PATH = "common/updater/android/1.0";
export const ANDROID_RELEASES_URL =
  "https://github.com/Mininglamp-OSS/octo-android/releases/latest";

export function resolveAndroidUpdaterUrl(apiUrl?: string) {
  return resolveMobileUpdaterUrl(ANDROID_UPDATER_PATH, apiUrl);
}

export function openAndroidReleases() {
  if (typeof window === "undefined") return;
  const nextWindow = window.open(
    ANDROID_RELEASES_URL,
    "_blank",
    "noopener,noreferrer"
  );
  if (nextWindow) nextWindow.opener = null;
}

type PopoverHoverProps = Pick<
  React.HTMLAttributes<HTMLDivElement>,
  "onMouseEnter" | "onMouseLeave"
>;

export const AndroidDownloadPopoverContent: React.FC<PopoverHoverProps> = (
  hoverProps
) => {
  const { status, downloadUrl, retry } =
    useMobileDownloadUrl(ANDROID_UPDATER_PATH);

  return (
    <div
      className="wk-login-mobile-download-popover"
      role="dialog"
      aria-label={t("download.androidQrTitle")}
      {...hoverProps}
    >
      <div
        className="wk-login-mobile-popover-qr"
        data-status={status}
        role={status === "ready" ? "img" : undefined}
        aria-label={
          status === "ready" ? t("download.androidQrTitle") : undefined
        }
        aria-busy={status === "loading" ? true : undefined}
      >
        {status === "loading" && (
          <Spin aria-label={t("download.loadingAddress")} size="large" />
        )}
        {status === "error" && (
          <div className="wk-login-mobile-download-state" role="alert">
            <span>{t("download.addressLoadFailed")}</span>
            <WKButton type="button" variant="ghost" size="sm" onClick={retry}>
              {t("download.retry")}
            </WKButton>
          </div>
        )}
        {status === "ready" && <QRCodeSVG value={downloadUrl} size={104} />}
      </div>
      <strong className="wk-login-mobile-download-popover-title">
        {t("download.androidQrTitle")}
      </strong>
      {status === "ready" ? (
        <a
          className="wk-login-mobile-download-direct-link"
          href={downloadUrl}
          download
        >
          {t("download.androidDirectDownload")}
        </a>
      ) : (
        <span
          className="wk-login-mobile-download-direct-link"
          aria-disabled="true"
        >
          {t("download.androidDirectDownload")}
        </span>
      )}
      <WKButton
        type="button"
        className="wk-login-android-popover-manual-download"
        variant="ghost"
        size="sm"
        icon={<IconGithubLogo aria-hidden="true" />}
        aria-label={t("download.openGithubReleases")}
        onClick={openAndroidReleases}
      >
        {t("download.githubManualDownload")}
      </WKButton>
    </div>
  );
};

export const AndroidDownloadButton: React.FC = () => {
  const [hoverVisible, setHoverVisible] = React.useState(false);
  const [clickPinned, setClickPinned] = React.useState(false);
  const hoverCloseTimer = React.useRef<ReturnType<typeof setTimeout>>();
  const visible = hoverVisible || clickPinned;

  const clearHoverCloseTimer = () => {
    if (hoverCloseTimer.current !== undefined) {
      clearTimeout(hoverCloseTimer.current);
      hoverCloseTimer.current = undefined;
    }
  };

  const showOnHover = () => {
    clearHoverCloseTimer();
    setHoverVisible(true);
  };

  const hideAfterHover = () => {
    clearHoverCloseTimer();
    hoverCloseTimer.current = setTimeout(() => setHoverVisible(false), 100);
  };

  const closePopover = () => {
    clearHoverCloseTimer();
    setHoverVisible(false);
    setClickPinned(false);
  };

  React.useEffect(() => clearHoverCloseTimer, []);

  return (
    <Popover
      content={
        <AndroidDownloadPopoverContent
          onMouseEnter={showOnHover}
          onMouseLeave={hideAfterHover}
        />
      }
      position="bottom"
      showArrow
      trigger="custom"
      contentClassName="wk-login-mobile-download-popover-shell"
      arrowStyle={{
        backgroundColor: "var(--wk-bg-surface)",
        borderColor: "var(--wk-border-default)",
      }}
      style={{
        backgroundColor: "transparent",
        boxShadow: "none",
        padding: 0,
      }}
      visible={visible}
      onClickOutSide={closePopover}
    >
      <button
        type="button"
        className="wk-login-download-btn"
        aria-haspopup="dialog"
        aria-expanded={visible}
        aria-label={t("download.androidHoverHint")}
        onMouseEnter={showOnHover}
        onMouseLeave={hideAfterHover}
        onClick={() => setClickPinned((pinned) => !pinned)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            closePopover();
          }
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M6 18c0 .55.45 1 1 1h1v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h2v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h1c.55 0 1-.45 1-1V8H6v10zM3.5 8C2.67 8 2 8.67 2 9.5v7c0 .83.67 1.5 1.5 1.5S5 17.33 5 16.5v-7C5 8.67 4.33 8 3.5 8zm17 0c-.83 0-1.5.67-1.5 1.5v7c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-7c0-.83-.67-1.5-1.5-1.5zm-4.97-5.84 1.3-1.3c.2-.2.2-.51 0-.71-.2-.2-.51-.2-.71 0l-1.48 1.48A7.4 7.4 0 0 0 12 1c-1.1 0-2.15.23-3.12.63L7.4.15c-.2-.2-.51-.2-.71 0-.2.2-.2.51 0 .71L8 2.17A6.83 6.83 0 0 0 6 7h12c0-1.99-.97-3.75-2.47-4.84zM10 5H9V4h1v1zm5 0h-1V4h1v1z" />
        </svg>
        <span>{t("download.android")}</span>
      </button>
    </Popover>
  );
};

export default AndroidDownloadButton;
