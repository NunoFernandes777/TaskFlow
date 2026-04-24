ARG NODE_BASE_IMAGE=node:20-alpine

FROM ${NODE_BASE_IMAGE} AS deps
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM ${NODE_BASE_IMAGE} AS runtime
WORKDIR /app

RUN apk add --no-cache wget \
    && addgroup -S taskflow \
    && adduser -S taskflow -G taskflow

COPY --from=deps --chown=taskflow:taskflow /app/node_modules ./node_modules
COPY --chown=taskflow:taskflow backend/package*.json ./
COPY --chown=taskflow:taskflow backend/server.js ./

LABEL org.opencontainers.image.authors="TaskFlow DevOps team" \
      org.opencontainers.image.source="https://github.com/[FORMATEUR]/taskflow" \
      org.opencontainers.image.version="1.0.0"

ENV NODE_ENV=production
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O- http://127.0.0.1:3001/health || exit 1

USER taskflow

CMD ["node", "server.js"]
