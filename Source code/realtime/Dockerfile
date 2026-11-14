FROM node:22.16-alpine
ENV NODE_ENV=production PORT=3001 REALTIME_DATA_DIR=/app/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server.js ./
COPY scripts/ ./scripts/
COPY reference-client/ ./reference-client/
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3001
CMD ["node", "server.js"]
