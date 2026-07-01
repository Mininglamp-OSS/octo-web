FROM node:22.16.0-bookworm AS builder
WORKDIR /app
RUN npm install -g pnpm@10
COPY . .
RUN git config --global url."https://github.com/".insteadOf "git+ssh://git@github.com/" && git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"
ARG VITE_DOCS_DEFAULT_SPACE
ENV VITE_DOCS_DEFAULT_SPACE=${VITE_DOCS_DEFAULT_SPACE}
ARG VITE_DOCS_DEFAULT_FOLDER
ENV VITE_DOCS_DEFAULT_FOLDER=${VITE_DOCS_DEFAULT_FOLDER}
ARG VITE_DOCS_DEFAULT_DOC
ENV VITE_DOCS_DEFAULT_DOC=${VITE_DOCS_DEFAULT_DOC}
ARG VITE_DOCS_ASSET_HOSTS
ENV VITE_DOCS_ASSET_HOSTS=${VITE_DOCS_ASSET_HOSTS}
RUN pnpm install --frozen-lockfile && pnpm turbo run build --filter=@octo/web

FROM nginx:alpine
COPY --from=builder /app/docker-entrypoint.sh /docker-entrypoint2.sh 
RUN sed -i 's/\r$//' /docker-entrypoint2.sh
COPY --from=builder /app/nginx.conf.template /
COPY --from=builder /app/apps/web/build /usr/share/nginx/html
RUN chmod -R a+r /usr/share/nginx/html
ENTRYPOINT ["sh", "/docker-entrypoint2.sh"]
CMD ["nginx","-g","daemon off;"]
