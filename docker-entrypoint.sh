#!/usr/bin/env sh

set -eu

# Default SUMMARY_API_URL to blank so the /summary/ location short-circuits
# to 503 if smart-summary is not deployed. When running inside the OCTO
# compose stack, set SUMMARY_API_URL=http://summary-api:8080 from .env.
: "${SUMMARY_API_URL:=}"
export SUMMARY_API_URL

# Extra CSP img-src source for the object-store (minio) presign host, e.g.
# "http://192.168.214.189:9000". Empty by default (https-only). Must match the
# backend presign host and frontend VITE_DOCS_ASSET_HOSTS.
: "${DOCS_ASSET_CSP_ORIGIN:=}"
export DOCS_ASSET_CSP_ORIGIN

# octo-doc HTML render + comments/reactions/grants/admin upstream. Per-environment:
# override in .env to the reachable octo-docs-html host:port. Blank by default (like
# SUMMARY above): unset ⇒ the doc routes 503 rather than nginx trying to resolve
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

# Runtime HTML source/diff switch. Defaults on; any value other than the
# literal "true" (including "false") disables it.
: "${OCTO_HTML_SOURCE_DIFF_ENABLED:=true}"
if [ "$OCTO_HTML_SOURCE_DIFF_ENABLED" = "true" ]; then
  HTML_SOURCE_DIFF_JS=true
else
  HTML_SOURCE_DIFF_JS=false
fi
printf 'window.__OCTO_HTML_SOURCE_DIFF_ENABLED__ = %s;\n' "$HTML_SOURCE_DIFF_JS" \
  > /usr/share/nginx/html/runtime-config.js

# octo-marketplace backend — dmworkmcp / dmworkskillmarket proxy through the
# /market/api/v1/ location. Same blank-default + 503-fallback shape as
# SUMMARY above so a deployment without marketplace still boots.
# Set MARKET_API_URL=http://octo-marketplace:8080 in the compose stack to
# enable it. Trailing slash stripped: nginx `proxy_pass $var` (variable, no
# URI part) with a rewrite-built URI would otherwise produce a double-slash
# upstream. Missing from the envsubst allowlist would leave the literal
# `${MARKET_API_URL}` in the generated config, defeating the blank-value
# guard (`if ($market_api_url = "")`) — PR#851 Jerry-Xin 03:38 P0 fix.
: "${MARKET_API_URL:=}"
MARKET_API_URL="${MARKET_API_URL%/}"
export MARKET_API_URL

# octo-drive service upstream for the /v1/drive location (independent backend,
# not octo-server). Blank by default (503 when unset) — same shape as the hosts
# above. Trailing slash stripped: proxy_pass uses `$drive_api_url$request_uri`,
# so a trailing slash would produce a double-slash upstream. Must be in the
# envsubst allowlist or the literal `${DRIVE_API_URL}` would survive into the
# generated config and defeat the blank-value guard (`if ($drive_api_url = "")`).
: "${DRIVE_API_URL:=}"
DRIVE_API_URL="${DRIVE_API_URL%/}"
export DRIVE_API_URL


# octo-fleet upstream for the /fleet/api/ location (Loop workspace/runtime
# pickers in the expert market). Blank by default (503 when unset) — same
# shape as the hosts above. Set FLEET_API_URL=http://octo-fleet:8080 in the
# compose stack to enable it. Trailing slash stripped: the location rewrites
# /fleet/api/* to fleet's native /v1/* and proxy_passes the bare variable, so
# a trailing slash would produce a double-slash upstream. Must be in the
# envsubst allowlist below or the literal `${FLEET_API_URL}` would survive
# into the generated config and defeat the blank-value guard
# (`if ($fleet_api_url = "")`) — the same failure mode as PR#851's
# MARKET_API_URL P0.
: "${FLEET_API_URL:=}"
FLEET_API_URL="${FLEET_API_URL%/}"
export FLEET_API_URL

# octo-dap telemetry collector upstream for the `location = /v1/e/b` block. Blank
# by default (503 when unset) — same shape as the hosts above. Trailing slash
# stripped: that block rewrites to a fixed `/v1/dap/collect` and proxy_passes
# `$track_api_url` (no URI), so a trailing slash on the host would produce a
# double-slash upstream. Must be in the envsubst allowlist or the literal
# `${TRACK_API_URL}` would survive into the generated config and defeat the
# blank-value guard (`if ($track_api_url = "")`), so the telemetry route would
# 503 regardless of what the operator configures.
: "${TRACK_API_URL:=}"
TRACK_API_URL="${TRACK_API_URL%/}"
export TRACK_API_URL

# Agent Mail browser and Agent API upstreams.
: "${MAIL_API_URL:=}"
MAIL_API_URL="${MAIL_API_URL%/}"
export MAIL_API_URL
: "${AGENT_MAIL_API_URL:=}"
AGENT_MAIL_API_URL="${AGENT_MAIL_API_URL%/}"
export AGENT_MAIL_API_URL

: "${MAIL_CLIENT_MAX_BODY_SIZE:=50m}"
case "$MAIL_CLIENT_MAX_BODY_SIZE" in
    *[kKmMgG]) mail_size_number=${MAIL_CLIENT_MAX_BODY_SIZE%?} ;;
    *) mail_size_number=$MAIL_CLIENT_MAX_BODY_SIZE ;;
esac
case "$mail_size_number" in
    ''|*[!0-9]*)
        echo "invalid MAIL_CLIENT_MAX_BODY_SIZE: expected bytes or a k/m/g suffix" >&2
        exit 1
        ;;
esac
if [ "$mail_size_number" -eq 0 ]; then
    echo "invalid MAIL_CLIENT_MAX_BODY_SIZE: must be greater than zero" >&2
    exit 1
fi
export MAIL_CLIENT_MAX_BODY_SIZE

: "${NGINX_RESOLVER:=127.0.0.11}"
case "$NGINX_RESOLVER" in
    ''|*[!A-Za-z0-9:._-]*)
        echo "invalid NGINX_RESOLVER: expected one IP address or DNS name" >&2
        exit 1
        ;;
esac
export NGINX_RESOLVER

envsubst '${API_URL} ${SUMMARY_API_URL} ${MARKET_API_URL} ${DRIVE_API_URL} ${FLEET_API_URL} ${TRACK_API_URL} ${MAIL_API_URL} ${AGENT_MAIL_API_URL} ${MAIL_CLIENT_MAX_BODY_SIZE} ${NGINX_RESOLVER} ${DOCS_ASSET_CSP_ORIGIN} ${DOC_APP_URL} ${DOCS_BACKEND_URL}' < /nginx.conf.template > /etc/nginx/conf.d/default.conf


exec "$@"
