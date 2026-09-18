#!/usr/bin/env python3
"""LinkTrace investigation API + static frontend (stdlib only)."""

from __future__ import annotations

import json
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

import engine  # noqa: E402

FRONTEND = ROOT / "frontend"
HOST = "127.0.0.1"
PORT = 8765


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(FRONTEND), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("[linktrace] " + (fmt % args) + "\n")

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self._handle_api(parsed)
            return
        if parsed.path == "/":
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api/records":
            try:
                length = int(self.headers.get("Content-Length", 0))
                raw = self.rfile.read(length) if length > 0 else b"{}"
                payload = json.loads(raw.decode("utf-8"))

                record_type = payload.get("type", "suspects")
                record_data = payload.get("data", {})
                data = engine.load_data()

                created = engine.create_record(data, record_type, record_data)
                self._json({"success": True, "record": created}, 201)
            except Exception as exc:
                self._json({"error": str(exc)}, 400)
            return

        self._json({"error": "Unknown POST endpoint"}, 404)

    def _handle_api(self, parsed) -> None:
        try:
            data = engine.load_data()
            path = parsed.path.rstrip("/")
            query = parse_qs(parsed.query)
            payload: object

            if path == "/api/overview":
                payload = engine.overview(data)
            elif path == "/api/search":
                payload = engine.search(data, query.get("q", [""])[0], query.get("type", ["all"])[0])
            elif path == "/api/graph":
                focus = query.get("focus", [None])[0]
                payload = engine.graph_for(data, focus)
            elif path == "/api/timeline":
                payload = engine.timeline(data, query.get("suspect", [None])[0])
            elif path == "/api/geo":
                payload = engine.geo_data(data)
            elif path == "/api/intel":
                payload = engine.analyze_intelligence(data)
            elif path == "/api/path":
                start = query.get("from", [None])[0]
                end = query.get("to", [None])[0]
                if not start or not end:
                    self._json({"error": "Missing 'from' or 'to' query parameter"}, 400)
                    return
                payload = engine.shortest_path(data, start, end)
            elif path.startswith("/api/suspects/"):
                suspect_id = path.split("/")[-1]
                payload = engine.get_suspect(data, suspect_id)
                if payload is None:
                    self._json({"error": "Suspect not found"}, 404)
                    return
            elif path == "/api/suspects":
                payload = data["suspects"]
            elif path == "/api/firs":
                payload = data["firs"]
            elif path == "/api/vehicles":
                payload = data["vehicles"]
            elif path == "/api/calls":
                payload = data["calls"]
            elif path == "/api/transactions":
                payload = data["transactions"]
            else:
                self._json({"error": "Unknown endpoint"}, 404)
                return

            self._json(payload)
        except Exception as exc:  # pragma: no cover - runtime safety
            self._json({"error": str(exc)}, 500)

    def _json(self, payload: object, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"LinkTrace running at http://{HOST}:{PORT}")
    print("API: /api/overview  /api/search?q=  /api/graph  /api/geo  /api/intel")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
