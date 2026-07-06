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

envsubst '${API_URL} ${SUMMARY_API_URL} ${DOCS_ASSET_CSP_ORIGIN}' < /nginx.conf.template > /etc/nginx/conf.d/default.conf


exec "$@"