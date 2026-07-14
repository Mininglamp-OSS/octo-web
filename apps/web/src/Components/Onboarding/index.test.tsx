import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getOnboardingSeenStorageKey } from "./content";
import { Onboarding } from ".";

const { runOnboardingViewTransition } = vi.hoisted(() => ({
  runOnboardingViewTransition: vi.fn(
    ({ onTransition }: { onTransition: () => void }) => {
      onTransition();
      return true;
    }
  ),
}));

const translations: Record<string, string> = {
  "app.onboarding.dialog.introAria": "Octo onboarding introduction",
  "app.onboarding.intro.actions.skip": "Skip",
  "app.onboarding.sections.workspace.description":
    "Workspace lead\nShared context\nHuman and AI coordination",
  "app.onboarding.sections.createBot.label": "Create your Bot",
  "app.onboarding.sections.createBot.title": "Create your Bot",
  "app.onboarding.sections.createBot.description":
    "Go to BotFather, create your first Bot, and start experiencing Octo.",
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
    localStorageMock.clear();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: localStorageMock,
    });
    window.history.pushState({}, "", "/");
  });

  it("dismisses and persists the onboarding when the intro is skipped", () => {
    const onDismiss = vi.fn();

    render(<Onboarding forceVisible onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    expect(runOnboardingViewTransition).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem(getOnboardingSeenStorageKey())).toBe(
      "seen"
    );
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
        "Go to BotFather, create your first Bot, and start experiencing Octo."
      )
    ).toHaveClass("wk-onboarding-description-lead");
    expect(screen.getByRole("button", { name: "Finish" })).toBeInTheDocument();
  });
});
