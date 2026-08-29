FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS build

WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build:commerce \
    && pnpm --filter @shopping-agent/commerce-api deploy --prod --legacy /opt/commerce \
    && mkdir -p /opt/commerce/dist /opt/commerce/config/merchants /opt/commerce/docs/product/merchant-decisions \
    && cp apps/commerce-api/dist/main.js /opt/commerce/dist/main.js \
    && cp config/merchants/catalog.yaml /opt/commerce/config/merchants/catalog.yaml

FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /opt/commerce/ /app/
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.COMMERCE_API_PORT||'3000')+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
