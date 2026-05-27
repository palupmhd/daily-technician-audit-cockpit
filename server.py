#!/usr/bin/env python3
"""
server.py — Audit Map local server with shared notes support.

Menggantikan: python -m http.server 8787

Features:
- Serve dist/ folder (static files)
- GET  /api/notes/:date       → baca notes hari ini
- POST /api/notes/:date       → simpan notes (merge, tidak overwrite)
- GET  /api/notes/:date/poll  → long-poll untuk notifikasi update

Notes disimpan di dist/notes/YYYY-MM-DD.json — satu file per tanggal.
Semua komputer di jaringan yang sama bisa akses via IP server.

Usage:
    python server.py              # port 8787, bind 0.0.0.0
    python server.py --port 8080  # port custom
    python server.py --local      # bind 127.0.0.1 saja (tidak bisa diakses dari luar)

Akses dari komputer lain:
    http://<IP-komputer-server>:8787
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Dict, List
from urllib.parse import urlparse


# ── CONFIG ────────────────────────────────────────────────────────────────────
DIST_DIR = Path(__file__).parent / "dist"
NOTES_DIR = DIST_DIR / "notes"
SYNC_CFG  = DIST_DIR / "config" / "sync.json"
POLL_TIMEOUT = 25  # seconds for long-poll
# ─────────────────────────────────────────────────────────────────────────────

# Long-poll subscribers: date_str -> list of (event, timestamp)
_poll_lock = threading.Lock()
_poll_events: Dict[str, float] = {}  # date -> last_update_time
_poll_waiters: Dict[str, List[threading.Event]] = {}  # date -> list of events
_notes_lock = threading.Lock()


def get_local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def notify_waiters(date: str) -> None:
    with _poll_lock:
        _poll_events[date] = time.time()
        waiters = _poll_waiters.pop(date, [])
    for ev in waiters:
        ev.set()


def wait_for_update(date: str, since: float) -> bool:
    """Block until notes for `date` updated after `since`. Returns True if updated."""
    with _poll_lock:
        last = _poll_events.get(date, 0)
        if last > since:
            return True
        ev = threading.Event()
        _poll_waiters.setdefault(date, []).append(ev)
    return ev.wait(timeout=POLL_TIMEOUT)


def read_notes(date: str) -> dict:
    path = NOTES_DIR / f"{date}.json"
    if not path.exists():
        return {}
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def write_notes(date: str, patch: dict) -> dict:
    """Merge patch into existing notes. Returns merged result."""
    NOTES_DIR.mkdir(parents=True, exist_ok=True)
    path = NOTES_DIR / f"{date}.json"
    with _notes_lock:
        existing = read_notes(date)
        # Patch overrides at issue-id level.
        existing.update(patch)
        tmp_path = path.with_suffix(".json.tmp")
        with tmp_path.open("w", encoding="utf-8") as f:
            json.dump(existing, f, ensure_ascii=False, indent=2)
        tmp_path.replace(path)
    notify_waiters(date)
    return existing


class AuditHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIST_DIR), **kwargs)

    def log_message(self, fmt, *args):
        # Suppress static file logs, only show API
        if "/api/" in (args[0] if args else ""):
            print(f"  {self.address_string()} {fmt % args}")

    def handle_error(self, request, client_address):
        # Suppress ConnectionAbortedError spam — expected from long-poll disconnect
        import sys
        exc_type = sys.exc_info()[0]
        if exc_type in (ConnectionAbortedError, BrokenPipeError, ConnectionResetError):
            return
        super().handle_error(request, client_address)

    def send_json(self, data: dict, status: int = 200) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def send_cors_headers(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_OPTIONS(self):
        self.send_cors_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")

        if parsed.path == "/favicon.ico":
            self.send_response(204)
            self.send_header("Cache-Control", "public, max-age=86400")
            self.end_headers()
            return

        # GET /api/notes/:date
        if path.startswith("/api/notes/") and not path.endswith("/poll"):
            date = path.split("/api/notes/")[-1]
            if not self._valid_date(date):
                return self.send_json({"error": "invalid date"}, 400)
            self.send_json(read_notes(date))
            return

        # GET /api/notes/:date/poll?since=<timestamp>
        if path.startswith("/api/notes/") and path.endswith("/poll"):
            date = path.split("/api/notes/")[-1].replace("/poll", "")
            if not self._valid_date(date):
                return self.send_json({"error": "invalid date"}, 400)
            from urllib.parse import parse_qs
            qs = parse_qs(parsed.query)
            since = float(qs.get("since", ["0"])[0])
            updated = wait_for_update(date, since)
            try:
                if updated:
                    notes = read_notes(date)
                    self.send_json({"updated": True, "notes": notes, "ts": time.time()})
                else:
                    self.send_json({"updated": False, "ts": time.time()})
            except (ConnectionAbortedError, BrokenPipeError, ConnectionResetError):
                pass  # client disconnected before response — normal for long-poll
            return

        # Serve static files
        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")

        # POST /api/notes/:date
        if path.startswith("/api/notes/"):
            date = path.split("/api/notes/")[-1]
            if not self._valid_date(date):
                return self.send_json({"error": "invalid date"}, 400)
            length = int(self.headers.get("Content-Length", 0))
            if length > 500_000:
                return self.send_json({"error": "payload too large"}, 413)
            try:
                body = self.rfile.read(length)
                patch = json.loads(body)
                if not isinstance(patch, dict):
                    raise ValueError("expected object")
            except Exception as e:
                return self.send_json({"error": f"invalid JSON: {e}"}, 400)
            merged = write_notes(date, patch)
            print(f"  [{date}] Notes updated — {len(merged)} issues tracked")
            self.send_json({"ok": True, "count": len(merged), "ts": time.time()})
            return

        self.send_json({"error": "not found"}, 404)

    @staticmethod
    def _valid_date(date: str) -> bool:
        import re
        return bool(re.match(r"^\d{4}-\d{2}-\d{2}$", date))


def set_sync_enabled(enabled: bool) -> None:
    """Write config/sync.json so the JS client knows whether to probe for sync."""
    try:
        SYNC_CFG.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "enabled": enabled,
            "_comment": "Set 'enabled' to true jika menggunakan server.py untuk fitur sync notes tim. server.py akan otomatis menulis file ini.",
        }
        tmp = SYNC_CFG.with_suffix(".json.tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
            f.write("\n")
        tmp.replace(SYNC_CFG)
    except Exception as e:
        print(f"  [warn] Tidak bisa tulis config/sync.json: {e}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit Map local server")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--local", action="store_true", help="Bind to 127.0.0.1 only")
    args = parser.parse_args()

    host = "127.0.0.1" if args.local else "0.0.0.0"
    local_ip = get_local_ip()

    NOTES_DIR.mkdir(parents=True, exist_ok=True)
    set_sync_enabled(True)   # tell the JS client sync is available

    server = ThreadingHTTPServer((host, args.port), AuditHandler)
    server.daemon_threads = True

    print(f"\n{'='*52}")
    print(f"  Audit Map Server")
    print(f"{'='*52}")
    print(f"  Komputer ini : http://localhost:{args.port}")
    if not args.local:
        print(f"  Dari jaringan: http://{local_ip}:{args.port}")
        print(f"\n  Bagikan URL ini ke anggota tim yang se-jaringan.")
    print(f"\n  Notes tersimpan di: dist/notes/")
    print(f"  Tekan Ctrl+C untuk stop.")
    print(f"{'='*52}\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    finally:
        set_sync_enabled(False)  # reset flag so static-server users don't get a stale probe


if __name__ == "__main__":
    main()
