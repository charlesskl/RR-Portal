FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache curl postgresql-client

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/backups

ENV PORT=6001
ENV NODE_ENV=production

EXPOSE 6001

CMD ["node", "server.js"]
