#!/usr/bin/env python3
"""Tiny static server for local preview of the Anteemonee site.

Two differences from `python3 -m http.server` that matter here:
  * sends Cache-Control: no-store, so an edited .js/.css is never served stale
    (a stale app.js is what caused the onboarding redirect loop earlier)
  * threaded, so parallel asset requests never queue behind each other
"""
import os
import re
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
BIND = sys.argv[2] if len(sys.argv) > 2 else "127.0.0.1"

# /ai-examiner/<subject>/<CODE>/ deep links are client-routed, so answer them
# with the AI Examiner app instead of a 404.
DEEP_EXAM_LINK = re.compile(r"^/ai-examiner/[A-Za-z0-9\-]+/[A-Za-z0-9]{6,}/?$")
# /payment/<CLICK-CODE>/?plan=… tracks the premium CTA the visitor used; the
# checkout app reads the path segment. Serve the payment app instead of 404.
DEEP_PAY_LINK = re.compile(r"^/payment/[A-Za-z0-9_\-]+/?$")


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".svg": "image/svg+xml",
        ".webp": "image/webp",
        ".woff2": "font/woff2",
        ".xml": "application/xml",
    }

    def translate_path(self, path):
        clean = path.split("?", 1)[0].split("#", 1)[0]
        if DEEP_EXAM_LINK.match(clean):
            return os.path.join(self.directory, "ai-examiner", "index.html")
        if DEEP_PAY_LINK.match(clean):
            return os.path.join(self.directory, "payment", "index.html")
        if clean.startswith("/payment/"):
            inner = clean[len("/payment/"):]
            # real file inside /payment/ wins (index.html, future assets);
            # otherwise fall back to the site-root twin so /payment/<code>/css/… works
            if inner:
                if os.path.exists(os.path.join(self.directory, "payment", inner)):
                    return super().translate_path(path)
                if os.path.exists(os.path.join(self.directory, inner)):
                    return os.path.join(self.directory, inner)
            return os.path.join(self.directory, "payment", "index.html")
        return super().translate_path(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        code = str(args[1]) if len(args) > 1 else ""
        if code.startswith(("4", "5")):
            sys.stderr.write("%s %s\n" % (code, args[0]))


if __name__ == "__main__":
    handler = partial(Handler, directory=ROOT)
    httpd = ThreadingHTTPServer((BIND, PORT), handler)
    httpd.daemon_threads = True
    print(f"Anteemonee preview -> http://{BIND}:{PORT}/", flush=True)
    httpd.serve_forever()
