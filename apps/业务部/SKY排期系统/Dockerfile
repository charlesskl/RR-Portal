FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json patch-exceljs.js ./
RUN npm ci --omit=dev --no-audit --no-fund && mkdir -p /app/data && chown node:node /app/data
COPY server.js excel-writer.js full-workbook.js sky-current-layout.js paste-workbook.js ./
COPY parsers ./parsers
COPY public ./public
USER node
EXPOSE 3200
CMD ["node", "server.js"]
