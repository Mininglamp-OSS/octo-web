import React, { useLayoutEffect, type ReactNode } from "react";

export function NavigationCommitBoundary({
  children, onCommit,
}: {
  children: ReactNode;
  onCommit: () => void;
}) {
  useLayoutEffect(onCommit, [onCommit]);
  return <>{children}</>;
}
