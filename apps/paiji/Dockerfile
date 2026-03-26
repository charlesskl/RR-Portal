FROM node:20-alpine AS frontend-build

WORKDIR /build/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
ARG BASE_PATH=/paiji/
ENV VITE_BASE_PATH=${BASE_PATH}
RUN npx vite build --base ${BASE_PATH}

FROM node:20-alpine

RUN apk add --no-cache python3 make g++ curl

WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && apk del python3 make g++

COPY server/ ./
COPY --from=frontend-build /build/client/dist /app/client-dist

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_PATH=/app/data

EXPOSE 3000
CMD ["node", "app.js"]
