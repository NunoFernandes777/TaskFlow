FROM nginx:alpine

LABEL org.opencontainers.image.authors="TaskFlow DevOps team" \
      org.opencontainers.image.source="https://github.com/[FORMATEUR]/taskflow" \
      org.opencontainers.image.version="1.0.0"

COPY frontend/nginx.conf /etc/nginx/templates/default.conf.template
COPY frontend/index.html frontend/app.js frontend/styles.css /usr/share/nginx/html/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O- http://127.0.0.1/nginx-health || exit 1
