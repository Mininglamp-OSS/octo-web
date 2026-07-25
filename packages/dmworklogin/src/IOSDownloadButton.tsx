import React from "react";
import { Popover, Spin } from "@douyinfe/semi-ui";
import { WKButton } from "@octo/base";
import { QRCodeSVG } from "qrcode.react";
import { loginT as t } from "./i18n";
import { useMobileDownloadUrl } from "./mobileDownloadUpdater";
import "./MobileDownloadPopover.css";

export const IOS_UPDATER_PATH = "common/updater/ios/1.0.0";

type PopoverHoverProps = Pick<
  React.HTMLAttributes<HTMLDivElement>,
  "onMouseEnter" | "onMouseLeave"
>;

export const IOSDownloadPopoverContent: React.FC<PopoverHoverProps> = (
  hoverProps
) => {
  const { status, downloadUrl, retry } = useMobileDownloadUrl(IOS_UPDATER_PATH);

  return (
    <div
      className="wk-login-mobile-download-popover"
      role="dialog"
      aria-label={t("download.iosQrTitle")}
      {...hoverProps}
    >
      <div
        className="wk-login-mobile-popover-qr"
        data-status={status}
        role={status === "ready" ? "img" : undefined}
        aria-label={status === "ready" ? t("download.iosQrLabel") : undefined}
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
        {t("download.iosQrTitle")}
      </strong>
    </div>
  );
};

// iOS 安装入口：按钮只控制二维码浮窗，安装地址由 updater 接口提供
export const IOSDownloadButton: React.FC = () => {
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
        <IOSDownloadPopoverContent
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
        aria-label={t("download.iosHoverHint")}
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
          <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
        </svg>
        <span>{t("download.ios")}</span>
      </button>
    </Popover>
  );
};

export default IOSDownloadButton;
