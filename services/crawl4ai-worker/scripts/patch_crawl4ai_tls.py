from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path


UNSAFE_LINES = (
    b'            "--ignore-certificate-errors",\n'
    b'            "--ignore-certificate-errors-spki-list",\n'
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", type=Path, required=True)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--proof", type=Path)
    args = parser.parse_args()

    source = args.target.read_bytes()
    actual_hash = hashlib.sha256(source).hexdigest()
    if actual_hash != args.expected_sha256.lower():
        print(
            f"crawl4ai browser_manager.py hash mismatch: expected "
            f"{args.expected_sha256.lower()}, got {actual_hash}",
            file=sys.stderr,
        )
        return 1
    if source.count(UNSAFE_LINES) != 2:
        print("expected exactly two upstream TLS-bypass flag pairs", file=sys.stderr)
        return 1

    patched = source.replace(UNSAFE_LINES, b"")
    if b"--ignore-certificate-errors" in patched:
        print("TLS-bypass flag remains after patch", file=sys.stderr)
        return 1
    args.target.write_bytes(patched)
    patched_hash = hashlib.sha256(patched).hexdigest()
    if args.proof:
        args.proof.write_text(patched_hash + "\n", encoding="ascii")
    print(patched_hash)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
