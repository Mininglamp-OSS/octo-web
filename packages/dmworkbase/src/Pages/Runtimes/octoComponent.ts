import type { RuntimeKind } from "./botsApi"

// A runtime's octo-adapter plugin component name: openclaw ships a bundled
// "octo" plugin; claude's adapter is the separate cc-channel-octo gateway,
// reported as "cc-octo". This is the single source of truth on the web side for
// the provider→plugin-component relationship — it must match fleet's
// expectedPluginComponent and the daemon's cc-octo version reporting, since the
// string is used as the upgrade-order `component` and to find the plugin in
// metadata.plugins.
const OCTO_COMPONENT: Record<RuntimeKind, string> = {
    openclaw: "octo",
    claude: "cc-octo",
}

// octoComponentName returns the octo-adapter plugin component for a provider, or
// null for an unknown/unsupported provider. hasOwnProperty-guarded so prototype
// keys ("constructor", "toString", …) from the untrusted `provider` string can't
// resolve to an inherited function.
export function octoComponentName(provider: string): string | null {
    if (!Object.prototype.hasOwnProperty.call(OCTO_COMPONENT, provider)) return null
    return OCTO_COMPONENT[provider as RuntimeKind]
}
