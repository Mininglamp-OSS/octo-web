// Typecheck-only ambient declaration for `@octo/base`.
//
// WHY THIS EXISTS
// ---------------
// `@octo/base` (packages/dmworkbase) is consumed source-direct (its package.json
// `main` is `src/index.tsx` with no built `.d.ts`). When this package's `tsc
// --noEmit` follows the `import { WKApp, i18n, t, useI18n } from '@octo/base'` in
// octoweb/index.ts, TypeScript pulls the ENTIRE dmworkbase source into the program
// and reports thousands of errors that belong to the host package's own (react@17)
// typings — none of them in docs `src/**`. `skipLibCheck` does not help because
// those are `.ts/.tsx` source files, not `.d.ts`.
//
// The host monorepo's real quality gate is `vite build` (rolldown) + lint + i18n,
// NOT a cross-package `tsc` (apps/web has no tsc typecheck job; sibling feature
// packages like @octo/todo have no typecheck script at all). So docs typecheck must
// likewise stop at the `@octo/base` boundary instead of auditing the host's source.
//
// This file declares ONLY the exact surface octoweb/index.ts imports from
// `@octo/base`. It is wired via `tsconfig.typecheck.json`'s `paths` so it is used
// ONLY for the isolated `pnpm typecheck` of docs — runtime/build resolution still
// uses the real `@octo/base`. Type-safety on the seam is preserved: the docs code
// already re-declares the structural WKApp/APIClient/RouteManager interfaces in
// octoweb/types.ts, and getWKApp() casts the real WKApp to WKAppShape explicitly.
declare module '@octo/base' {
  // WKApp is cast through `unknown` to WKAppShape in octoweb/index.ts, so its precise
  // shape is irrelevant to docs typecheck; declare it as `unknown`-ish to avoid
  // re-importing the host class type.
  export const WKApp: unknown

  // i18n namespace registration surface used by DocsModule.init().
  export const i18n: {
    registerNamespace(
      namespace: string,
      resources: Record<string, Record<string, unknown>>,
    ): void
    getLocale(): string
    init(): void
  }

  // Synchronous one-shot translation (non-component reads).
  export function t(key: string, values?: Record<string, unknown>): string

  // React hook returning a `t` bound to the current locale via I18nProvider context.
  export function useI18n(): { t: (key: string, values?: Record<string, unknown>) => string }

  // NavRail menu entry class. DocsModule.init() constructs `new Menus(id, routePath,
  // title, icon, selectedIcon)` and registers it via WKApp.menus.register. Only the
  // constructor surface is needed for the isolated docs typecheck; the real class
  // lives in packages/dmworkbase/src/Service/Menus.ts. `icon`/`selectedIcon` are
  // React elements but typed loosely here to avoid pulling host react typings.
  export class Menus {
    constructor(
      id: string,
      routePath: string,
      title: string,
      icon: unknown,
      selectedIcon: unknown,
      onPress?: () => void,
    )
  }

  // Space member as returned by SpaceService.getMembers (packages/dmworkbase/src/Service/
  // SpaceService.tsx). The docs seam reads uid + name, plus the optional avatar + robot flag
  // (0=human, 1=AI) + role that the member picker surfaces. The real type carries more
  // (created_at/…) but those are irrelevant to the isolated docs typecheck.
  export interface SpaceMember {
    uid: string
    name: string
    avatar?: string
    robot?: number
    role?: number
  }

  // Space membership service. octoweb/index.ts calls `SpaceService.shared.getMembers(...)`
  // in the production getSpaceMembers passthrough. Re-exported from `@octo/base` via
  // dmworkbase/src/index.tsx (`export * from "./Service/SpaceService"`).
  export class SpaceService {
    static shared: SpaceService
    getMembers(spaceId: string, page?: number, limit?: number): Promise<SpaceMember[]>
  }

  // Voice-input transcription contract (#571). The docs comment composers wire the shared
  // VoiceInputButton and receive transcribed text back through `onTranscribed`. Only the
  // surface octoweb/index.ts re-exports is declared here; the real component lives in
  // packages/dmworkbase/src/Components/VoiceInputButton.
  export type ReplaceMode = 'all' | 'selection' | 'insert'
  export interface SelectionRange {
    from: number
    to: number
  }
  // Props the docs composers pass. `inputRef`/icons are typed loosely (`unknown`/`any`) to
  // avoid pulling host react typings across the seam (mirrors WKApp/Menus above), while
  // `onTranscribed` keeps precise signatures so composer callbacks infer their params.
  export interface VoiceInputButtonProps {
    inputRef: { current: HTMLTextAreaElement | HTMLInputElement | null }
    onTranscribed: (
      text: string,
      replaceMode: ReplaceMode,
      savedSelectionRange?: SelectionRange,
    ) => void
    getCurrentText?: () => string
    showModeMenu?: boolean
    size?: 'sm' | 'md'
    className?: string
    onRecordingStart?: () => void
  }
  export function VoiceInputButton(props: VoiceInputButtonProps): any

  // Canonical doc-share-link builder, promoted to `@octo/base`
  // (packages/dmworkbase/src/Utils/docLink.ts) as the single source of truth for the
  // `${origin}/d/<docId>?sp=<spaceId>` format (XIN-450 / XIN-501 / XIN-513). Re-exported from
  // dmworkbase/src/index.tsx; docs' forward/link.ts is now a thin re-export of these.
  export interface DocLinkTarget {
    docId: string
    space?: string
    folder?: string
  }
  export function buildDocLink(target: DocLinkTarget): string

  // WuKongIM Channel primitives (plan Task 5), re-exported from @octo/base (which re-exports them
  // from wukongimjssdk). The docs embedded-bot-DM shell constructs `new Channel(botUid,
  // ChannelTypePerson)` and reads getChannelKey() for the React key.
  export const ChannelTypePerson: number
  export const MAX_MESSAGE_LENGTH: number
  export class Channel {
    constructor(channelID: string, channelType: number)
    channelID: string
    channelType: number
    getChannelKey(): string
    isEqual(other: Channel): boolean
  }

  // One-shot initial-compose contract (plan Task 4) surfaced on ConversationProps. The docs shell
  // builds an InitialCompose and reads state changes back.
  export interface InitialCompose {
    requestId: string
    text: string
    files: File[]
    autoSend: boolean
  }
  export type InitialComposeState = 'prepared' | 'sent' | 'failed'

  // The host Conversation component (packages/dmworkbase/src/Components/Conversation). Only the
  // props the docs embedded-bot-DM shell passes are declared here; the real component carries many
  // more. Typed loosely (`any` return) to avoid pulling host react typings across the seam.
  export interface ConversationProps {
    channel: Channel
    initialCompose?: InitialCompose
    inputNotice?: unknown
    onInitialComposeStateChange?: (
      requestId: string,
      state: InitialComposeState,
      reason?: string,
    ) => void
    onMessageSent?: () => void
  }
  export function Conversation(props: ConversationProps): any
}
