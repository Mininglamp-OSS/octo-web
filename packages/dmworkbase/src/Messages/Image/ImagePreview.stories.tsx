import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ImagePreviewLightbox, type ImagePreviewSlide } from "./ImagePreview";
import { I18nProvider } from "../../i18n";

// Self-contained fixtures: browser verification never depends on a remote CDN.
const previewSlides: ImagePreviewSlide[] = [
  "#4062bb",
  "#8b5e34",
  "#207868",
].map((fill, index) => ({
  src: `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="${fill}"/><text x="400" y="280" text-anchor="middle" font-size="120" fill="white">${
      index + 1
    }</text></svg>`
  )}`,
  alt: `Sample ${index + 1}`,
  filename: `sample-${index + 1}.svg`,
  width: 800,
  height: 500,
}));

function PreviewExample({ single = false }: { single?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <I18nProvider>
      <button onClick={() => setOpen(true)}>Open image preview</button>
      <ImagePreviewLightbox
        open={open}
        close={() => setOpen(false)}
        slides={single ? previewSlides.slice(0, 1) : previewSlides}
        index={single ? 0 : 1}
        showCounter
      />
    </I18nProvider>
  );
}

const meta: Meta = {
  title: "Messages/ImagePreview",
  component: PreviewExample,
};
export default meta;
type Story = StoryObj<typeof PreviewExample>;

export const Gallery: Story = {};
export const Single: Story = { args: { single: true } };
