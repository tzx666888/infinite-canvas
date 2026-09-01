# syntax=docker/dockerfile:1.7
# 构建 Next.js 前端产物。原生数据库驱动必须和最终 Node 22 运行层使用相同 ABI。
FROM node:22-bookworm-slim AS web-build

WORKDIR /app/web
ARG NEXT_PUBLIC_APP_VERSION
ENV NEXT_PUBLIC_APP_VERSION=${NEXT_PUBLIC_APP_VERSION}
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && npm install --global bun@1.3.13 node-gyp \
    && rm -rf /var/lib/apt/lists/*
COPY web/package.json web/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile --cache-dir=/root/.bun/install/cache
COPY VERSION /app/VERSION
COPY CHANGELOG.md /app/CHANGELOG.md
COPY web ./
RUN if [ -z "$NEXT_PUBLIC_APP_VERSION" ]; then export NEXT_PUBLIC_APP_VERSION="$(cat /app/VERSION)"; fi \
    && bun run build

# 运行镜像：只启动 Next.js，模型请求由站内私有网关转发。
FROM node:22-bookworm-slim

WORKDIR /app
COPY VERSION /app/VERSION
COPY CHANGELOG.md /app/CHANGELOG.md
COPY --from=web-build /app/web/public /app/web/public
COPY --from=web-build /app/web/.next/standalone /app/web
COPY --from=web-build /app/web/.next/static /app/web/.next/static
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3100
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && addgroup --system --gid 10001 canvas \
    && adduser --system --uid 10001 --ingroup canvas canvas \
    && chown -R canvas:canvas /app

EXPOSE 3100
USER canvas
CMD ["sh", "-c", "cd /app/web && exec node server.js"]
