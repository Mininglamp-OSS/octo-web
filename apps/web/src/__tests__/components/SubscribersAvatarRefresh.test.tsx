import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Subscribers } from "../../../../../packages/dmworkbase/src/Components/Subscribers";

vi.mock("wukongimjssdk", () => {
  class Channel {
    channelID: string;
    channelType: number;

    constructor(channelID: string, channelType: number) {
      this.channelID = channelID;
      this.channelType = channelType;
    }
  }

  return {
    Channel,
    ChannelTypePerson: 1,
  };
});

vi.mock("../../../../../packages/dmworkbase/src/App", () => ({
  default: {
    shared: {
      baseContext: { showUserInfo: vi.fn() },
      avatarUser: vi.fn(() => "stale-avatar.png"),
    },
  },
}));

vi.mock(
  "../../../../../packages/dmworkbase/src/Components/WKAvatar",
  () => ({
    default: ({ channel }: any) => (
      <img
        data-testid="subscriber-avatar"
        data-channel-id={channel.channelID}
        data-channel-type={channel.channelType}
        alt=""
      />
    ),
  })
);

vi.mock("../../../../../packages/dmworkbase/src/Service/Provider", () => ({
  default: () => null,
}));
vi.mock(
  "../../../../../packages/dmworkbase/src/Components/Subscribers/vm",
  () => ({ SubscribersVM: class {} })
);
vi.mock(
  "../../../../../packages/dmworkbase/src/Components/IndexTable",
  () => ({ default: () => null, IndexTableItem: class {} })
);
vi.mock("../../../../../packages/dmworkbase/src/Components/WKBase", () => ({
  default: () => null,
}));
vi.mock("../../../../../packages/dmworkbase/src/Service/Context", () => ({
  default: class {},
}));
vi.mock(
  "../../../../../packages/dmworkbase/src/Components/Subscribers/list",
  () => ({ SubscriberList: () => null })
);
vi.mock(
  "../../../../../packages/dmworkbase/src/Utils/externalViewer",
  () => ({ resolveExternalForViewer: () => ({ isExternal: false }) })
);
vi.mock(
  "../../../../../packages/dmworkbase/src/Utils/displayName",
  () => ({ isRealnameVerified: () => false })
);
vi.mock("../../../../../packages/dmworkbase/src/Service/Const", () => ({
  GroupRole: { owner: 1, manager: 2 },
}));
vi.mock(
  "../../../../../packages/dmworkbase/src/Components/RealnameVerifiedBadge",
  () => ({ default: () => null })
);
vi.mock("../../../../../packages/dmworkbase/src/i18n", async () => {
  const React = await import("react");
  return {
    I18nContext: React.createContext({ t: (key: string) => key }),
  };
});
vi.mock(
  "../../../../../packages/dmworkbase/src/features/channelSetting/channelSettingMemberSearch",
  () => ({ createChannelSettingMemberSearch: vi.fn() })
);

describe("Subscribers member preview avatar", () => {
  it("passes the member person channel to WKAvatar for live refresh", () => {
    const subscribers = new Subscribers({
      context: {} as any,
      channel: {},
    });

    render(
      subscribers.subscriberUI({
        uid: "bot-1170",
        name: "Bot",
        role: 0,
        orgData: {},
      } as any)
    );

    expect(screen.getByTestId("subscriber-avatar")).toHaveAttribute(
      "data-channel-id",
      "bot-1170"
    );
    expect(screen.getByTestId("subscriber-avatar")).toHaveAttribute(
      "data-channel-type",
      "1"
    );
  });
});
