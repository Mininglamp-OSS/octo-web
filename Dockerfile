FROM node:22.16.0-bookworm AS builder
WORKDIR /app
RUN npm install -g pnpm@10
COPY . .
RUN git config --global url."https://github.com/".insteadOf "git+ssh://git@github.com/" && git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"
RUN pnpm install --frozen-lockfile && pnpm turbo run build --filter=@octo/web

FROM nginx:alpine
COPY --from=builder /app/docker-entrypoint.sh /docker-entrypoint2.sh 
RUN sed -i 's/\r$//' /docker-entrypoint2.sh
COPY --from=builder /app/nginx.conf.template /
COPY --from=builder /app/apps/web/build /usr/share/nginx/html
RUN chmod -R a+r /usr/share/nginx/html
ENTRYPOINT ["sh", "/docker-entrypoint2.sh"]
CMD ["nginx","-g","daemon off;"]
