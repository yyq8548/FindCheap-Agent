import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

type ComposeService = Record<string, unknown>;

describe("crawl4ai runtime boundary", () => {
  const root = resolve(import.meta.dirname, "../..");
  const compose = parse(readFileSync(resolve(root, "docker-compose.yml"), "utf8")) as {
    services: Record<string, ComposeService>;
    networks: Record<string, { internal?: boolean }>;
  };

  it("isolates the worker behind the only outward-facing egress proxy", () => {
    const worker = compose.services["crawl4ai-worker"];
    const proxy = compose.services["crawl4ai-egress"];

    if (!worker || !proxy) {
      throw new Error("crawl4ai worker and egress proxy must both be configured");
    }
    expect(worker.networks).toEqual(["crawler-internal"]);
    expect(proxy.networks).toEqual(["crawler-internal", "crawler-outbound"]);
    expect(compose.networks["crawler-internal"]?.internal).toBe(true);
    expect(worker.volumes).toBeUndefined();
    expect(worker.read_only).toBe(true);
    expect(worker.tmpfs).toContain("/tmp:rw,noexec,nosuid,nodev,size=256m");
    expect(worker.cap_drop).toEqual(["ALL"]);
    expect(worker.security_opt).toEqual(
      expect.arrayContaining([
        "no-new-privileges:true",
        "seccomp:infra/docker/crawl4ai-seccomp.json"
      ])
    );
    expect(worker.pids_limit).toBeLessThanOrEqual(128);
    expect(Number(worker.cpus)).toBeLessThanOrEqual(1);
    expect(worker.mem_limit).toBe("768m");

    const environment = worker.environment as Record<string, string>;
    expect(environment.CRAWLER_EGRESS_ENFORCED).toBe("true");
    expect(environment.CRAWLER_PROXY_URL).toBe("http://crawl4ai-egress:3128");
    expect(environment).not.toHaveProperty("DATABASE_URL");
    expect(environment).not.toHaveProperty("REDIS_URL");
  });

  it("uses a deny-by-default syscall profile", () => {
    const profile = JSON.parse(
      readFileSync(resolve(root, "infra/docker/crawl4ai-seccomp.json"), "utf8")
    ) as { defaultAction: string; syscalls: Array<{ action: string; names: string[] }> };

    expect(profile.defaultAction).toBe("SCMP_ACT_ERRNO");
    expect(profile.syscalls.length).toBeGreaterThan(0);
    expect(profile.syscalls.every((entry) => entry.action === "SCMP_ACT_ALLOW")).toBe(true);
    const allowed = new Set(profile.syscalls.flatMap((entry) => entry.names));
    expect(allowed.has("mount")).toBe(false);
    expect(allowed.has("ptrace")).toBe(false);
    expect(allowed.has("bpf")).toBe(false);
    expect(allowed.has("keyctl")).toBe(false);
  });

  it("ships a deny-all proxy policy until audited destinations are supplied", () => {
    const squid = readFileSync(resolve(root, "infra/docker/crawl4ai-squid.conf"), "utf8");
    const hosts = readFileSync(
      resolve(root, "infra/docker/crawl4ai-allowed-hosts.txt"),
      "utf8"
    )
      .split(/\r?\n/u)
      .filter(Boolean);
    expect(squid).toContain("http_access deny all");
    expect(squid).toContain("acl blocked_networks dst");
    expect(squid).toContain("http_access deny numeric_ipv4");
    expect(squid).toContain("http_access deny numeric_ipv6");
    expect(squid).toContain("acl audited_hosts dstdomain");
    expect(squid).toContain("http_access allow CONNECT audited_hosts ssl_ports");
    expect(squid).not.toMatch(/http_access allow\s+all/u);
    expect(hosts).toEqual(["no-audited-merchants.invalid"]);
    expect(hosts.every((host) => !host.startsWith(".") && !host.includes("*"))).toBe(true);
  });
});
