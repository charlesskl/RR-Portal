FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json start.mjs ./
COPY cloud ./cloud
COPY production ./production
COPY ops ./ops
COPY shared ./shared
RUN mkdir -p /app/runtime && chown -R node:node /app/runtime
USER node
ENV APP_MODE=production HOST=0.0.0.0 PORT=3100 PLATFORM_DATA_DIR=/app/runtime
EXPOSE 3100
CMD ["node", "start.mjs", "--cloud-only"]
