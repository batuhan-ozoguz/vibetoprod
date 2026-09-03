FROM node:22-alpine
RUN apk add --no-cache git
WORKDIR /app
COPY package.json LICENSE NOTICE ./
COPY bin ./bin
COPY src ./src
COPY rules ./rules
COPY costs ./costs
COPY web ./web
# HOME on tmpfs: git must be able to write nothing outside /tmp on a read-only fs
ENV NODE_ENV=production PORT=8080 HOME=/tmp
USER node
EXPOSE 8080
CMD ["node", "web/server.mjs"]
