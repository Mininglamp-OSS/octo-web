#!/usr/bin/env sh

set -eu

envsubst '${API_URL}' < /nginx.conf.template > /etc/nginx/conf.d/default.conf


exec "$@"