// Test stub for `@octo/base`, wired via the vitest alias in vitest.config.ts.
//
// Importing the real `@octo/base` would pull the whole app (WKSDK, semi-ui, the full
// WKApp/App.tsx tree) into jsdom. Docs tests inject behaviour through
// `setWKApp(createMockWKApp())` (octoweb/mock.ts); this stub only needs to satisfy the
// top-level `import { WKApp, i18n } from '@octo/base'` in octoweb/index.ts and provide a
// sane fallback if a test forgets to call setWKApp.

// buildDocLink is a pure, dependency-free util (only reads window.location.origin), so the stub
// re-exports the REAL implementation from base — docs tests exercise the same canonical builder as
// production rather than a divergent copy.
export { buildDocLink, type DocLinkTarget } from '../../../dmworkbase/src/Utils/docLink.ts'

export const WKApp = {
  shared: {
    registerModule(module: { id(): string; init(): void }) {
      module.init()
    },
  },
  route: {
    register() {},
  },
  menus: {
    register() {},
  },
  apiClient: {
    get: async () => ({ data: {}, status: 200 }),
    post: async () => ({ data: {}, status: 200 }),
    put: async () => ({ data: {}, status: 200 }),
    patch: async () => ({ data: {}, status: 200 }),
    delete: async () => ({ data: {}, status: 200 }),
  },
  loginInfo: { uid: 'u_stub', token: 'stub-token' },
}

export const i18n = {
  registerNamespace() {},
  init() {},
  getLocale: () => 'en-US',
  subscribe() {},
}

// Translation stub: returns the key unchanged so tests can assert on stable, locale-independent
// strings (the real `@octo/base` t() resolves against registered namespaces).
export function t(key: string) {
  return key
}

// useI18n stub: mirrors the I18nProvider context shape the real hook returns.
export function useI18n() {
  return { t: (key: string) => key, locale: 'en-US' as const }
}

// NavRail menu entry stub mirroring packages/dmworkbase/src/Service/Menus.ts. DocsModule
// constructs `new Menus(id, routePath, title, icon, selectedIcon)`; tests read routePath.
export class Menus {
  id: string
  routePath: string
  title: string
  icon: unknown
  selectedIcon: unknown
  onPress?: () => void
  constructor(
    id: string,
    routePath: string,
    title: string,
    icon: unknown,
    selectedIcon: unknown,
    onPress?: () => void,
  ) {
    this.id = id
    this.routePath = routePath
    this.title = title
    this.icon = icon
    this.selectedIcon = selectedIcon
    this.onPress = onPress
  }
}

// SpaceService stub mirroring packages/dmworkbase/src/Service/SpaceService.tsx. The docs seam
// (octoweb/index.ts) imports this for the production getSpaceMembers passthrough; in tests the
// seam routes through the injected mock's getSpaceMembers instead, so this fallback just returns
// an empty page (a test that forgot setWKApp would see "no members" rather than crash).
export interface SpaceMember {
  uid: string
  name: string
  avatar?: string
  robot?: number
  role?: number
}
export class SpaceService {
  static shared = new SpaceService()
  async getMembers(_spaceId: string, _page = 1, _limit = 50): Promise<SpaceMember[]> {
    return []
  }
}

// VoiceInputButton stub (#571): the real component is a hooks-based functional component that
// pulls the full voice/recording stack (WKApp, semi-ui, media APIs) into jsdom. Docs tests only
// need it to render nothing so the comment composers mount cleanly; behaviour is covered by the
// dmworkbase VoiceInputButton tests.
export function VoiceInputButton() {
  return null
}
export type ReplaceMode = 'all' | 'selection' | 'insert'
export type SelectionRange = { from: number; to: number }

// WuKongIM Channel primitives (plan Task 5). The docs embedded-bot-DM shell constructs
// `new Channel(botUid, ChannelTypePerson)` and reads getChannelKey() for the React key. The real
// primitives live in wukongimjssdk (re-exported from @octo/base); this lightweight stub mirrors the
// surface docs touches so tests resolve them through the @octo/base alias without the SDK.
export const ChannelTypePerson = 1
export class Channel {
  channelID: string
  channelType: number
  constructor(channelID: string, channelType: number) {
    this.channelID = channelID
    this.channelType = channelType
  }
  getChannelKey(): string {
    return `${this.channelID}-${this.channelType}`
  }
  isEqual(other: Channel): boolean {
    return !!other && other.channelID === this.channelID && other.channelType === this.channelType
  }
}

// Conversation stub (plan Task 5): the real component pulls WKSDK + the whole chat runtime into
// jsdom. DocsBotConversation.test.tsx replaces this with its own marker via vi.mock on the seam;
// this fallback renders nothing so a test that forgot to mock still mounts cleanly.
export function Conversation() {
  return null
}

export const MAX_MESSAGE_LENGTH = 5000
