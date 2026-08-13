FROM ubuntu/squid:6.10-24.10_edge@sha256:c9f5212b147a766529c7b026e2bebed37b998d33d0066b658596af5eba7cc65c

COPY infra/docker/crawl4ai-squid.conf /etc/squid/squid.conf
COPY infra/docker/crawl4ai-allowed-hosts.txt /etc/squid/allowed-hosts.txt

USER 13:13
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["squid", "-k", "check", "-f", "/etc/squid/squid.conf"]
ENTRYPOINT ["/usr/sbin/squid"]
CMD ["-N", "-f", "/etc/squid/squid.conf"]
