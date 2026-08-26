# Awin Product Feed production deployment

FindCheap's public website remains static. Run this Feed service on a server with a persistent
volume and expose it through an HTTPS reverse proxy.

## Required secrets

1. In Awin, open **Toolbox → Create-a-Feed**, select an approved merchant Feed, select the required
   columns, choose CSV plus gzip, then copy the generated URL. Current approved merchants are
   Amazonliss (US) `20282`, GardePro `49085`, Watches Of USA `116479`, and
   Shenzhen Cangyu Technology Co., Ltd. `99013`.
   Do not commit, publish, or place this URL in client-side code; it contains the Product Feed API key
   in its path. This key is separate from the Publisher API key.
2. Generate an independent API token for private Feed administration and diagnostics. Never ship
   this token to FindCheap clients:

```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
```

3. Copy `.env.example` to `.env` on the server and set:

```dotenv
AWIN_SOURCE_FEED_URL=https://datafeed.api.productserve.com/datafeed/download/apikey/PRIVATE_PATH
AWIN_SOURCE_FEED_URL_2=https://productdata.awin.com/datafeed/download/apikey/SECOND_PRIVATE_PATH
AWIN_SOURCE_FEED_URL_3=https://productdata.awin.com/datafeed/download/apikey/THIRD_PRIVATE_PATH
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
Invoke-RestMethod http://127.0.0.1:3010/ready
```

Use `AWIN_SOURCE_FEED_URL` for Amazonliss, `AWIN_SOURCE_FEED_URL_2` for GardePro,
`AWIN_SOURCE_FEED_URL_3` for Watches Of USA, and `AWIN_SOURCE_FEED_URL_4` for Shenzhen Cangyu. Up to ten
numbered URLs are supported. Railway variables must remain secrets. Never place an Awin source URL
in the Codex plugin or GitHub.

The container:

- downloads every configured Feed immediately at startup, merges them only after every Feed passes
  validation, then refreshes every 360 minutes;
- accepts only HTTPS source URLs without URL userinfo on the hostname allowlist;
- caps the compressed response at 4 MB and decompressed CSV at 16 MB;
- requires every row to match Awin publisher `3047955`, an approved merchant ID, merchant name and
  merchant host, USD, and a valid price;
- writes `/data/current.csv.gz` atomically on the persistent `awin_feed_data` volume;
- fixes the mounted `/data` directory ownership at startup, then drops to the unprivileged `node` user;
- keeps the last valid snapshot when a later refresh fails;
- exposes only validated, bounded candidate searches through public `POST /v1/search`; the plugin
  still returns at most three customer-facing cards;
- applies a per-client 60-request-per-minute in-memory limit to public search;
- keeps raw `GET /v1/feed` protected by the private API token;
- returns `503` instead of unvalidated or missing data.

`GET /health` is the process liveness check and always returns `200` while the server is running.
`GET /ready` returns `200` only when a validated Feed snapshot is available; otherwise it returns
`503`. Configure Railway to use `/health`; use `/ready` to monitor Feed availability. Failed refreshes
include only a bounded `lastErrorCode`, never the source URL or credentials.

Publish `127.0.0.1:3010` through the server's TLS reverse proxy. Do not expose port `3010` directly
to the internet.

## Connect FindCheap MCP

GitHub-installed clients use the public, read-only Search API and receive no Awin or Railway secret:

```dotenv
AWIN_PRODUCT_SEARCH_URL=https://findcheap-agent-production.up.railway.app/v1/search
AWIN_PRODUCT_SEARCH_TIMEOUT_MS=5000
```

The plugin manifest supplies these values by default. Public search returns only validated approved
merchant products and affiliate links. It never returns the raw Feed, source URLs, Feed API keys, or
the private service token. `AWIN_PRODUCT_FEED_URL` plus `AWIN_PRODUCT_FEED_TOKEN` remains available
only for controlled internal diagnostics when public search is not configured.

Test prompt:

```text
FindCheap Agent 搜索 GardePro trail camera
FindCheap Agent 搜索 Watches Of USA 手表
FindCheap Agent 搜索 SNFLEX macerating toilet
```

Expected: unified `search_products` routes the approved category through `AWIN_PRODUCT_FEED`, keeps
condition `UNKNOWN`, and returns approved Awin deep links. Commission never changes ranking.
