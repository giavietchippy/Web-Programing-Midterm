FROM node:22.16-alpine
ENV NODE_ENV=production PLATFORM_PORT=3000 PLATFORM_DATA_DIR=/app/data
WORKDIR /app
COPY server.js package.json ./
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "server.js"]
