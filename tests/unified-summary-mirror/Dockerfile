FROM nginx:1.27-alpine
COPY apps/web/build-unified-mirror /usr/share/nginx/html
COPY tests/unified-summary-mirror/nginx.conf /etc/nginx/conf.d/default.conf
