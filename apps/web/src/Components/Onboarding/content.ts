const workspaceMapImage = new URL(
  "./assets/onboarding-workspace-map.png",
  import.meta.url
).href;
const subspacesImage = new URL(
  "./assets/onboarding-subspaces.png",
  import.meta.url
).href;
const favoritesImage = new URL(
  "./assets/onboarding-favorites.png",
  import.meta.url
).href;
const groupMdImage = new URL(
  "./assets/onboarding-group-md.png",
  import.meta.url
).href;
const smartSummaryImage = new URL(
  "./assets/onboarding-smart-summary.png",
  import.meta.url
).href;
const browserExtensionImage = new URL(
  "./assets/onboarding-browser-extension.png",
  import.meta.url
).href;
const webhookImage = new URL("./assets/onboarding-webhook.png", import.meta.url)
  .href;
const aiAvatarImage = new URL(
  "./assets/octo-logo-white-symbol.png",
  import.meta.url
).href;

export const ONBOARDING_STORAGE_NAMESPACE = "octo:onboarding:seen";
export const ONBOARDING_SEEN_STORAGE_KEY = ONBOARDING_STORAGE_NAMESPACE;

export type OnboardingSectionId =
  | "workspace-map"
  | "subspaces"
  | "favorites"
  | "group-md"
  | "smart-summary"
  | "webhook"
  | "browser-extension"
  | "ai-avatar";

export type OnboardingAction =
  | {
      type: "external-link";
      labelKey: string;
      ariaLabelKey: string;
      href: string;
    }
  | {
      type: "finish";
      labelKey: string;
      completedLabelKey: string;
    };

export type OnboardingSection = {
  id: OnboardingSectionId;
  enabled?: boolean;
  labelKey: string;
  titleKey: string;
  descriptionKey: string;
  visualTitleKey: string;
  image: string;
  imageFit?: "cover" | "contain";
  action?: OnboardingAction;
};

export type OnboardingConfig = {
  version: string;
  enabled: boolean;
  intro: {
    enabled: boolean;
  };
  links: {
    openSourceUrl: string;
    aboutMininglampUrl: {
      zhCN: string;
      enUS: string;
    };
  };
  sections: OnboardingSection[];
};

export type ResolvedOnboardingSection = OnboardingSection & {
  label: string;
  title: string;
  description: string;
  visualTitle: string;
};

type TranslateFn = (key: string) => string;

export const defaultOnboardingConfig: OnboardingConfig = {
  version: "v1",
  enabled: true,
  intro: {
    enabled: true,
  },
  links: {
    openSourceUrl: "https://github.com/Mininglamp-OSS",
    aboutMininglampUrl: {
      zhCN: "https://www.mininglamp.com/about/",
      enUS: "https://www.mininglamp.com/en/about/",
    },
  },
  sections: [
    {
      id: "workspace-map",
      labelKey: "app.onboarding.sections.workspace.label",
      titleKey: "app.onboarding.sections.workspace.title",
      descriptionKey: "app.onboarding.sections.workspace.description",
      visualTitleKey: "app.onboarding.sections.workspace.visualTitle",
      image: workspaceMapImage,
    },
    {
      id: "subspaces",
      labelKey: "app.onboarding.sections.subspaces.label",
      titleKey: "app.onboarding.sections.subspaces.title",
      descriptionKey: "app.onboarding.sections.subspaces.description",
      visualTitleKey: "app.onboarding.sections.subspaces.visualTitle",
      image: subspacesImage,
    },
    {
      id: "favorites",
      labelKey: "app.onboarding.sections.favorites.label",
      titleKey: "app.onboarding.sections.favorites.title",
      descriptionKey: "app.onboarding.sections.favorites.description",
      visualTitleKey: "app.onboarding.sections.favorites.visualTitle",
      image: favoritesImage,
    },
    {
      id: "group-md",
      labelKey: "app.onboarding.sections.groupMd.label",
      titleKey: "app.onboarding.sections.groupMd.title",
      descriptionKey: "app.onboarding.sections.groupMd.description",
      visualTitleKey: "app.onboarding.sections.groupMd.visualTitle",
      image: groupMdImage,
    },
    {
      id: "smart-summary",
      labelKey: "app.onboarding.sections.smartSummary.label",
      titleKey: "app.onboarding.sections.smartSummary.title",
      descriptionKey: "app.onboarding.sections.smartSummary.description",
      visualTitleKey: "app.onboarding.sections.smartSummary.visualTitle",
      image: smartSummaryImage,
    },
    {
      id: "webhook",
      labelKey: "app.onboarding.sections.webhook.label",
      titleKey: "app.onboarding.sections.webhook.title",
      descriptionKey: "app.onboarding.sections.webhook.description",
      visualTitleKey: "app.onboarding.sections.webhook.visualTitle",
      image: webhookImage,
    },
    {
      id: "browser-extension",
      labelKey: "app.onboarding.sections.browserExtension.label",
      titleKey: "app.onboarding.sections.browserExtension.title",
      descriptionKey: "app.onboarding.sections.browserExtension.description",
      visualTitleKey: "app.onboarding.sections.browserExtension.visualTitle",
      image: browserExtensionImage,
      action: {
        type: "external-link",
        labelKey: "app.onboarding.actions.installExtension",
        ariaLabelKey: "app.onboarding.actions.installExtensionAria",
        href: "https://chromewebstore.google.com/detail/octo-%E6%8F%92%E4%BB%B6%E7%89%88/nemameogpfkponoomeblkjcnbidgmndk",
      },
    },
    {
      id: "ai-avatar",
      labelKey: "app.onboarding.sections.aiAvatar.label",
      titleKey: "app.onboarding.sections.aiAvatar.title",
      descriptionKey: "app.onboarding.sections.aiAvatar.description",
      visualTitleKey: "app.onboarding.sections.aiAvatar.visualTitle",
      image: aiAvatarImage,
      imageFit: "contain",
      action: {
        type: "finish",
        labelKey: "app.onboarding.actions.finish",
        completedLabelKey: "app.onboarding.actions.finished",
      },
    },
  ],
};

export function getOnboardingSeenStorageKey() {
  return ONBOARDING_SEEN_STORAGE_KEY;
}

export function shouldShowOnboarding(
  config: OnboardingConfig,
  store: Pick<Storage, "getItem">
) {
  if (!config.enabled) return false;
  return store.getItem(getOnboardingSeenStorageKey()) !== "seen";
}

export function markOnboardingSeen(
  store: Pick<Storage, "setItem">
) {
  store.setItem(getOnboardingSeenStorageKey(), "seen");
}

export function resolveOnboardingSections(
  config: OnboardingConfig,
  t: TranslateFn
): ResolvedOnboardingSection[] {
  if (!config.enabled) return [];

  return config.sections
    .filter((section) => section.enabled !== false)
    .filter((section) => Boolean(section.id && section.image))
    .map((section) => ({
      ...section,
      label: t(section.labelKey),
      title: t(section.titleKey),
      description: t(section.descriptionKey),
      visualTitle: t(section.visualTitleKey),
    }))
    .filter(
      (section) =>
        Boolean(section.label) &&
        Boolean(section.title) &&
        Boolean(section.description) &&
        Boolean(section.visualTitle)
    );
}
