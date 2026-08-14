from __future__ import annotations

import subprocess
import sys
from pathlib import Path


SERVICE_ROOT = Path(__file__).resolve().parents[1]
PATCHER = SERVICE_ROOT / "scripts" / "patch_crawl4ai_tls.py"


def upstream_source() -> str:
    return (
        "prefix\n"
        '            "--ignore-certificate-errors",\n'
        '            "--ignore-certificate-errors-spki-list",\n'
        "middle\n"
        '            "--ignore-certificate-errors",\n'
        '            "--ignore-certificate-errors-spki-list",\n'
        "suffix\n"
    )


def test_tls_patcher_removes_both_upstream_flag_pairs_and_writes_proof(tmp_path: Path):
    target = tmp_path / "browser_manager.py"
    proof = tmp_path / "proof.sha256"
    target.write_bytes(upstream_source().encode("utf-8"))

    completed = subprocess.run(
        [
            sys.executable,
            str(PATCHER),
            "--target",
            str(target),
            "--expected-sha256",
            __import__("hashlib").sha256(target.read_bytes()).hexdigest(),
            "--proof",
            str(proof),
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 0, completed.stderr
    patched = target.read_text(encoding="utf-8")
    assert "ignore-certificate-errors" not in patched
    assert len(proof.read_text(encoding="ascii").strip()) == 64


def test_tls_patcher_fails_if_upstream_hash_or_exact_flag_count_drifts(tmp_path: Path):
    target = tmp_path / "browser_manager.py"
    target.write_bytes(upstream_source().replace("middle", "drift").encode("utf-8"))

    completed = subprocess.run(
        [
            sys.executable,
            str(PATCHER),
            "--target",
            str(target),
            "--expected-sha256",
            "0" * 64,
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode != 0
    assert "hash mismatch" in completed.stderr


def test_runtime_config_cannot_reintroduce_tls_bypass_flags():
    main_source = (SERVICE_ROOT / "app" / "main.py").read_text(encoding="utf-8")
    dockerfile = (SERVICE_ROOT.parents[1] / "infra" / "docker" / "crawl4ai.Dockerfile").read_text(
        encoding="utf-8"
    )

    assert "ignore_https_errors=False" in main_source
    assert "extra_args=[]" in main_source
    assert "--ignore-certificate-errors" not in main_source
    assert "--require-hashes" in dockerfile
    assert "patch_crawl4ai_tls.py" in dockerfile
