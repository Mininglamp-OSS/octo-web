import React from "react";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import SummaryEditor from "./SummaryEditor";
import * as api from "../api/summaryApi";

vi.mock("@douyinfe/semi-ui", () => ({
    Button: ({ children, onClick, disabled, loading, theme, ...rest }: any) => (
        <button
            onClick={onClick}
            disabled={disabled}
            data-loading={loading}
            data-theme={theme}
            {...rest}
        >
            {children}
        </button>
    ),
    Toast: {
        success: vi.fn(),
        error: vi.fn(),
        warning: vi.fn(),
    },
}));

vi.mock("../api/summaryApi");

const mockApi = vi.mocked(api);

function render(ui: React.ReactElement, options?: any) {
    return rtlRender(ui, { legacyRoot: true, ...options });
}

describe("SummaryEditor", () => {
    const defaultProps = {
        taskId: 1,
        baseResultId: 456,
        initialContent: "Original content",
        onSave: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("renders textarea with initial content", () => {
        render(<SummaryEditor {...defaultProps} />);
        const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
        expect(textarea.value).toBe("Original content");
    });

    it("calls editSummary and onSave on successful save", async () => {
        mockApi.editSummary.mockResolvedValue({ edited_at: "2026-05-08T14:30:00Z" });
        let save: (() => void) | null = null;
        render(<SummaryEditor {...defaultProps} exposeSave={(fn) => { save = fn; }} />);

        const textarea = screen.getByRole("textbox");
        fireEvent.change(textarea, { target: { value: "Updated content" } });
        save!();

        await waitFor(() => {
            expect(mockApi.editSummary).toHaveBeenCalledWith(1, "Updated content", 456);
            expect(defaultProps.onSave).toHaveBeenCalledTimes(1);
        });
    });

    it("shows warning and calls onSave on 409 conflict", async () => {
        const error = new Error("conflict") as Error & { status?: number };
        error.status = 409;
        mockApi.editSummary.mockRejectedValue(error);

        const { Toast } = await import("@douyinfe/semi-ui");
        let save: (() => void) | null = null;
        render(<SummaryEditor {...defaultProps} exposeSave={(fn) => { save = fn; }} />);

        const textarea = screen.getByRole("textbox");
        fireEvent.change(textarea, { target: { value: "Updated content" } });
        save!();

        await waitFor(() => {
            expect(Toast.warning).toHaveBeenCalledWith("内容已更新，请刷新");
            expect(defaultProps.onSave).toHaveBeenCalledTimes(1);
        });
    });

    it("shows error toast and keeps content on 5xx error", async () => {
        const error = new Error("服务器错误") as Error & { status?: number };
        error.status = 500;
        mockApi.editSummary.mockRejectedValue(error);

        const { Toast } = await import("@douyinfe/semi-ui");
        let save: (() => void) | null = null;
        render(<SummaryEditor {...defaultProps} exposeSave={(fn) => { save = fn; }} />);

        const textarea = screen.getByRole("textbox");
        fireEvent.change(textarea, { target: { value: "Updated content" } });
        save!();

        await waitFor(() => {
            expect(Toast.error).toHaveBeenCalledWith("服务器错误");
            expect(defaultProps.onSave).not.toHaveBeenCalled();
        });

        const updatedTextarea = screen.getByRole("textbox") as HTMLTextAreaElement;
        expect(updatedTextarea.value).toBe("Updated content");
    });

    it("disables textarea and buttons while saving", async () => {
        let resolvePromise: (value: { edited_at: string }) => void;
        mockApi.editSummary.mockImplementation(
            () => new Promise((resolve) => { resolvePromise = resolve; }),
        );

        let save: (() => void) | null = null;
        render(<SummaryEditor {...defaultProps} exposeSave={(fn) => { save = fn; }} />);

        const textarea = screen.getByRole("textbox");
        fireEvent.change(textarea, { target: { value: "Updated" } });
        save!();

        await waitFor(() => {
            expect(textarea).toBeDisabled();
        });

        resolvePromise!({ edited_at: "2026-05-08T14:30:00Z" });
    });
});
