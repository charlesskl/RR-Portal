FROM node:20-bookworm-slim AS web-build

WORKDIR /src
# China 网络：registry.npmjs.org 与 prisma 引擎二进制直连超时（部署 ECS 在阿里云内）。
# 构建期改用阿里云 npmmirror 镜像，npm ci 从 37min 超时失败降到分钟级。
# npm 默认 replace-registry-host=npmjs，会把 lockfile 里 npmjs.org 的 resolved URL
# 自动替换成此 registry。仅作用于构建阶段，不影响本地开发 / 运行时。
ENV npm_config_registry=https://registry.npmmirror.com \
    PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma \
    NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate

ARG NEXT_PUBLIC_BASE_PATH=/sprayplan
ENV NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH}
ENV DOTNET_API_URL=http://127.0.0.1:5080
RUN npm run build

# Build an independent first-start database. Runtime data is bind-mounted and
# this seed is copied only when the data directory is empty.
ENV DATABASE_URL=file:/tmp/sprayplan-seed.db
RUN npx prisma db push --skip-generate \
    && npm run db:seed \
    && npm prune --omit=dev

FROM mcr.microsoft.com/dotnet/sdk:8.0-bookworm-slim AS api-build
WORKDIR /src
COPY server/SprayPlan.Api/SprayPlan.Api.csproj ./
RUN dotnet restore SprayPlan.Api.csproj
COPY server/SprayPlan.Api/ ./
RUN dotnet publish SprayPlan.Api.csproj -c Release --no-restore -o /publish

FROM mcr.microsoft.com/dotnet/aspnet:8.0-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_PUBLIC_BASE_PATH=/sprayplan
ENV DOTNET_API_URL=http://127.0.0.1:5080
ENV JWT_ISSUER=sprayplan
ENV ASPNETCORE_ENVIRONMENT=Production

COPY --from=web-build /usr/local/bin/node /usr/local/bin/node
COPY --from=web-build /src/node_modules ./node_modules
COPY --from=web-build /src/.next ./.next
COPY --from=web-build /src/package.json ./package.json
COPY --from=web-build /src/next.config.mjs ./next.config.mjs
COPY --from=web-build /src/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=web-build /tmp/sprayplan-seed.db ./prisma/seed.db
COPY --from=api-build /publish ./server/SprayPlan.Api/publish
COPY server/SprayPlan.Api/appsettings.json ./server/SprayPlan.Api/appsettings.json
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x ./docker-entrypoint.sh \
    && mkdir -p /app/data /app/server/SprayPlan.Api/storage/pdf

VOLUME ["/app/data", "/app/server/SprayPlan.Api/storage"]
EXPOSE 8400

ENTRYPOINT ["/app/docker-entrypoint.sh"]
