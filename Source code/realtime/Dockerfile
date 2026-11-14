FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=3001

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node . .
RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 3001
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "const http = require('node:http'); const req = http.get({ host: '127.0.0.1', port: Number(process.env.PORT || 3001), path: '/realtime/reference-client/' }, (res) => { res.resume(); process.exitCode = res.statusCode === 200 ? 0 : 1; }); req.on('error', () => process.exit(1));"]

CMD ["node", "server.js"]
