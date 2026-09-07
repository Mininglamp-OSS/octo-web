import { IllustrationNoContent } from "@douyinfe/semi-illustrations";
import { forwardRef } from "react";
import type { ReactNode } from "react";
import type { EmptyProps } from "./types";

export const DefaultEmptyIllustration = () => (
  <IllustrationNoContent aria-hidden="true" focusable={false} />
);

const shouldRenderSlot = (node: ReactNode) =>
  node !== null && node !== undefined && node !== false && node !== true && node !== "";

const Empty = forwardRef<HTMLDivElement, EmptyProps>(function Empty(
  {
    title,
    description,
    illustration = <DefaultEmptyIllustration />,
    action,
    className,
    ...rest
  },
  ref
) {
  const classes = ["octo-ui-empty", className].filter(Boolean).join(" ");

  return (
    <div ref={ref} className={classes} {...rest}>
      {shouldRenderSlot(illustration) ? (
        <div className="octo-ui-empty__illustration">{illustration}</div>
      ) : null}
      {shouldRenderSlot(title) ? (
        <div className="octo-ui-empty__title">{title}</div>
      ) : null}
      {shouldRenderSlot(description) ? (
        <div className="octo-ui-empty__description">{description}</div>
      ) : null}
      {shouldRenderSlot(action) ? (
        <div className="octo-ui-empty__action">{action}</div>
      ) : null}
    </div>
  );
});

export default Empty;
export { Empty };
