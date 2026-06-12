#!/usr/bin/env sh

set -eu

# Default SUMMARY_API_URL to blank so the /summary/ location short-circuits
# to 503 if smart-summary is not deployed. When running inside the OCTO
# compose stack, set SUMMARY_API_URL=http://summary-api:8080 from .env.
: "${SUMMARY_API_URL:=}"
export SUMMARY_API_URL

# Same pattern for MATTER_API_URL — the /matter/ location 503-falls-back
# when blank. Set MATTER_API_URL=http://octo-matter:8080 in the compose
# stack to enable the bot feed / matter direct path.
: "${MATTER_API_URL:=}"
export MATTER_API_URL

# PR-A.2: fleet hosts /api/v1/runtimes/* and /api/v1/daemon/* (runtime
# tree page + daemon onboarding). Blank yields a 503 in those locations
# so a deployment without fleet still boots — but the runtime UI will
# be dead until FLEET_API_URL=http://octo-fleet:8092 (or wherever fleet
# is) is set in the compose stack.
: "${FLEET_API_URL:=}"
# Trailing-slash footgun: nginx `proxy_pass $var` with a URI built by a
# `rewrite ... break` becomes `${var}${rewritten_uri}` literally; a
# trailing slash in the env yields a malformed double-slash upstream.
# Strip it here once for all three downstreams (mirror what /summary,
# /matter, fleet locations all expect).
SUMMARY_API_URL="${SUMMARY_API_URL%/}"
MATTER_API_URL="${MATTER_API_URL%/}"
FLEET_API_URL="${FLEET_API_URL%/}"
export FLEET_API_URL

envsubst '${API_URL} ${SUMMARY_API_URL} ${MATTER_API_URL} ${FLEET_API_URL}' < /nginx.conf.template > /etc/nginx/conf.d/default.conf


exec "$@"