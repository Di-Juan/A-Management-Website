FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY web ./web
RUN npm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
ENV TZ=Asia/Shanghai
WORKDIR /app

RUN apk add --no-cache tzdata

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY --from=build /app/web/dist ./web/dist

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8787/api/v1/health || exit 1

CMD ["node", "server/src/index.js"]
