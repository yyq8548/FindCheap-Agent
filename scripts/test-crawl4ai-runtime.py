from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DOCKER = os.environ.get("DOCKER", "docker")


def run(*args: str, capture: bool = False, check: bool = True) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(
        [DOCKER, *args],
        cwd=ROOT,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=capture,
        check=False,
    )
    if check and completed.returncode != 0:
        raise RuntimeError(
            f"docker {' '.join(args)} failed ({completed.returncode})\n"
            f"{completed.stdout}\n{completed.stderr}"
        )
    return completed


def docker_exec(container: str, code: str) -> str:
    return run("exec", container, "python", "-c", code, capture=True).stdout.strip()


def restricted_create_args(name: str, network: str) -> list[str]:
    return [
        "create",
        "--name",
        name,
        "--network",
        network,
        "--read-only",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,nodev,size=256m",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges:true",
        "--security-opt",
        f"seccomp={ROOT / 'infra/docker/crawl4ai-seccomp.json'}",
        "--pids-limit",
        "128",
        "--memory",
        "768m",
        "--cpus",
        "1",
    ]


def proxy_create_args(name: str, network: str, address: str) -> list[str]:
    return [
        "create",
        "--name", name,
        "--network", network,
        "--ip", address,
        "--read-only",
        "--tmpfs", "/var/log/squid:rw,noexec,nosuid,nodev,size=16m,uid=13,gid=13,mode=0755",
        "--tmpfs", "/var/spool/squid:rw,noexec,nosuid,nodev,size=16m,uid=13,gid=13,mode=0755",
        "--tmpfs", "/run:rw,noexec,nosuid,nodev,size=4m,uid=13,gid=13,mode=0755",
        "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges:true",
        "--security-opt", f"seccomp={ROOT / 'infra/docker/crawl4ai-seccomp.json'}",
        "--pids-limit", "64",
        "--memory", "256m",
        "--cpus", "0.5",
    ]


def assert_running(container: str) -> None:
    for _ in range(10):
        state = run("inspect", "-f", "{{.State.Running}}", container, capture=True).stdout.strip()
        if state == "true":
            return
        time.sleep(0.5)
    logs = run("logs", container, capture=True, check=False)
    raise RuntimeError(f"{container} exited under runtime hardening\n{logs.stdout}\n{logs.stderr}")


def wait_for_health(container: str) -> None:
    code = "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=2).read().decode())"
    for _ in range(30):
        result = run("exec", container, "python", "-c", code, capture=True, check=False)
        if result.returncode == 0:
            if json.loads(result.stdout)["status"] != "ok":
                raise RuntimeError("worker health returned unexpected data")
            return
        time.sleep(1)
    logs = run("logs", container, capture=True, check=False)
    raise RuntimeError(f"worker did not become healthy\n{logs.stdout}\n{logs.stderr}")


def api_status(
    container: str, merchant_id: str, resource_path: str = "/catalog/p/1"
) -> tuple[int, str]:
    payload = json.dumps(
        {
            "merchantId": merchant_id,
            "resourcePath": resource_path,
            "extractionProfile": "product",
        }
    )
    code = (
        "import json,urllib.request,urllib.error;"
        f"d={payload!r}.encode();"
        "r=urllib.request.Request('http://127.0.0.1:8080/extract',data=d,headers={'Content-Type':'application/json'});"
        "\ntry:\n x=urllib.request.urlopen(r,timeout=20); print(x.status); print(x.read().decode())"
        "\nexcept urllib.error.HTTPError as e:\n print(e.code); print(e.read().decode())"
    )
    lines = docker_exec(container, code).splitlines()
    return int(lines[0]), "\n".join(lines[1:])


def main() -> int:
    if os.environ.get("RUN_CRAWL4AI_RUNTIME_SMOKE") != "1":
        print("SKIP: set RUN_CRAWL4AI_RUNTIME_SMOKE=1 to run destructive, task-scoped Docker smoke")
        return 0

    suffix = uuid.uuid4().hex[:8]
    prefix = f"shopping-task6-{suffix}"
    internal = f"{prefix}-internal"
    outbound = f"{prefix}-outbound"
    worker_smoke_image = f"{prefix}-worker"
    origin_image = f"{prefix}-origin"
    proxy_smoke_image = f"{prefix}-proxy"
    worker_base_image = f"{prefix}-base-worker"
    proxy_base_image = f"{prefix}-base-proxy"
    containers: list[str] = []
    images = [
        worker_smoke_image,
        origin_image,
        proxy_smoke_image,
        worker_base_image,
        proxy_base_image,
    ]
    networks = [internal, outbound]
    temp_parent = ROOT / ".superpowers"
    temp_parent.mkdir(exist_ok=True)
    temp_root = Path(tempfile.mkdtemp(prefix=f"{prefix}-", dir=temp_parent))

    def container(name: str) -> str:
        value = f"{prefix}-{name}"
        containers.append(value)
        return value

    try:
        run("build", "-f", "infra/docker/crawl4ai.Dockerfile", "-t", worker_base_image, ".")
        run("build", "-f", "infra/docker/crawl4ai-squid.Dockerfile", "-t", proxy_base_image, ".")

        certgen = container("certgen")
        run("create", "--name", certgen, "--entrypoint", "python", worker_base_image,
            "/tmp/generate-certs.py", "/tmp/certs")
        run("cp", str(ROOT / "tests/runtime/generate-crawl4ai-certs.py"), f"{certgen}:/tmp/generate-certs.py")
        run("start", "-a", certgen)
        certs = temp_root / "certs"
        certs.mkdir()
        run("cp", f"{certgen}:/tmp/certs/.", str(certs))

        proxy_url = f"http://{prefix}-egress:3128"
        merchants = {
            "egressEnforced": True,
            "proxyUrl": proxy_url,
            "merchants": {},
        }
        for merchant_id, host in {
            "shop": "shop.test",
            "disallow": "disallow.test",
            "redirect": "redirect.test",
            "page-redirect": "page-redirect.test",
        }.items():
            merchants["merchants"][merchant_id] = {
                "enabled": True,
                "auditState": "approved",
                "legalReview": "approved",
                "provenSource": "crawl4ai",
                "baseUrl": f"https://{host}/catalog/",
                "allowedHosts": [host],
                "profiles": {"product": {"allowedPathPrefixes": ["/catalog/p/"]}},
            }
        (temp_root / "merchants.json").write_text(json.dumps(merchants), encoding="utf-8")
        (temp_root / "allowed-hosts.txt").write_text(
            "shop.test\nbad.test\ndisallow.test\nredirect.test\npage-redirect.test\nrebind.test\n",
            encoding="ascii",
        )
        (temp_root / "worker.Dockerfile").write_text(
            f"FROM {worker_base_image}\nUSER root\nCOPY certs/ca.crt /usr/local/share/ca-certificates/task6.crt\n"
            "RUN update-ca-certificates && apt-get update "
            "&& apt-get install -y --no-install-recommends libnss3-tools "
            "&& rm -rf /var/lib/apt/lists/*\n"
            "COPY merchants.json /app/config/smoke.json\nUSER 10001:10001\n",
            encoding="utf-8",
        )
        (temp_root / "origin.Dockerfile").write_text(
            f"FROM {worker_base_image}\nUSER root\nCOPY certs /app/smoke/certs\n"
            "COPY crawl4ai-origin.py /app/smoke/origin.py\nUSER 10001:10001\n"
            'ENTRYPOINT ["python","/app/smoke/origin.py"]\n',
            encoding="utf-8",
        )
        shutil.copy2(ROOT / "tests/runtime/crawl4ai-origin.py", temp_root / "crawl4ai-origin.py")
        (temp_root / "proxy.Dockerfile").write_text(
            f"FROM {proxy_base_image}\nCOPY allowed-hosts.txt /etc/squid/allowed-hosts.txt\n",
            encoding="utf-8",
        )
        run("build", "-f", str(temp_root / "worker.Dockerfile"), "-t", worker_smoke_image, str(temp_root))
        run("build", "-f", str(temp_root / "origin.Dockerfile"), "-t", origin_image, str(temp_root))
        run("build", "-f", str(temp_root / "proxy.Dockerfile"), "-t", proxy_smoke_image, str(temp_root))

        run("network", "create", "--internal", "--subnet", "172.30.91.0/24", internal)
        run("network", "create", "--subnet", "93.184.216.0/24", outbound)

        origins = [
            ("allow-origin", "93.184.216.34", "allow", "good"),
            ("bad-origin", "93.184.216.35", "allow", "bad"),
            ("disallow-origin", "93.184.216.36", "disallow", "good"),
            ("redirect-origin", "93.184.216.37", "redirect", "good"),
            ("page-redirect-origin", "93.184.216.38", "page-redirect", "good"),
        ]
        for label, address, mode, cert_name in origins:
            name = container(label)
            args = restricted_create_args(name, outbound)
            args.extend(
                [
                    "--ip", address,
                    "-e", f"ORIGIN_MODE={mode}",
                    "-e", f"ORIGIN_CERT=/app/smoke/certs/{cert_name}.crt",
                    "-e", f"ORIGIN_KEY=/app/smoke/certs/{cert_name}.key",
                    origin_image,
                ]
            )
            run(*args)
            run("start", name)

        host_args = [
            "--add-host", "shop.test:93.184.216.34",
            "--add-host", "bad.test:93.184.216.35",
            "--add-host", "disallow.test:93.184.216.36",
            "--add-host", "redirect.test:93.184.216.37",
            "--add-host", "page-redirect.test:93.184.216.38",
            "--add-host", "evil.test:93.184.216.34",
            "--add-host", "sub.shop.test:93.184.216.34",
            "--add-host", "rebind.test:93.184.216.34",
        ]

        prod_proxy = container("prod-egress")
        args = proxy_create_args(prod_proxy, internal, "172.30.91.11")
        args.extend([*host_args, proxy_base_image])
        run(*args)
        run("network", "connect", outbound, prod_proxy)
        run("start", prod_proxy)
        assert_running(prod_proxy)

        helper = container("helper")
        args = restricted_create_args(helper, internal)
        args.extend(
            [
                *host_args,
                "--add-host", f"{prod_proxy}:172.30.91.11",
                "--add-host", f"{prefix}-egress:172.30.91.10",
                "--entrypoint", "sleep", worker_smoke_image, "300",
            ]
        )
        run(*args)
        run("start", helper)
        deny_code = (
            "import urllib.request,urllib.error;"
            f"o=urllib.request.build_opener(urllib.request.ProxyHandler({{'https':'http://{prod_proxy}:3128'}}));"
            "\ntry:o.open('https://shop.test/catalog/p/1',timeout=5);raise SystemExit('unexpected allow')"
            "\nexcept urllib.error.URLError as e:assert '403' in str(e);print('deny-all-ok')"
        )
        assert docker_exec(helper, deny_code) == "deny-all-ok"
        run("rm", "-f", prod_proxy)
        containers.remove(prod_proxy)

        proxy = container("egress")
        args = proxy_create_args(proxy, internal, "172.30.91.10")
        args.extend([*host_args, proxy_smoke_image])
        run(*args)
        run("network", "connect", outbound, proxy)
        run("start", proxy)
        assert_running(proxy)

        worker = container("worker")
        args = restricted_create_args(worker, internal)
        args.extend(
            [
                *host_args,
                "--add-host", f"{prefix}-egress:172.30.91.10",
                "-e", "CRAWLER_EGRESS_ENFORCED=true",
                "-e", "CRAWLER_MERCHANTS_CONFIG=/app/config/smoke.json",
                "-e", f"CRAWLER_PROXY_URL={proxy_url}",
                worker_smoke_image,
            ]
        )
        run(*args)
        run("start", worker)
        wait_for_health(worker)

        inspection = json.loads(run("inspect", worker, capture=True).stdout)[0]
        host_config = inspection["HostConfig"]
        assert inspection["Config"]["User"] == "10001:10001"
        assert host_config["ReadonlyRootfs"] is True
        assert host_config["CapDrop"] == ["ALL"]
        assert "no-new-privileges:true" in host_config["SecurityOpt"]
        assert any(option.startswith("seccomp=") for option in host_config["SecurityOpt"])
        assert host_config["PidsLimit"] == 128
        assert host_config["Memory"] == 768 * 1024 * 1024
        assert len(inspection["NetworkSettings"]["Networks"]) == 1
        assert docker_exec(worker, "import os;assert os.getuid()==10001;print('nonroot-ok')") == "nonroot-ok"
        namespace_probe = (
            "import ctypes,errno;libc=ctypes.CDLL(None,use_errno=True);"
            "flags=(0x10000000,0x40000000);"
            "assert all(libc.unshare(f)==-1 and ctypes.get_errno()==errno.EPERM for f in flags);"
            "assert libc.syscall(56,0x10000000|17,0,0,0,0)==-1;"
            "assert ctypes.get_errno()==errno.EPERM;print('namespaces-denied-ok')"
        )
        assert docker_exec(worker, namespace_probe) == "namespaces-denied-ok"
        readonly_probe = (
            "from pathlib import Path;"
            "\ntry:Path('/app/write-test').write_text('bad');raise SystemExit('rootfs writable')"
            "\nexcept OSError:Path('/tmp/write-test').write_text('ok');print('readonly-ok')"
        )
        assert docker_exec(worker, readonly_probe) == "readonly-ok"
        patch_probe = (
            "from pathlib import Path;"
            "p=Path('/usr/local/lib/python3.12/site-packages/crawl4ai/browser_manager.py').read_text();"
            "assert '--ignore-certificate-errors' not in p;"
            "assert len(Path('/app/crawl4ai-browser-manager.patched.sha256').read_text().strip())==64;"
            "print('tls-patch-ok')"
        )
        assert docker_exec(worker, patch_probe) == "tls-patch-ok"

        nss_setup = (
            "from pathlib import Path;import subprocess;"
            "Path('/tmp/.pki/nssdb').mkdir(parents=True);"
            "subprocess.run(['certutil','-N','--empty-password','-d','sql:/tmp/.pki/nssdb'],check=True);"
            "subprocess.run(['certutil','-A','-n','task6-ca','-t','C,,','-i',"
            "'/usr/local/share/ca-certificates/task6.crt','-d','sql:/tmp/.pki/nssdb'],check=True);"
            "print('nss-ready')"
        )
        assert docker_exec(worker, nss_setup) == "nss-ready"

        docs_code = (
            "import urllib.request,urllib.error;"
            "\nfor p in ('openapi.json','docs','redoc'):\n"
            " try:urllib.request.urlopen('http://127.0.0.1:8080/'+p);raise SystemExit('docs exposed')\n"
            " except urllib.error.HTTPError as e:assert e.code==404\n"
            "print('docs-disabled-ok')"
        )
        assert docker_exec(worker, docs_code) == "docs-disabled-ok"

        body_cap_code = (
            "import urllib.request,urllib.error;d=b'x'*2049;"
            "r=urllib.request.Request('http://127.0.0.1:8080/extract',data=d,method='POST');"
            "\ntry:urllib.request.urlopen(r);raise SystemExit('oversized request accepted')"
            "\nexcept urllib.error.HTTPError as e:assert e.code==413;print('body-cap-ok')"
        )
        assert docker_exec(worker, body_cap_code) == "body-cap-ok"

        robots_probe = (
            "import asyncio;from app.robots import SecureRobotsPolicy;"
            f"asyncio.run(SecureRobotsPolicy().authorize(target_url='https://shop.test/catalog/p/1',"
            f"allowed_hosts=frozenset({{'shop.test'}}),proxy_url='{proxy_url}'));"
            "print('robots-proxy-ok')"
        )
        assert docker_exec(worker, robots_probe) == "robots-proxy-ok"

        for attempt, path in enumerate(("/catalog/p/1", "/catalog/p/2"), start=1):
            status, body = api_status(worker, "shop", path)
            if status != 200:
                worker_logs = run("logs", worker, capture=True, check=False)
                proxy_logs = run("logs", proxy, capture=True, check=False)
                raise AssertionError(
                    f"allow crawl {attempt} failed: {(status, body)}\n"
                    f"WORKER:\n{worker_logs.stdout}{worker_logs.stderr}"
                    f"\nPROXY:\n{proxy_logs.stdout}{proxy_logs.stderr}"
                )
            if attempt == 2:
                assert "Cookie isolated" in body and "CANARY LEAKED" not in body, body
            else:
                assert "Synthetic member price" in body, body
        status, body = api_status(worker, "shop", "/catalog/p/oversized")
        assert status == 502 and "rawEvidence" not in body, (status, body)
        status, body = api_status(worker, "disallow")
        assert status == 403 and "robots" in body.lower(), (status, body)
        status, body = api_status(worker, "redirect")
        assert status == 403 and "robots" in body.lower(), (status, body)
        status, body = api_status(worker, "page-redirect")
        assert status in {403, 502}, (status, body)

        exact_host_code = (
            "import urllib.request,urllib.error;"
            f"o=urllib.request.build_opener(urllib.request.ProxyHandler({{'https':'{proxy_url}'}}));"
            "\nfor u in ('https://sub.shop.test/catalog/p/1','https://93.184.216.34/catalog/p/1'):\n"
            " try:o.open(u,timeout=5);raise SystemExit('unaudited destination allowed')\n"
            " except urllib.error.URLError as e:assert '403' in str(e)\n"
            "print('exact-host-and-ip-denied-ok')"
        )
        assert docker_exec(worker, exact_host_code) == "exact-host-and-ip-denied-ok"

        rebind_code = (
            "import socket;"
            f"p=('{prefix}-egress',3128);"
            "\ndef connect():\n"
            " s=socket.create_connection(p,timeout=5);"
            " s.sendall(b'CONNECT rebind.test:443 HTTP/1.1\\r\\nHost: rebind.test:443\\r\\n\\r\\n');"
            " status=s.recv(100).split(b'\\r\\n',1)[0];s.close();return status\n"
            "assert b' 200 ' in connect();print('dns-public-ok')"
        )
        assert docker_exec(worker, rebind_code) == "dns-public-ok"
        run("rm", "-f", proxy)
        containers.remove(proxy)
        proxy = container("egress")
        rebound_hosts = host_args[:-2] + ["--add-host", "rebind.test:10.0.0.1"]
        args = proxy_create_args(proxy, internal, "172.30.91.10")
        args.extend([*rebound_hosts, proxy_smoke_image])
        run(*args)
        run("network", "connect", outbound, proxy)
        run("start", proxy)
        assert_running(proxy)
        rebind_denied = rebind_code.replace(
            "assert b' 200 ' in connect();print('dns-public-ok')",
            "assert b' 403 ' in connect();print('dns-rebind-denied-ok')",
        )
        assert docker_exec(worker, rebind_denied) == "dns-rebind-denied-ok"

        tls_code = (
            "import asyncio;from app.main import Crawl4AIClient;"
            f"\nasync def t():\n c=Crawl4AIClient('{proxy_url}')\n"
            " try:r=await c.crawl('https://bad.test/catalog/p/1','product')\n"
            " except Exception as e:\n  assert 'cert' in str(e).lower();print('bad-cert-rejected');return\n"
            " assert not r.success and 'cert' in r.error_message.lower(),r\n print('bad-cert-rejected')\n"
            "asyncio.run(t())"
        )
        assert docker_exec(worker, tls_code) == "bad-cert-rejected"

        private_code = (
            "import urllib.request,urllib.error;"
            f"o=urllib.request.build_opener(urllib.request.ProxyHandler({{'https':'{proxy_url}'}}));"
            "\ntry:o.open('https://169.254.169.254/latest/meta-data',timeout=5);raise SystemExit('private allowed')"
            "\nexcept urllib.error.URLError as e:assert '403' in str(e);print('private-denied-ok')"
        )
        assert docker_exec(worker, private_code) == "private-denied-ok"

        direct_code = (
            "import urllib.request;"
            "\ntry:urllib.request.urlopen('https://example.com',timeout=3);raise SystemExit('direct outbound allowed')"
            "\nexcept Exception:print('direct-outbound-denied-ok')"
        )
        assert docker_exec(worker, direct_code) == "direct-outbound-denied-ok"
        print("PASS: final-image TLS, body/evidence limits, cookie isolation, robots, seccomp, proxy and network smoke")
        return 0
    finally:
        for name in reversed(containers):
            run("rm", "-f", name, check=False)
        for name in reversed(networks):
            run("network", "rm", name, check=False)
        for name in reversed(images):
            run("image", "rm", "-f", name, check=False)
        shutil.rmtree(temp_root, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
