from __future__ import annotations

import datetime
import ipaddress
import sys
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID


def key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def write_key(path: Path, private_key: rsa.RSAPrivateKey) -> None:
    path.write_bytes(
        private_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        )
    )


def main(output: Path) -> None:
    output.mkdir(parents=True, exist_ok=True)
    now = datetime.datetime.now(datetime.timezone.utc)
    ca_key = key()
    ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Task6 synthetic CA")])
    ca_cert = (
        x509.CertificateBuilder()
        .subject_name(ca_name)
        .issuer_name(ca_name)
        .public_key(ca_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=1))
        .not_valid_after(now + datetime.timedelta(days=1))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .sign(ca_key, hashes.SHA256())
    )
    (output / "ca.crt").write_bytes(ca_cert.public_bytes(serialization.Encoding.PEM))

    good_key = key()
    good_names = [
        "shop.test",
        "disallow.test",
        "redirect.test",
        "page-redirect.test",
        "evil.test",
    ]
    good_cert = (
        x509.CertificateBuilder()
        .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, good_names[0])]))
        .issuer_name(ca_name)
        .public_key(good_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=1))
        .not_valid_after(now + datetime.timedelta(days=1))
        .add_extension(
            x509.SubjectAlternativeName([x509.DNSName(name) for name in good_names]),
            critical=False,
        )
        .sign(ca_key, hashes.SHA256())
    )
    write_key(output / "good.key", good_key)
    (output / "good.crt").write_bytes(good_cert.public_bytes(serialization.Encoding.PEM))

    bad_key = key()
    bad_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "bad.test")])
    bad_cert = (
        x509.CertificateBuilder()
        .subject_name(bad_name)
        .issuer_name(bad_name)
        .public_key(bad_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=1))
        .not_valid_after(now + datetime.timedelta(days=1))
        .add_extension(x509.SubjectAlternativeName([x509.DNSName("bad.test")]), critical=False)
        .sign(bad_key, hashes.SHA256())
    )
    write_key(output / "bad.key", bad_key)
    (output / "bad.crt").write_bytes(bad_cert.public_bytes(serialization.Encoding.PEM))


if __name__ == "__main__":
    main(Path(sys.argv[1]))
