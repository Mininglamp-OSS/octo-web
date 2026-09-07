import { cloneElement, forwardRef } from "react";
import type { AvatarGroupProps } from "./types";

const AvatarGroup = forwardRef<HTMLSpanElement, AvatarGroupProps>(
  function AvatarGroup(
    { children, size, max = 3, label, className, ...rest },
    ref
  ) {
    const visibleChildren = (
      Array.isArray(children) ? children : [children]
    ).slice(0, max);
    const classes = [
      "octo-ui-avatar-group",
      `octo-ui-avatar-group--size-${size}`,
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <span
        ref={ref}
        className={classes}
        role={label ? "group" : undefined}
        aria-label={label}
        {...rest}
      >
        {visibleChildren.map((child, index) => (
          <span className="octo-ui-avatar-group__item" key={child.key ?? index}>
            {cloneElement(child, { size })}
          </span>
        ))}
      </span>
    );
  }
);

export default AvatarGroup;
export { AvatarGroup };
