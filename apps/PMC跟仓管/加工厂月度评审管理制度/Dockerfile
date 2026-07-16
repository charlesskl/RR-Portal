FROM node:20-alpine AS frontend-build

WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_BASE_PATH=/factory-review/
ENV VITE_BASE_PATH=$VITE_BASE_PATH
RUN npm run build

FROM alpine:3.22

ARG PB_VERSION=0.39.6
ARG PB_SHA256=9251d4ebca4fe91771392dc389a6e449e4e00a34182b0316e7a2d9984d34da3d
RUN apk add --no-cache ca-certificates unzip \
    && wget -q -O /tmp/pb.zip "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip" \
    && echo "${PB_SHA256}  /tmp/pb.zip" | sha256sum -c - \
    && unzip /tmp/pb.zip -d /pb \
    && rm /tmp/pb.zip

WORKDIR /pb
COPY --from=frontend-build /build/dist ./pb_public
COPY pb_migrations ./pb_migrations
COPY pb_hooks ./pb_hooks

EXPOSE 8090
HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:8090/api/factory-review/health || exit 1

CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8090", "--dir=/pb/pb_data", "--publicDir=/pb/pb_public", "--migrationsDir=/pb/pb_migrations", "--hooksDir=/pb/pb_hooks"]
