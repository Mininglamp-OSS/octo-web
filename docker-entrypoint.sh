#!/usr/bin/env sh

set -eu

# Default SUMMARY_API_URL to blank so the /summary/ location short-circuits
# to 503 if smart-summary is not deployed. When running inside the OCTO
# compose stack, set SUMMARY_API_URL=http://summary-api:8080 from .env.
: "${SUMMARY_API_URL:=}"
export SUMMARY_API_URL

# octo-matter backend — dmworktodo and the summary matter-picker proxy
# through the /matter/api/v1/ location. Blank yields a 503 there so a
# deployment without matter still boots. Set MATTER_API_URL=http://octo-matter:8080
# in the compose stack to enable it.
: "${MATTER_API_URL:=}"
# Strip a trailing slash: nginx `proxy_pass $var` (variable, no URI part)
# with a rewrite-built URI would otherwise produce a double-slash upstream.
MATTER_API_URL="${MATTER_API_URL%/}"
export MATTER_API_URL

# Extra CSP img-src source for the object-store (minio) presign host, e.g.
# "http://192.168.214.189:9000". Empty by default (https-only). Must match the
# backend presign host and frontend VITE_DOCS_ASSET_HOSTS.
: "${DOCS_ASSET_CSP_ORIGIN:=}"
export DOCS_ASSET_CSP_ORIGIN

# octo-doc HTML render + comments/reactions/grants/admin upstream. Per-environment:
# override in .env to the reachable octo-docs-html host:port. Blank by default (like
# SUMMARY/MATTER above): unset ⇒ the doc routes 503 rather than nginx trying to resolve
# a dev-only hostname at startup and hard-failing the whole container. Trailing slash
# stripped to avoid a double-slash upstream when a rewrite builds the URI.
: "${DOC_APP_URL:=}"
DOC_APP_URL="${DOC_APP_URL%/}"
export DOC_APP_URL

# octo-docs-backend (full docs-meta REST surface) upstream for /api/v1/docs.
# Override per-environment in .env. Blank by default (503 when unset) — see DOC_APP_URL.
: "${DOCS_BACKEND_URL:=}"
DOCS_BACKEND_URL="${DOCS_BACKEND_URL%/}"
export DOCS_BACKEND_URL

# octo-marketplace backend — dmworkmcp / dmworkskillmarket proxy through the
# /market/api/v1/ location. Same blank-default + 503-fallback shape as
# SUMMARY/MATTER above so a deployment without marketplace still boots.
# Set MARKET_API_URL=http://octo-marketplace:8080 in the compose stack to
# enable it. Trailing slash stripped: nginx `proxy_pass $var` (variable, no
# URI part) with a rewrite-built URI would otherwise produce a double-slash
# upstream. Missing from the envsubst allowlist would leave the literal
# `${MARKET_API_URL}` in the generated config, defeating the blank-value
# guard (`if ($market_api_url = "")`) — PR#851 Jerry-Xin 03:38 P0 fix.
: "${MARKET_API_URL:=}"
MARKET_API_URL="${MARKET_API_URL%/}"
export MARKET_API_URL

envsubst '${API_URL} ${SUMMARY_API_URL} ${MATTER_API_URL} ${MARKET_API_URL} ${DOCS_ASSET_CSP_ORIGIN} ${DOC_APP_URL} ${DOCS_BACKEND_URL}' < /nginx.conf.template > /etc/nginx/conf.d/default.conf


exec "$@"
