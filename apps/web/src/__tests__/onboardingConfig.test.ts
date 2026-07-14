import { describe, expect, it } from "vitest";
import {
  defaultOnboardingConfig,
  getOnboardingSeenStorageKey,
  markOnboardingSeen,
  resolveOnboardingSections,
  shouldShowOnboarding,
  type OnboardingConfig,
} from "../Components/Onboarding/content";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem"> {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function makeConfig(
  overrides: Partial<OnboardingConfig> = {}
): OnboardingConfig {
  return {
    ...defaultOnboardingConfig,
    version: "test-v1",
    sections: defaultOnboardingConfig.sections.slice(0, 2),
    ...overrides,
  };
}

describe("onboarding config visibility", () => {
  it("shows once per browser storage", () => {
    const store = new MemoryStorage();
    const config = makeConfig();

    expect(shouldShowOnboarding(config, store)).toBe(true);

    markOnboardingSeen(store);

    expect(shouldShowOnboarding(config, store)).toBe(false);
    expect(shouldShowOnboarding({ ...config, version: "test-v2" }, store)).toBe(
      false
    );
  });

  it("uses one storage key even when uid is missing", () => {
    const store = new MemoryStorage();
    const config = makeConfig();
    const key = getOnboardingSeenStorageKey();

    markOnboardingSeen(store);

    expect(store.getItem(key)).toBe("seen");
    expect(shouldShowOnboarding(config, store)).toBe(false);
  });

  it("does not show when config is disabled", () => {
    const store = new MemoryStorage();
    const config = makeConfig({ enabled: false });

    expect(shouldShowOnboarding(config, store)).toBe(false);
  });
});

describe("resolveOnboardingSections", () => {
  it("returns translated enabled sections and drops disabled or invalid sections", () => {
    const config = makeConfig({
      sections: [
        {
          ...defaultOnboardingConfig.sections[0],
          labelKey: "label.valid",
          titleKey: "title.valid",
          descriptionKey: "description.valid",
          visualTitleKey: "visual.valid",
        },
        {
          ...defaultOnboardingConfig.sections[1],
          enabled: false,
        },
        {
          ...defaultOnboardingConfig.sections[0],
          id: "favorites",
          image: "",
        },
        {
          ...defaultOnboardingConfig.sections[0],
          id: "group-md",
          titleKey: "title.missing",
        },
      ],
    });
    const translations: Record<string, string> = {
      "label.valid": "Label",
      "title.valid": "Title",
      "description.valid": "Description",
      "visual.valid": "Visual title",
    };

    const sections = resolveOnboardingSections(
      config,
      (key) => translations[key] ?? ""
    );

    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({
      id: "workspace",
      label: "Label",
      title: "Title",
      description: "Description",
      visualTitle: "Visual title",
    });
  });

  it("keeps the white directory sections in their intended order", () => {
    expect(
      defaultOnboardingConfig.sections.map((section) => section.id)
    ).toEqual([
      "workspace",
      "subspaces",
      "favorites",
      "group-md",
      "smart-summary",
      "webhook",
      "browser-extension",
      "create-bot",
    ]);
    expect(defaultOnboardingConfig.sections.at(-1)?.action?.type).toBe(
      "finish"
    );
  });
});
