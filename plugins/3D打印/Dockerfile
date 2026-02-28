FROM node:20-alpine
WORKDIR /app
COPY server.js ./
COPY index.html ./
RUN mkdir -p /app/data
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/version || exit 1
CMD ["node", "server.js"]
