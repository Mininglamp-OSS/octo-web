/** @vitest-environment jsdom */
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  secretsPanelProps: [] as any[],
}));

vi.mock("@octo/ui", () => ({
  Modal: ({ children, visible }: any) =>
    visible ? <div data-testid="octo-modal">{children}</div> : null,
  __esModule: true,
}));

vi.mock("../../../Runtime", () => ({
  detectRuntimeEnvironment: () => ({
    target: "web",
    shell: null,
    os: "unknown",
    capabilities: new Set(),
  }),
}));

vi.mock("../../../Service/VoiceSettingsStore", () => ({
  shouldShowVoiceShortcuts: () => true,
  voiceSettingsStore: {
    get: () => ({ enabled: true }),
    subscribe: () => () => undefined,
  },
}));

vi.mock("../settingsRegistry", () => ({
  getAvailableSettingsGroups: () => [
    {
      titleKey: "settings",
      items: [
        { id: "general", labelKey: "general" },
        { id: "account", labelKey: "account" },
      ],
    },
  ],
}));

vi.mock("../settingsPages", () => ({
  getVoiceOs: () => "unknown",
  SettingsPage: ({ item }: any) => <div data-testid="settings-page">{item?.id}</div>,
}));

vi.mock("../../SecretsSettings/SecretsSettingsPanel", () => ({
  default: (props: any) => {
    hoisted.secretsPanelProps.push(props);
    return <div data-testid="secrets-panel" />;
  },
  __esModule: true,
}));

import SettingsCenter from "../SettingsCenter";

let container: HTMLDivElement;

beforeEach(() => {
  hoisted.secretsPanelProps.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => ReactDOM.unmountComponentAtNode(container));
  container.remove();
});

describe("SettingsCenter secrets deep link", () => {
  it("keeps a pending create request when the settings center opens after the event", async () => {
    const request = {
      create: true,
      name: "Claude",
      value: "sk-test",
      sequence: 1,
    };

    act(() => {
      ReactDOM.render(
        <SettingsCenter visible={false} onClose={vi.fn()} openSecretsRequest={request} />,
        container
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="secrets-panel"]')).toBeNull();

    act(() => {
      ReactDOM.render(
        <SettingsCenter visible onClose={vi.fn()} openSecretsRequest={request} />,
        container
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="secrets-panel"]')).not.toBeNull();
    expect(hoisted.secretsPanelProps.at(-1)).toEqual(
      expect.objectContaining({
        embedded: true,
        initialCreate: true,
        prefillName: "Claude",
        prefillValue: "sk-test",
      })
    );
  });

  it("clears a pending request when the settings center closes", async () => {
    const onSecretsClosed = vi.fn();
    const request = {
      create: true,
      name: "Claude",
      value: "sk-test",
      sequence: 1,
    };

    act(() => {
      ReactDOM.render(
        <SettingsCenter
          visible
          onClose={vi.fn()}
          onSecretsClosed={onSecretsClosed}
          openSecretsRequest={request}
        />,
        container
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="secrets-panel"]')).not.toBeNull();

    act(() => {
      ReactDOM.render(
        <SettingsCenter
          visible={false}
          onClose={vi.fn()}
          onSecretsClosed={onSecretsClosed}
          openSecretsRequest={request}
        />,
        container
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(onSecretsClosed).toHaveBeenCalled();

    act(() => {
      ReactDOM.render(
        <SettingsCenter
          visible
          onClose={vi.fn()}
          onSecretsClosed={onSecretsClosed}
          openSecretsRequest={null}
        />,
        container
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="secrets-panel"]')).toBeNull();
  });
});
