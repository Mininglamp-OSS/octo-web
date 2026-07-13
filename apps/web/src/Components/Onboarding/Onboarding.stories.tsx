import type { Meta, StoryObj } from "@storybook/react-vite";
import { I18nProvider, i18n } from "@octo/base";
import appEnUS from "../../i18n/en-US.json";
import appZhCN from "../../i18n/zh-CN.json";
import { defaultOnboardingConfig, type OnboardingConfig } from "./content";
import { Onboarding } from ".";

i18n.registerNamespace("app", {
  "zh-CN": appZhCN,
  "en-US": appEnUS,
});

const shortConfig: OnboardingConfig = {
  ...defaultOnboardingConfig,
  version: "storybook-short",
  intro: {
    enabled: false,
  },
  sections: [
    defaultOnboardingConfig.sections[0],
    defaultOnboardingConfig.sections[6],
    defaultOnboardingConfig.sections[7],
  ],
};

const meta: Meta<typeof Onboarding> = {
  title: "Web/Onboarding",
  component: Onboarding,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <I18nProvider>
        <Story />
      </I18nProvider>
    ),
  ],
  args: {
    forceVisible: true,
  },
};

export default meta;
type Story = StoryObj<typeof Onboarding>;

export const Intro: Story = {
  args: {
    config: defaultOnboardingConfig,
  },
};

export const Panel: Story = {
  args: {
    config: defaultOnboardingConfig,
    skipIntro: true,
  },
};

export const ReducedContent: Story = {
  args: {
    config: shortConfig,
    skipIntro: true,
  },
};

export const MobilePanel: Story = {
  args: {
    config: shortConfig,
    skipIntro: true,
  },
  parameters: {
    viewport: {
      defaultViewport: "mobile1",
    },
  },
};
