# Runtime provider marks

Copied from `octo-loop-module/packages/dmloop/src/ui/providerLogo.tsx`, which
attributes these marks to octo-multica (Apache-2.0). Original brand colors are
preserved as static asset data. Monochrome SVGs render as CSS masks so their
color follows the application theme. Hermes uses the original embedded WebP.

Only the API `provider` field selects a mark. Missing or unknown providers use
a generic local/cloud icon; the runtime name is never used to guess a brand.
