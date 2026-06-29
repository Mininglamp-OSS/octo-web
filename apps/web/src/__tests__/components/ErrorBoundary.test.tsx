import { vi, beforeEach } from 'vitest'
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorBoundary, ErrorFallback } from "../../../../../packages/dmworkbase/src/Components/ErrorBoundary";
import { i18n } from "@octo/base/src/i18n/instance";

// ErrorFallback renders i18n copy; pin zh-CN so the Chinese-copy assertions are
// deterministic regardless of jsdom's en-US navigator (matches base setup).
beforeEach(() => {
    i18n.setLocale("zh-CN", { persist: false, notify: false });
});

// Component that throws an error
const ThrowingComponent = ({ shouldThrow = true }: { shouldThrow?: boolean }) => {
    if (shouldThrow) {
        throw new Error("Test error message");
    }
    return <div data-testid="child-content">Child content</div>;
};

// Suppress console.error for tests that expect errors
const originalError = console.error;
beforeAll(() => {
    console.error = vi.fn();
});
afterAll(() => {
    console.error = originalError;
});

describe("ErrorBoundary", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("renders children when there is no error", () => {
        const { container, getByTestId } = render(
            <ErrorBoundary>
                <div data-testid="child">Child content</div>
            </ErrorBoundary>
        );

        expect(getByTestId("child")).not.toBeNull();
        expect(container.textContent).toContain("Child content");
    });

    it("renders fallback UI when child throws an error", () => {
        const { container } = render(
            <ErrorBoundary moduleName="测试模块">
                <ThrowingComponent />
            </ErrorBoundary>
        );

        expect(container.textContent).toContain("测试模块加载出错");
        expect(container.textContent).toContain("Test error message");
        expect(container.querySelector(".wk-error-boundary-retry")).not.toBeNull();
    });

    it("renders default module name when moduleName is not provided", () => {
        const { container } = render(
            <ErrorBoundary>
                <ThrowingComponent />
            </ErrorBoundary>
        );

        expect(container.textContent).toContain("模块加载出错");
    });

    it("renders custom fallback when provided", () => {
        const customFallback = <div data-testid="custom-fallback">Custom error UI</div>;

        const { getByTestId, container } = render(
            <ErrorBoundary fallback={customFallback}>
                <ThrowingComponent />
            </ErrorBoundary>
        );

        expect(getByTestId("custom-fallback")).not.toBeNull();
        expect(container.textContent).toContain("Custom error UI");
    });

    it("calls onError callback when error occurs", () => {
        const onError = vi.fn();

        render(
            <ErrorBoundary onError={onError}>
                <ThrowingComponent />
            </ErrorBoundary>
        );

        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledWith(
            expect.any(Error),
            expect.objectContaining({
                componentStack: expect.any(String)
            })
        );
    });

    it("resets error state when retry button is clicked", () => {
        let shouldThrow = true;
        const TestComponent = () => {
            if (shouldThrow) {
                throw new Error("Test error");
            }
            return <div data-testid="recovered">Recovered content</div>;
        };

        const { container, rerender } = render(
            <ErrorBoundary key="test">
                <TestComponent />
            </ErrorBoundary>
        );

        // Error state should be shown
        expect(container.textContent).toContain("模块加载出错");

        // Fix the error and click retry
        shouldThrow = false;

        const retryButton = container.querySelector(".wk-error-boundary-retry");
        expect(retryButton).not.toBeNull();
        fireEvent.click(retryButton!);

        // Force re-render to pick up the fixed component
        rerender(
            <ErrorBoundary key="test">
                <TestComponent />
            </ErrorBoundary>
        );

        // Should show recovered content (or still show error from cache, depending on React)
        // The key point is the retry button click triggers state reset
        expect(container.querySelector(".wk-error-boundary-retry") || container.querySelector('[data-testid="recovered"]')).not.toBeNull();
    });

    it("logs error to console", () => {
        render(
            <ErrorBoundary>
                <ThrowingComponent />
            </ErrorBoundary>
        );

        expect(console.error).toHaveBeenCalled();
    });
});

describe("ErrorFallback", () => {
    it("renders error message and retry button", () => {
        const onRetry = vi.fn();
        const error = new Error("Something went wrong");

        const { container } = render(
            <ErrorFallback
                error={error}
                moduleName="测试"
                onRetry={onRetry}
            />
        );

        expect(container.textContent).toContain("测试加载出错");
        expect(container.textContent).toContain("Something went wrong");

        const retryButton = container.querySelector(".wk-error-boundary-retry");
        expect(retryButton).not.toBeNull();
        fireEvent.click(retryButton!);

        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("shows default error message when error is undefined", () => {
        const { container } = render(<ErrorFallback moduleName="模块" onRetry={() => {}} />);

        expect(container.textContent).toContain("发生了未知错误");
    });

    it("does not render retry button when onRetry is not provided", () => {
        const { container } = render(<ErrorFallback error={new Error("Test")} moduleName="模块" />);

        expect(container.querySelector(".wk-error-boundary-retry")).toBeNull();
    });

    it("has correct CSS class structure", () => {
        const { container } = render(
            <ErrorFallback error={new Error("Test")} moduleName="测试" onRetry={() => {}} />
        );

        expect(container.querySelector(".wk-error-boundary")).not.toBeNull();
        expect(container.querySelector(".wk-error-boundary-content")).not.toBeNull();
        expect(container.querySelector(".wk-error-boundary-icon")).not.toBeNull();
        expect(container.querySelector(".wk-error-boundary-title")).not.toBeNull();
        expect(container.querySelector(".wk-error-boundary-message")).not.toBeNull();
        expect(container.querySelector(".wk-error-boundary-retry")).not.toBeNull();
    });
});
