# Awin Product Feed production deployment

FindCheap's public website remains static. Run this Feed service on a server with a persistent
volume and expose it through an HTTPS reverse proxy.

## Required secrets

1. In Awin, open **Toolbox → Create-a-Feed**, select the Amazonliss Feed, select the required columns,
   choose CSV plus gzip, then copy the generated URL. The current file identifies data feed `101349`.
   Do not commit, publish, or place this URL in client-side code; it contains the Product Feed API key
   in its path. This key is separate from the Publisher API key.
2. Generate an independent API token for FindCheap clients:

```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
```

3. Copy `.env.example` to `.env` on the server and set:

```dotenv
AWIN_SOURCE_FEED_URL=https://datafeed.api.productserve.com/datafeed/download/apikey/PRIVATE_PATH
AWIN_SOURCE_ALLOWED_HOSTS=productdata.awin.com,datafeed.api.productserve.com
AWIN_FEED_API_TOKEN=REPLACE_WITH_THE_RANDOM_TOKEN
AWIN_REFRESH_INTERVAL_MINUTES=360
AWIN_SOURCE_TIMEOUT_MS=15000
```

Current Awin documentation uses `datafeed.api.productserve.com` for generated Feed URLs and
`productdata.awin.com` for Feed-list downloads. If Awin returns another hostname, add only that exact
hostname to `AWIN_SOURCE_ALLOWED_HOSTS` after checking the final HTTPS URL.

## Start

```powershell
docker compose --profile awin up -d --build awin-feed-service
Invoke-RestMethod http://127.0.0.1:3010/health
```

The container:

- downloads immediately at startup, then every 360 minutes;
- accepts only a credential-free HTTPS source URL on the hostname allowlist;
- caps the compressed response at 4 MB and decompressed CSV at 16 MB;
- requires every row to match Awin publisher `3047955`, Amazonliss merchant `20282`, approved HTTPS
  hosts, USD, and a valid price;
- writes `/data/current.csv.gz` atomically on the persistent `awin_feed_data` volume;
- keeps the last valid snapshot when a later refresh fails;
- returns `503` instead of unvalidated or missing data.

Publish `127.0.0.1:3010` through the server's TLS reverse proxy as, for example,
`https://feed.example.com/v1/feed`. Do not expose port `3010` directly to the internet.

## Connect FindCheap MCP

Set these variables in the environment that launches the Codex plugin:

```dotenv
AWIN_PRODUCT_FEED_URL=https://feed.example.com/v1/feed
AWIN_PRODUCT_FEED_TOKEN=THE_SAME_RANDOM_TOKEN
AWIN_PRODUCT_FEED_TIMEOUT_MS=5000
```

Restart Codex and open a new task. Remote mode takes precedence over the local Downloads fallback.
The Feed service URL must use credential-free HTTPS on the default port. The token is sent only in
the `Authorization` header.

Test prompt:

```text
FindCheap Agent 搜索 Amazonliss keratin mask
```

Expected: one `search_awin_products` call, `AWIN_PRODUCT_FEED`, `DISCOVERY_ONLY`, condition
`UNKNOWN`, and disclosed `APPROVED_AFFILIATE` links. No Shopify or Chrome call.
