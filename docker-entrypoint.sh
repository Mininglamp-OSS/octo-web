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

envsubst '${API_URL} ${SUMMARY_API_URL} ${MATTER_API_URL}' < /nginx.conf.template > /etc/nginx/conf.d/default.conf


exec "$@"