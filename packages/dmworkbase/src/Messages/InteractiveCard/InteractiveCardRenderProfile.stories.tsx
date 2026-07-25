import React, { useEffect, useRef } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import "@mlt-org/octo-card-profile-octo-chat/theme.css";
import "@mlt-org/octo-card-profile-octo-chat/styles.css";
import decisionCard from "./fixtures/decision-0.2.json";
import docsLegacyCard from "./fixtures/docs-access-0.2.json";
import docsForgeCard from "./fixtures/docs-access-0.3.json";
import {
  cardMountRootClass,
  type ResolvedCardRenderProfile,
} from "./renderProfile";
import { renderOctoCard } from "./sdk/renderOctoCard";
import "./index.css";
import "./InteractiveCardRenderProfile.stories.css";

interface PreviewProps {
  card: Record<string, unknown>;
  label: string;
  profile: ResolvedCardRenderProfile;
  width: number;
}

function CardPreview({ card, label, profile, width }: PreviewProps) {
  const targetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    renderOctoCard({
      card,
      target,
      renderProfile: profile,
      onAction: () => {},
    });
  }, [card, profile]);

  return (
    <section className="wk-card-profile-story-item">
      <span className="wk-card-profile-story-label">
        {label} · {width}px
      </span>
      <div
        className={`wk-card-profile-story-preview ${cardMountRootClass(
          profile
        )}`}
        ref={targetRef}
        style={{ width }}
      />
    </section>
  );
}

interface StoryArgs {
  width: 320 | 480 | 640;
}

const meta: Meta<StoryArgs> = {
  title: "Messages/InteractiveCard/Render Profile",
  parameters: { layout: "padded" },
  args: { width: 480 },
  argTypes: {
    width: { control: "inline-radio", options: [320, 480, 640] },
  },
};

export default meta;
type Story = StoryObj<StoryArgs>;

export const LegacyCompatibility: Story = {
  render: ({ width }) => (
    <CardPreview
      card={docsLegacyCard}
      label="Legacy docs 0.2"
      profile="legacy"
      width={width}
    />
  ),
};

export const DecisionForgeProfile: Story = {
  render: ({ width }) => (
    <CardPreview
      card={decisionCard}
      label="Decision 0.2 · octo-chat/v1"
      profile="octo-chat/v1"
      width={width}
    />
  ),
};

export const DocsForgeProfile: Story = {
  render: ({ width }) => (
    <CardPreview
      card={docsForgeCard}
      label="Docs access 0.3 · octo-chat/v1"
      profile="octo-chat/v1"
      width={width}
    />
  ),
};
