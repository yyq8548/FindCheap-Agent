# Awin Product Feed production deployment

FindCheap's public website remains static. The Railway Feed service discovers, downloads, validates,
and searches Awin product data without exposing the Product Feed API key to the plugin or browser.

## Preferred automatic Feed List mode

In Awin, open **Toolbox → Create-a-Feed → Feed List Download** and copy the private Feed List URL.
It contains the Product Feed API key and must stay in Railway secrets, never GitHub, client code,
logs, screenshots, or the Codex plugin.

Configure Railway:

```dotenv
AWIN_SOURCE_FEED_LIST_URL=REPLACE_WITH_PRIVATE_FEED_LIST_URL
AWIN_SOURCE_FEED_REGION=US
AWIN_SOURCE_FEED_LANGUAGE=English
AWIN_SOURCE_ALLOWED_HOSTS=productdata.awin.com,datafeed.api.productserve.com,ui.awin.com
AWIN_FEED_API_TOKEN=REPLACE_WITH_AN_INDEPENDENT_RANDOM_TOKEN
AWIN_REFRESH_INTERVAL_MINUTES=360
AWIN_SOURCE_RESPONSE_TIMEOUT_MS=15000
AWIN_SOURCE_BODY_TIMEOUT_MS=45000
AWIN_SOURCE_RETRY_ATTEMPTS=2
AWIN_SOURCE_RETRY_BASE_DELAY_MS=1000
AWIN_FEED_STALE_AFTER_MINUTES=480
```

Generate the independent service token with:

```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
```

The service loads the last validated snapshot and starts listening before any network refresh. It
then refreshes in the background at startup and every six hours:

- downloads the current Feed List;
- selects every Feed whose membership is `Joined`, primary region is `US`, and language is `English`;
- keeps every distinct Feed ID, including multiple Feeds from one advertiser;
- ignores visible `Not Joined` advertisers;
- validates allowlisted Awin download hosts and upgrades Awin-provided HTTP links to HTTPS;
- stores each `advertiserId:feedId` with Awin's `Last Imported` value and downloads only changed Feeds;
- processes at most five Feeds concurrently and retries only the failed Feed, at most twice with jitter;
- enforces at most five downloads of the same Feed in a rolling hour;
- preserves a per-Feed last-known-good normalized cache and uses it when an updated source times out or fails validation;
- applies separate response and body-stall timeouts, then schedules compensation refreshes after approximately 1, 2, 5, and 10 minutes;
- validates and atomically replaces the aggregate snapshot without interrupting reads from the previous snapshot.

When `AWIN_SOURCE_FEED_LIST_URL` is configured it is authoritative; any legacy
`AWIN_SOURCE_FEED_URL`, `AWIN_SOURCE_FEED_URL_2`, and later values are ignored. Direct URLs remain a
fallback for deployments without a Feed List and support `_2` through `_10`.

The service accepts only USD rows with a numeric merchant ID, a consistent merchant name and HTTPS
merchant host within the snapshot, and an Awin link containing publisher `3047955` plus the same
merchant ID. It never ranks by commission. Compressed inputs remain capped at 4 MB. Feed List
sources use bounded streaming decompression and parsing up to 64 MB per source; raw source downloads
remain capped at 4 MB. The separately bounded aggregate snapshot is capped at 80 MB uncompressed
and 8 MB compressed.

## Health and client connection

`GET /health` is the Railway liveness check and remains `200` while the process runs. `GET /ready`
is `200` only after a validated snapshot exists. Health metadata includes `lastSuccessfulRefreshAt`,
`snapshotAgeSeconds`, `consecutiveRefreshFailures`, source/exclusion/stale-cache counts, and bounded
failure codes. A snapshot older than eight hours emits a Railway log alert but remains available.
Per-source diagnostics contain only `feedKeyHash`, host, position, phase, attempt, TTFB, bytes, and
duration; private source URLs and credentials are never logged.

GitHub-installed clients use only the public read-only Search API:

```dotenv
AWIN_PRODUCT_SEARCH_URL=https://findcheap-agent-production.up.railway.app/v1/search
AWIN_PRODUCT_SEARCH_TIMEOUT_MS=5000
```

Raw `GET /v1/feed` stays protected by `AWIN_FEED_API_TOKEN`; public `POST /v1/search` is bounded and
rate-limited. The plugin retries this read-only search once within its existing timeout budget. It
receives neither the Awin Feed List URL nor either token.

## Verification

After deployment, verify `/ready` reports nonzero `sourceFeeds`, `feedRows`, and
`lastSuccessfulRefreshAt`; restart the service and verify the same source count is restored. Then search at
least one product from an existing programme and one from a newly joined programme. A new programme
becomes eligible only after Awin marks it `Joined` and publishes a matching US English Feed.
