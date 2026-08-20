import { isValidElement } from "react";
import { Tooltip as SemiTooltip } from "@douyinfe/semi-ui";
import type {
  TooltipContent,
  TooltipContentConfig,
  TooltipPlacement,
  TooltipProps,
} from "./types";

const SEMI_PLACEMENT = {
  top: "top",
  "top-start": "topLeft",
  "top-end": "topRight",
  right: "right",
  "right-start": "rightTop",
  "right-end": "rightBottom",
  bottom: "bottom",
  "bottom-start": "bottomLeft",
  "bottom-end": "bottomRight",
  left: "left",
  "left-start": "leftTop",
  "left-end": "leftBottom",
} as const satisfies Record<TooltipPlacement, string>;

function hasNodeContent(content: TooltipContent) {
  if (content === null || content === undefined || content === false)
    return false;
  return typeof content !== "string" || content.trim().length > 0;
}

function isContentConfig(
  content: TooltipContent
): content is TooltipContentConfig {
  return (
    typeof content === "object" &&
    content !== null &&
    !isValidElement(content) &&
    "body" in content
  );
}

function renderContent(content: TooltipContent) {
  if (!isContentConfig(content)) return content;

  const layout = content.layout ?? (content.title ? "vertical" : "horizontal");
  const classes = [
    "octo-ui-tooltip__content",
    `octo-ui-tooltip__content--${layout}`,
    content.shortcut && "octo-ui-tooltip__content--shortcut",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      {content.title ? (
        <strong className="octo-ui-tooltip__title">{content.title}</strong>
      ) : null}
      <span
        className={
          content.title
            ? "octo-ui-tooltip__body octo-ui-tooltip__body--muted"
            : "octo-ui-tooltip__body"
        }
      >
        {content.body}
      </span>
      {content.shortcut ? (
        <span className="octo-ui-tooltip__shortcut">{content.shortcut}</span>
      ) : null}
      {content.actions ? (
        <span className="octo-ui-tooltip__actions">{content.actions}</span>
      ) : null}
    </div>
  );
}

const Tooltip = ({
  content,
  children,
  isDelayed = false,
  isDisabled = false,
  placement = "top",
  className,
  onVisibleChange,
}: TooltipProps) => {
  const contentConfig = isContentConfig(content) ? content : null;
  const hasContent = contentConfig
    ? [
        contentConfig.title,
        contentConfig.body,
        contentConfig.shortcut,
        contentConfig.actions,
      ].some(hasNodeContent)
    : hasNodeContent(content);

  const isInactive = isDisabled || !hasContent;

  if (isInactive) return children;

  const isHorizontalAction =
    contentConfig?.actions &&
    (contentConfig.layout ??
      (contentConfig.title ? "vertical" : "horizontal")) === "horizontal";
  const classes = [
    "octo-ui-tooltip",
    isHorizontalAction && "octo-ui-tooltip--horizontal-actions",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <SemiTooltip
      className={classes}
      content={renderContent(content)}
      position={SEMI_PLACEMENT[placement]}
      mouseEnterDelay={isDelayed ? 300 : 0}
      mouseLeaveDelay={0}
      showArrow={false}
      spacing={6}
      autoAdjustOverflow
      onVisibleChange={onVisibleChange}
    >
      {children}
    </SemiTooltip>
  );
};

export default Tooltip;
export { Tooltip };
