FROM nginx:1.27-alpine
COPY apps/web/build-formal-mirror /usr/share/nginx/html
COPY tests/content-execution-mirror/nginx.conf /etc/nginx/conf.d/default.conf
