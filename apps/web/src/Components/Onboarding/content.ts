const workspaceImage = new URL(
  "./assets/onboarding-workspace.png",
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
const createBotImage = new URL(
  "./assets/onboarding-create-bot.png",
  import.meta.url
).href;

export const ONBOARDING_STORAGE_NAMESPACE = "octo:onboarding:seen";
export const ONBOARDING_SEEN_STORAGE_KEY = ONBOARDING_STORAGE_NAMESPACE;

export type OnboardingSectionId =
  | "workspace"
  | "subspaces"
  | "favorites"
  | "group-md"
  | "smart-summary"
  | "webhook"
  | "browser-extension"
  | "create-bot";

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
  imageAltKey?: string;
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
  imageAlt: string;
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
      id: "workspace",
      labelKey: "app.onboarding.sections.organization.label",
      titleKey: "app.onboarding.sections.organization.title",
      descriptionKey: "app.onboarding.sections.organization.description",
      image: workspaceImage,
    },
    {
      id: "subspaces",
      labelKey: "app.onboarding.sections.threads.label",
      titleKey: "app.onboarding.sections.threads.title",
      descriptionKey: "app.onboarding.sections.threads.description",
      imageAltKey: "app.onboarding.sections.threads.imageAlt",
      image: subspacesImage,
    },
    {
      id: "favorites",
      labelKey: "app.onboarding.sections.following.label",
      titleKey: "app.onboarding.sections.following.title",
      descriptionKey: "app.onboarding.sections.following.description",
      imageAltKey: "app.onboarding.sections.following.imageAlt",
      image: favoritesImage,
    },
    {
      id: "group-md",
      labelKey: "app.onboarding.sections.groupMd.label",
      titleKey: "app.onboarding.sections.groupMd.title",
      descriptionKey: "app.onboarding.sections.groupMd.description",
      imageAltKey: "app.onboarding.sections.groupMd.imageAlt",
      image: groupMdImage,
    },
    {
      id: "smart-summary",
      labelKey: "app.onboarding.sections.smartSummary.label",
      titleKey: "app.onboarding.sections.smartSummary.title",
      descriptionKey: "app.onboarding.sections.smartSummary.description",
      imageAltKey: "app.onboarding.sections.smartSummary.imageAlt",
      image: smartSummaryImage,
    },
    {
      id: "webhook",
      labelKey: "app.onboarding.sections.webhook.label",
      titleKey: "app.onboarding.sections.webhook.title",
      descriptionKey: "app.onboarding.sections.webhook.description",
      imageAltKey: "app.onboarding.sections.webhook.imageAlt",
      image: webhookImage,
    },
    {
      id: "browser-extension",
      labelKey: "app.onboarding.sections.browserExtension.label",
      titleKey: "app.onboarding.sections.browserExtension.title",
      descriptionKey: "app.onboarding.sections.browserExtension.description",
      imageAltKey: "app.onboarding.sections.browserExtension.imageAlt",
      image: browserExtensionImage,
      action: {
        type: "external-link",
        labelKey: "app.onboarding.actions.installExtension",
        ariaLabelKey: "app.onboarding.actions.installExtensionAria",
        href: "https://chromewebstore.google.com/detail/octo-%E6%8F%92%E4%BB%B6%E7%89%88/nemameogpfkponoomeblkjcnbidgmndk",
      },
    },
    {
      id: "create-bot",
      labelKey: "app.onboarding.sections.createBot.label",
      titleKey: "app.onboarding.sections.createBot.title",
      descriptionKey: "app.onboarding.sections.createBot.description",
      imageAltKey: "app.onboarding.sections.createBot.imageAlt",
      image: createBotImage,
      action: {
        type: "finish",
        labelKey: "app.onboarding.actions.finish",
        completedLabelKey: "app.onboarding.actions.completed",
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

export function markOnboardingSeen(store: Pick<Storage, "setItem">) {
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
      imageAlt: section.imageAltKey ? t(section.imageAltKey) : "",
    }))
    .filter(
      (section) =>
        Boolean(section.label) &&
        Boolean(section.title) &&
        Boolean(section.description)
    );
}
