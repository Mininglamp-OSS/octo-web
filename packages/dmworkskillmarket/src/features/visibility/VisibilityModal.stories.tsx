import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import VisibilityModal from "./VisibilityModal";
const meta: Meta<typeof VisibilityModal> = {
  title: "Marketplace/VisibilityModal",
  component: VisibilityModal,
  parameters: {
    docs: {
      description: {
        component:
          "Audience changes use a separately reviewed operation on the existing published version. Use a local authenticated integration resource to preview the live state.",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof meta>;
export const Closed: Story = {
  args: { pluginId: null, onClose: () => undefined, onSaved: () => undefined },
};
export const LiveResource: Story = {
  args: {
    pluginId: "local-integration-plugin-id",
    onClose: () => undefined,
    onSaved: () => undefined,
  },
};
