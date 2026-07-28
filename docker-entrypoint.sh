#!/usr/bin/env sh

set -eu

# Default SUMMARY_API_URL to blank so the /summary/ location short-circuits
# to 503 if smart-summary is not deployed. When running inside the OCTO
# compose stack, set SUMMARY_API_URL=http://summary-api:8080 from .env.
: "${SUMMARY_API_URL:=}"
export SUMMARY_API_URL

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

envsubst '${API_URL} ${SUMMARY_API_URL} ${MARKET_API_URL}' < /nginx.conf.template > /etc/nginx/conf.d/default.conf


exec "$@"
