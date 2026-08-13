FROM python:3.12-slim@sha256:ffd5d35f5cf6dfba89eaaebd93d5ad142faa7a7f2c728742c5b50cb81baff526

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    HOME=/tmp

RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin crawler
WORKDIR /app

COPY services/crawl4ai-worker/requirements.txt ./requirements.txt
COPY services/crawl4ai-worker/requirements.lock ./requirements.lock
COPY services/crawl4ai-worker/scripts/patch_crawl4ai_tls.py ./scripts/patch_crawl4ai_tls.py
RUN pip install --no-cache-dir --require-hashes -r requirements.lock \
    && python ./scripts/patch_crawl4ai_tls.py \
      --target /usr/local/lib/python3.12/site-packages/crawl4ai/browser_manager.py \
      --expected-sha256 76724e47ccace4cee8c5b654f3c132744d30d9a98706984d77517be06a317c3d \
      --proof /app/crawl4ai-browser-manager.patched.sha256 \
    && mkdir -p /ms-playwright \
    && python -m playwright install --with-deps chromium \
    && chmod -R a=rX /ms-playwright \
    && rm -rf /var/lib/apt/lists/*

COPY --chown=10001:10001 services/crawl4ai-worker/app ./app
COPY --chown=10001:10001 services/crawl4ai-worker/config ./config

USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=2).read()"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--limit-concurrency", "2", "--timeout-keep-alive", "2", "--no-access-log"]
