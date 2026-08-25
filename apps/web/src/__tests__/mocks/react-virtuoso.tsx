import React from "react";

type ListProps = {
  data?: readonly unknown[];
  totalCount?: number;
  itemContent?: (index: number, item: unknown) => React.ReactNode;
  children?: React.ReactNode;
  [key: string]: unknown;
};

function itemsFor({ data, totalCount }: ListProps): readonly unknown[] {
  return data ?? Array.from({ length: totalCount ?? 0 });
}

export function Virtuoso({ data, totalCount, itemContent, children, ...props }: ListProps) {
  return (
    <div {...props}>
      {itemsFor({ data, totalCount }).map((item, index) => (
        <React.Fragment key={index}>{itemContent?.(index, item)}</React.Fragment>
      ))}
      {children}
    </div>
  );
}

export function TableVirtuoso({ data, totalCount, itemContent, fixedHeaderContent, className, ...props }: ListProps & {
  fixedHeaderContent?: () => React.ReactNode;
  className?: string;
}) {
  return (
    <table className={className} {...props}>
      {fixedHeaderContent ? <thead>{fixedHeaderContent()}</thead> : null}
      <tbody>
        {itemsFor({ data, totalCount }).map((item, index) => (
          <tr key={index}>{itemContent?.(index, item)}</tr>
        ))}
      </tbody>
    </table>
  );
}

export default { Virtuoso, TableVirtuoso };
