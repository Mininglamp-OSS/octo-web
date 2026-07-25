import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultOnboardingConfig,
  getOnboardingSeenStorageKey,
} from "./content";
import { Onboarding } from ".";

const { runOnboardingViewTransition, viewTransitionState } = vi.hoisted(() => {
  const viewTransitionState: { onFinished?: () => void } = {};

  return {
    viewTransitionState,
    runOnboardingViewTransition: vi.fn(
      ({
        onFinished,
        onTransition,
      }: {
        onFinished?: () => void;
        onTransition: () => void;
      }) => {
        viewTransitionState.onFinished = onFinished;
        onTransition();
        return true;
      }
    ),
  };
});

const translations: Record<string, string> = {
  "app.onboarding.dialog.introAria": "Octo onboarding introduction",
  "app.onboarding.intro.actions.skip": "Skip",
  "app.onboarding.sections.workspace.description":
    "Workspace lead\nShared context\nHuman and AI coordination",
  "app.onboarding.sections.createBot.label": "Create your Bot",
  "app.onboarding.sections.createBot.title": "Create your Bot",
  "app.onboarding.sections.createBot.description":
    "Create your first Bot in BotFather and start using Octo.",
  "app.onboarding.sections.createBot.visualTitle":
    "Cursor hovering over the BotFather entry",
  "app.onboarding.actions.finish": "Finish",
  "app.onboarding.actions.completed": "Completed",
};

const storageValues = new Map<string, string>();
const localStorageMock = {
  get length() {
    return storageValues.size;
  },
  clear: () => storageValues.clear(),
  getItem: (key: string) => storageValues.get(key) ?? null,
  key: (index: number) => Array.from(storageValues.keys())[index] ?? null,
  removeItem: (key: string) => storageValues.delete(key),
  setItem: (key: string, value: string) => storageValues.set(key, value),
};

vi.mock("@octo/base", () => ({
  useI18n: () => ({
    locale: "en-US",
    t: (key: string) => translations[key] ?? key,
  }),
}));

vi.mock("./Intro", () => ({
  OnboardingIntro: ({ onSkip }: { onSkip: () => void }) => (
    <button type="button" onClick={onSkip}>
      Skip
    </button>
  ),
}));

vi.mock("./viewTransition", () => ({
  runOnboardingViewTransition,
}));

describe("Onboarding", () => {
  beforeEach(() => {
    runOnboardingViewTransition.mockClear();
    delete viewTransitionState.onFinished;
    localStorageMock.clear();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: localStorageMock,
    });
    window.history.pushState({}, "", "/");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("hides but keeps the intro mounted during the skip transition until it finishes", () => {
    const onDismiss = vi.fn();

    render(<Onboarding forceVisible onDismiss={onDismiss} />);
    const introDialog = screen.getByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    expect(runOnboardingViewTransition).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem(getOnboardingSeenStorageKey())).toBe(
      "seen"
    );
    expect(onDismiss).not.toHaveBeenCalled();
    expect(introDialog).toBeInTheDocument();
    expect(introDialog).toHaveAttribute("aria-hidden", "true");
    expect(introDialog).toHaveClass("is-skip-transition-target");

    act(() => viewTransitionState.onFinished?.());

    expect(onDismiss).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the timed intro skip fallback when view transitions are unavailable", () => {
    vi.useFakeTimers();
    runOnboardingViewTransition.mockImplementationOnce(() => false);
    const onDismiss = vi.fn();

    render(<Onboarding forceVisible onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(620));

    expect(onDismiss).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the white directory copy as a lead and supporting lines", () => {
    render(<Onboarding forceVisible skipIntro />);

    expect(screen.getByText("Workspace lead")).toHaveClass(
      "wk-onboarding-description-lead"
    );
    expect(screen.getByText("Shared context")).toHaveClass(
      "wk-onboarding-description-support-line"
    );
    expect(screen.getByText("Human and AI coordination")).toHaveClass(
      "wk-onboarding-description-support-line"
    );
  });

  it("preloads the remaining directory images after the first image renders", () => {
    vi.useFakeTimers();
    const preloadedSources: string[] = [];

    class MockImage {
      decoding = "auto";

      set src(value: string) {
        preloadedSources.push(value);
      }

      decode() {
        return Promise.resolve();
      }
    }

    vi.stubGlobal("Image", MockImage);

    const config = {
      ...defaultOnboardingConfig,
      intro: { enabled: false },
      sections: defaultOnboardingConfig.sections
        .slice(0, 2)
        .map((section, index) => ({
          ...section,
          image: `https://example.test/onboarding-${index + 1}.png`,
        })),
    };

    render(<Onboarding forceVisible config={config} />);
    act(() => vi.runOnlyPendingTimers());

    expect(preloadedSources).toEqual(["https://example.test/onboarding-2.png"]);
  });

  it("uses the BotFather image page as the final directory section", () => {
    render(<Onboarding forceVisible skipIntro />);

    fireEvent.click(screen.getByRole("button", { name: /Create your Bot/ }));

    expect(
      screen.getByRole("heading", { name: "Create your Bot" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: "Cursor hovering over the BotFather entry",
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Create your first Bot in BotFather and start using Octo."
      )
    ).toHaveClass("wk-onboarding-description-lead");
    expect(screen.getByRole("button", { name: "Finish" })).toBeInTheDocument();
  });
});
