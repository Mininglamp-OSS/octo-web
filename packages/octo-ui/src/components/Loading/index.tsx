import { forwardRef } from "react";
import type { LoadingProps } from "./types";

const Loading = forwardRef<HTMLSpanElement, LoadingProps>(function Loading(
  {
    size = "md",
    text,
    layout = "inline",
    className,
    role = "status",
    "aria-label": ariaLabel,
    ...rest
  },
  ref
) {
  const classes = [
    "octo-ui-loading",
    `octo-ui-loading--${size}`,
    `octo-ui-loading--${layout}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      ref={ref}
      className={classes}
      role={role}
      aria-busy="true"
      aria-live="polite"
      aria-label={ariaLabel ?? (text ? undefined : "Loading")}
      {...rest}
    >
      <span className="octo-ui-loading__spinner" aria-hidden="true" />
      {text ? <span className="octo-ui-loading__text">{text}</span> : null}
    </span>
  );
});

export default Loading;
export { Loading };
