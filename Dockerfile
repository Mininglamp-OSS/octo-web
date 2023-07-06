FROM node:16.13.0 as builder
WORKDIR /app
RUN curl -o- -L https://yarnpkg.com/install.sh | bash
RUN yarn config set registry https://registry.npm.taobao.org -g
RUN npm config set registry https://registry.npm.taobao.org
COPY . .
RUN yarn install && yarn build

FROM nginx:latest
COPY --from=builder /app/docker-entrypoint.sh /docker-entrypoint2.sh 
COPY --from=builder /app/nginx.conf.template /
COPY --from=builder /app/apps/web/build /usr/share/nginx/html
ENTRYPOINT ["sh", "/docker-entrypoint2.sh"]
CMD ["nginx","-g","daemon off;"]