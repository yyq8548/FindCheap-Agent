from __future__ import annotations

import os
import ssl
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


MODE = os.environ["ORIGIN_MODE"]


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/robots.txt":
            if MODE == "redirect":
                self.send_response(302)
                self.send_header("Location", "https://evil.test/robots.txt")
                self.end_headers()
                return
            policy = (
                b"User-agent: *\nDisallow: /catalog/\n"
                if MODE == "disallow"
                else b"User-agent: ShoppingAgentEvidenceBot\nAllow: /\n"
            )
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(policy)))
            self.end_headers()
            self.wfile.write(policy)
            return
        if self.path.startswith("/catalog/p/"):
            if MODE == "page-redirect":
                self.send_response(302)
                self.send_header("Location", "https://evil.test/catalog/p/1")
                self.end_headers()
                return
            leaked = False
            if self.path == "/catalog/p/oversized":
                body = b"<html><main>" + b"x" * 2_100_000 + b"</main></html>"
            elif self.path == "/catalog/p/2":
                leaked = "task6-canary=present" in self.headers.get("Cookie", "")
                body = (
                    b"<html><main>COOKIE CANARY LEAKED</main></html>"
                    if leaked
                    else b"<html><main>Cookie isolated</main></html>"
                )
            else:
                body = b"<html><main>Synthetic member price: $19</main></html>"
            self.send_response(500 if leaked else 200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            if self.path == "/catalog/p/1":
                self.send_header("Set-Cookie", "task6-canary=present; Path=/; Secure")
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        self.end_headers()

    def log_message(self, *_args) -> None:
        return None


server = ThreadingHTTPServer(("0.0.0.0", 443), Handler)
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain(os.environ["ORIGIN_CERT"], os.environ["ORIGIN_KEY"])
server.socket = context.wrap_socket(server.socket, server_side=True)
server.serve_forever()
