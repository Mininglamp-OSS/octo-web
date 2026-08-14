import type { ChatComposerViewHost } from "../../ports";

export function createTestViewHost(
  id = "channel",
  type = 2,
  overrides: Partial<ChatComposerViewHost> = {}
): ChatComposerViewHost {
  const channel = {
    id,
    type,
    key: `${id}:${type}`,
    isDirect: type === 1,
  };
  return {
    track: () => {},
    getChannel: () => channel,
    getChannelTitle: () => undefined,
    subscribeChannelTitle: () => () => {},
    resolveMemberAvatar: () => "",
    resolveMemberExternal: () => ({
      isExternal: false,
      sourceSpaceName: "",
    }),
    resolveImageUrl: (url) => url,
    openSecretCreate: () => {},
    ...overrides,
  };
}
