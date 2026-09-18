#!/usr/bin/env python3
"""Vercel Serverless Function handler for LinkTrace API."""

from __future__ import annotations

import json
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

try:
    import engine
except ImportError:
    engine = None


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        self._handle_api(parsed)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        if path == "/api/records":
            try:
                length = int(self.headers.get("Content-Length", 0))
                raw = self.rfile.read(length) if length > 0 else b"{}"
                payload = json.loads(raw.decode("utf-8"))

                record_type = payload.get("type", "suspects")
                record_data = payload.get("data", {})
                data = engine.load_data() if engine else {}

                if engine:
                    created = engine.create_record(data, record_type, record_data)
                else:
                    record_data["id"] = record_data.get("id") or f"REC-{len(data.get(record_type, [])) + 1}"
                    created = record_data

                self._json({"success": True, "record": created}, 201)
            except Exception as exc:
                self._json({"error": str(exc)}, 400)
            return

        self._json({"error": "Unknown POST endpoint"}, 404)

    def _handle_api(self, parsed) -> None:
        try:
            data = engine.load_data() if engine else {}
            path = parsed.path.rstrip("/")
            query = parse_qs(parsed.query)

            if path == "/api/overview":
                payload = engine.overview(data) if engine else {}
            elif path == "/api/search":
                payload = engine.search(data, query.get("q", [""])[0], query.get("type", ["all"])[0]) if engine else {}
            elif path == "/api/graph":
                focus = query.get("focus", [None])[0]
                payload = engine.graph_for(data, focus) if engine else {"nodes": [], "links": []}
            elif path == "/api/timeline":
                payload = engine.timeline(data, query.get("suspect", [None])[0]) if engine else []
            elif path == "/api/geo":
                payload = engine.geo_data(data) if engine else []
            elif path == "/api/intel":
                payload = engine.analyze_intelligence(data) if engine else {}
            elif path == "/api/path":
                start = query.get("from", [None])[0]
                end = query.get("to", [None])[0]
                if not start or not end:
                    self._json({"error": "Missing 'from' or 'to' query parameter"}, 400)
                    return
                payload = engine.shortest_path(data, start, end) if engine else {}
            elif path.startswith("/api/suspects/"):
                suspect_id = path.split("/")[-1]
                payload = engine.get_suspect(data, suspect_id) if engine else None
                if payload is None:
                    self._json({"error": "Suspect not found"}, 404)
                    return
            elif path == "/api/suspects":
                payload = data.get("suspects", [])
            elif path == "/api/firs":
                payload = data.get("firs", [])
            elif path == "/api/vehicles":
                payload = data.get("vehicles", [])
            elif path == "/api/calls":
                payload = data.get("calls", [])
            elif path == "/api/transactions":
                payload = data.get("transactions", [])
            else:
                self._json({"error": f"Unknown endpoint: {path}"}, 404)
                return

            self._json(payload)
        except Exception as exc:
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
