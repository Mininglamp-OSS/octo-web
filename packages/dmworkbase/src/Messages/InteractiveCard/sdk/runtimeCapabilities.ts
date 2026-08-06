export interface WebRuntimeCapability {
  id: string;
  version: number;
  effects: readonly string[];
  status: "supported" | "planned";
}

/** Web-owned local behavior registry. Keep this separate from Render Profile capabilities. */
export const WEB_RUNTIME_CAPABILITIES: readonly WebRuntimeCapability[] = [
  {
    id: "message.send.current_user",
    version: 1,
    effects: ["send_current_user_message", "append_user_message"],
    status: "supported",
  },
  {
    id: "clipboard.write",
    version: 1,
    effects: ["write_clipboard"],
    status: "planned",
  },
  {
    id: "composer.insert",
    version: 1,
    effects: ["insert_composer_text"],
    status: "planned",
  },
  {
    id: "panel.open",
    version: 1,
    effects: ["open_panel"],
    status: "planned",
  },
  {
    id: "url.open",
    version: 1,
    effects: ["open_url"],
    status: "planned",
  },
];

export function runtimeCapabilityForEffect(
  effect: string
): WebRuntimeCapability | undefined {
  return WEB_RUNTIME_CAPABILITIES.find((capability) =>
    capability.effects.includes(effect)
  );
}
