FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS build

WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build:awin-feed && mkdir -p /opt/awin-feed/dist \
    && cp apps/awin-feed-service/dist/main.js /opt/awin-feed/dist/main.js

FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /opt/awin-feed/ /app/
EXPOSE 3010
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.AWIN_FEED_SERVICE_PORT||process.env.PORT||'3010')+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
