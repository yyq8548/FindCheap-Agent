FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    HOME=/tmp

RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin crawler
WORKDIR /app

COPY services/crawl4ai-worker/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt \
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
