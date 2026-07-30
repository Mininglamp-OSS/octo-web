/**
 * SummaryVersionPanel test — ports the meaningful assertions from the deleted
 * SummaryVersionHistory suite (yujiawei round-9 P2-3 asked for the coverage
 * to move with the rename), plus the retention hint + null-render + restore
 * gate behaviours yujiawei called out explicitly.
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Semi-ui stubs — pass-through so nothing depends on the real render surface.
vi.mock("@douyinfe/semi-ui", () => ({
    Button: ({ children, onClick, disabled, loading, className }: any) => (
        <button
            data-testid={typeof children === "string" ? `btn-${children}` : "btn"}
            onClick={onClick}
            disabled={disabled || loading}
            className={className}
        >
            {children}
        </button>
    ),
    Tag: ({ children }: any) => <span data-testid="tag">{children}</span>,
}));

vi.mock("@douyinfe/semi-icons", () => ({
    IconHistory: () => <span data-testid="icon-history" />,
    IconClose: () => <span data-testid="icon-close" />,
}));

vi.mock("lucide-react", () => ({
    ChevronRight: () => <span data-testid="chevron" />,
}));

vi.mock("@octo/base", () => ({
    useI18n: () => ({
        t: (key: string, opts?: { values?: Record<string, unknown> }) => {
            if (opts?.values) {
                let out = key;
                for (const [k, v] of Object.entries(opts.values)) {
                    out += `[${k}=${v}]`;
                }
                return out;
            }
            return key;
        },
    }),
}));

vi.mock("../utils/summaryHelpers", () => ({
    formatDate: (v: any) => `date:${v ?? ""}`,
}));

import SummaryVersionPanel from "./SummaryVersionPanel";
import type { SummaryVersionItem } from "../types/summary";

function makeVersion(overrides: Partial<SummaryVersionItem> = {}): SummaryVersionItem {
    return {
        result_id: 1,
        version: 1,
        operation_type: "generate",
        operation_note: "",
        generated_at: "2026-01-01T10:00:00Z",
        created_by: "u-alice",
        ...overrides,
    } as SummaryVersionItem;
}

const noopHandlers = {
    onClose: () => undefined,
    onSelect: () => undefined,
    onRestore: () => undefined,
};

describe("SummaryVersionPanel", () => {
    it("renders nothing when open=false", () => {
        const { container } = render(
            <SummaryVersionPanel
                open={false}
                versions={[makeVersion({ result_id: 1 }), makeVersion({ result_id: 2, version: 2 })]}
                currentVersion={2}
                selectedResultId={null}
                restoringResultId={null}
                canRestore
                {...noopHandlers}
            />,
        );
        expect(container.innerHTML).toBe("");
    });

    it("renders nothing when versions has <= 1 entry", () => {
        const { container } = render(
            <SummaryVersionPanel
                open
                versions={[makeVersion({ result_id: 1 })]}
                currentVersion={1}
                selectedResultId={null}
                restoringResultId={null}
                canRestore
                {...noopHandlers}
            />,
        );
        expect(container.innerHTML).toBe("");
    });

    it("shows the retention hint interpolating the number", () => {
        render(
            <SummaryVersionPanel
                open
                versions={[
                    makeVersion({ result_id: 1, version: 1 }),
                    makeVersion({ result_id: 2, version: 2 }),
                ]}
                currentVersion={2}
                selectedResultId={null}
                restoringResultId={null}
                canRestore
                retention={20}
                {...noopHandlers}
            />,
        );
        expect(screen.getByText(/summary\.detail\.versionRetentionHint\[count=20\]/)).toBeTruthy();
    });

    it("hides the restore CTA when the selected version is the current one", () => {
        render(
            <SummaryVersionPanel
                open
                versions={[
                    makeVersion({ result_id: 1, version: 1 }),
                    makeVersion({ result_id: 2, version: 2 }),
                ]}
                currentVersion={2}
                selectedResultId={2}
                restoringResultId={null}
                canRestore
                {...noopHandlers}
            />,
        );
        expect(screen.queryByText(/summary\.detail\.restoreVersion/)).toBeNull();
    });

    it("hides the restore CTA when canRestore is false, even on a non-current selection", () => {
        render(
            <SummaryVersionPanel
                open
                versions={[
                    makeVersion({ result_id: 1, version: 1 }),
                    makeVersion({ result_id: 2, version: 2 }),
                ]}
                currentVersion={2}
                selectedResultId={1}
                restoringResultId={null}
                canRestore={false}
                {...noopHandlers}
            />,
        );
        expect(screen.queryByText(/summary\.detail\.restoreVersion/)).toBeNull();
    });

    it("shows the restore CTA and wires it to the selected non-current version", () => {
        const onRestore = vi.fn();
        render(
            <SummaryVersionPanel
                open
                versions={[
                    makeVersion({ result_id: 1, version: 1 }),
                    makeVersion({ result_id: 2, version: 2 }),
                ]}
                currentVersion={2}
                selectedResultId={1}
                restoringResultId={null}
                canRestore
                {...noopHandlers}
                onRestore={onRestore}
            />,
        );
        const cta = screen.getByText(/summary\.detail\.restoreVersion/);
        fireEvent.click(cta);
        expect(onRestore).toHaveBeenCalledTimes(1);
        expect(onRestore.mock.calls[0][0].result_id).toBe(1);
    });

    it("disables the restore CTA while a restore is in flight", () => {
        render(
            <SummaryVersionPanel
                open
                versions={[
                    makeVersion({ result_id: 1, version: 1 }),
                    makeVersion({ result_id: 2, version: 2 }),
                ]}
                currentVersion={2}
                selectedResultId={1}
                restoringResultId={1}
                canRestore
                {...noopHandlers}
            />,
        );
        const cta = screen.getByText(/summary\.detail\.restoreVersion/).closest("button")!;
        expect(cta).toBeTruthy();
        expect(cta.disabled).toBe(true);
    });
});
