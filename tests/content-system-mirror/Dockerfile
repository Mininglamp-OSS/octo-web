# Package the normal Octo Web build, not the isolated component fixture.
FROM nginx:1.27-alpine
COPY apps/web/build /usr/share/nginx/html
COPY nginx.conf.template /nginx.conf.template
COPY docker-entrypoint.sh /docker-entrypoint2.sh
RUN chmod -R a+r /usr/share/nginx/html
ENTRYPOINT ["sh", "/docker-entrypoint2.sh"]
CMD ["nginx", "-g", "daemon off;"]
