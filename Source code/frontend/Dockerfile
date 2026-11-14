# ---------- Stage 1: build the React/Vite app ----------
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---------- Stage 2: serve with Nginx ----------
FROM nginx:1.27-alpine
# Upstreams for the reverse proxy (override with docker-compose / -e)
ENV API_UPSTREAM=http://host.docker.internal:3000 \
    WS_UPSTREAM=http://host.docker.internal:3001 \
    USE_MOCK_API=true \
    API_BASE=/api \
    WS_URL="" \
    DEV_TOKEN_URL=/dev/token

COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY docker/40-runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh
# strip Windows CRLF (git on Windows) so the script still runs, then make it executable
RUN sed -i 's/\r$//' /docker-entrypoint.d/40-runtime-config.sh && chmod +x /docker-entrypoint.d/40-runtime-config.sh
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
