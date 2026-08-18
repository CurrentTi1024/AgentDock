#!/usr/bin/env python3
"""
Local Argos Translate HTTP bridge for scripts/verify-i18n.mjs.

Implements the small subset of the MyMemory GET /get contract the verifier
uses, backed by the offline Argos Translate models installed on this machine:

  GET /get?q=<text>&langpair=en|<target>
  -> {"responseData": {"translatedText": "<translation>"}, "responseStatus": 200}

`q` may contain newline-separated lines; each line is translated and the
results are joined back with newlines so the JS verifier can align batches.

Usage:
  python3 scripts/argos-translate-server.py [--port 5599]
"""

import argparse
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from argostranslate import translate


class TranslateServer(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path != "/get":
            self.send_error(404, "not found")
            return
        params = parse_qs(parsed.query)
        q = params.get("q", [""])[0]
        langpair = params.get("langpair", [""])[0]
        try:
            source, target = langpair.split("|", 1)
        except ValueError:
            self.send_error(400, "bad langpair")
            return
        source = source.strip().lower()
        target = target.strip().lower()

        try:
            from_lang = next(
                lang for lang in translate.get_installed_languages() if lang.code == source
            )
            translation = next(
                t for t in from_lang.translations_from if t.to_lang.code == target
            )
        except StopIteration:
            self.send_error(400, f"language pair not installed: {source}->{target}")
            return

        lines = q.split("\n")
        try:
            translated = translation.translate_batch(lines)
        except (AttributeError, TypeError):
            translated = [translation.translate(line) for line in lines]
        body = json.dumps(
            {
                "responseData": {"translatedText": "\n".join(translated)},
                "responseStatus": 200,
            },
            ensure_ascii=False,
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args), file=sys.stderr)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=5599)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), TranslateServer)
    print(f"Argos Translate server listening on http://127.0.0.1:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
