#!/usr/bin/env python3
"""
fill_distance.py — Sync distance dari Google Sheets ke distance_cache.csv

Sheet format (public, view-only):
  Kolom A: longlat1  (format: "lat,lng")
  Kolom B: longlat2  (format: "lat,lng")
  Kolom C: distance  (format: "12.9 km" atau "11 m")
  Kolom D: pairId    (diisi otomatis oleh script ini kalau kosong)

Usage:
  python fill_distance.py

Optional flags:
  --pending   output/distance_pairs_pending.csv  (default)
  --cache     cache/distance_cache.csv           (default)
  --sheet-id  Google Sheets ID                   (default: dari SHEET_ID di bawah)
  --gid       Sheet tab gid                      (default: dari SHEET_GID di bawah)
  --write-pairid   Tulis pairId ke kolom D Sheet (butuh akses edit + credentials)
  --dry-run   Tampilkan perubahan tanpa tulis ke cache
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
import urllib.request
from pathlib import Path
from typing import Dict, Optional, Tuple

# ── CONFIG ────────────────────────────────────────────────────────────────────
SHEET_ID = "1lOt7D-1BazRAxI5ALClaaNaaI-wTALgLFiTSlVhxTrU"
SHEET_GID = "63891919"
# ─────────────────────────────────────────────────────────────────────────────


def parse_distance_km(raw: str) -> Optional[float]:
    """Parse '12.9 km' -> 12.9, '11 m' -> 0.011, '166 km' -> 166.0"""
    raw = raw.strip()
    if not raw:
        return None
    m = re.match(r"^([\d.]+)\s*(km|m)$", raw, re.IGNORECASE)
    if not m:
        return None
    val = float(m.group(1))
    unit = m.group(2).lower()
    return round(val / 1000, 4) if unit == "m" else round(val, 4)


def parse_coord_cell(cell: str) -> Optional[Tuple[str, str]]:
    """Parse 'lat,lng' cell -> (lat_str, lng_str) preserving original precision."""
    cell = cell.strip()
    if not cell:
        return None
    parts = cell.split(",")
    if len(parts) != 2:
        return None
    lat, lng = parts[0].strip(), parts[1].strip()
    try:
        float(lat)
        float(lng)
    except ValueError:
        return None
    return lat, lng


def fetch_sheet_csv(sheet_id: str, gid: str) -> list[dict]:
    """Download sheet as CSV via public export URL."""
    url = (
        f"https://docs.google.com/spreadsheets/d/{sheet_id}"
        f"/export?format=csv&gid={gid}"
    )
    print(f"Fetching sheet: {url}")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8-sig")
    except Exception as e:
        print(f"ERROR: Gagal fetch sheet — {e}")
        sys.exit(1)

    lines = raw.splitlines()
    reader = csv.DictReader(lines)
    rows = list(reader)
    print(f"  {len(rows)} rows dari sheet.")
    return rows


def load_pending(path: Path) -> Dict[Tuple[str, str, str, str], str]:
    """Load pending CSV -> dict keyed by (fromLat, fromLng, toLat, toLng) -> pairId."""
    if not path.exists():
        print(f"WARNING: Pending file tidak ditemukan: {path}")
        return {}
    lookup: Dict[Tuple[str, str, str, str], str] = {}
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            key = (
                row["fromLat"].strip(),
                row["fromLng"].strip(),
                row["toLat"].strip(),
                row["toLng"].strip(),
            )
            lookup[key] = row["pairId"].strip()
    print(f"  {len(lookup)} pending pairs dimuat dari {path.name}.")
    return lookup


def load_cache(path: Path) -> Dict[str, dict]:
    """Load existing cache -> dict keyed by pairId."""
    cache: Dict[str, dict] = {}
    if not path.exists():
        return cache
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            pid = row.get("pairId", "").strip()
            if pid:
                cache[pid] = row
    return cache


def write_cache(path: Path, cache: Dict[str, dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = ["pairId", "distanceKm", "durationMin", "source", "notes"]
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in sorted(cache.values(), key=lambda r: r["pairId"]):
            writer.writerow({k: row.get(k, "") for k in fieldnames})


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync distance dari Google Sheets ke distance_cache.csv")
    parser.add_argument("--pending", default="output/distance_pairs_pending.csv")
    parser.add_argument("--cache", default="cache/distance_cache.csv")
    parser.add_argument("--sheet-id", default=SHEET_ID)
    parser.add_argument("--gid", default=SHEET_GID)
    parser.add_argument("--dry-run", action="store_true", help="Tampilkan perubahan tanpa tulis")
    args = parser.parse_args()

    root = Path.cwd()
    pending_path = root / args.pending
    cache_path = root / args.cache

    # 1. Load pending pairs untuk lookup pairId
    print("\n[1] Load pending pairs...")
    coord_to_pairid = load_pending(pending_path)

    # 2. Load existing cache
    print("\n[2] Load existing cache...")
    cache = load_cache(cache_path)
    print(f"  {len(cache)} entries di cache sekarang.")

    # 3. Fetch sheet
    print("\n[3] Fetch Google Sheet...")
    rows = fetch_sheet_csv(args.sheet_id, args.gid)

    # 4. Match dan update
    print("\n[4] Matching rows ke pairId...")
    added = 0
    updated = 0
    skipped_no_match = 0
    skipped_no_distance = 0
    errors = []

    for i, row in enumerate(rows, start=2):  # start=2 karena row 1 = header
        # Ambil kolom — Sheet mungkin punya nama kolom berbeda tergantung posisi
        # Support nama kolom longlat1/longlat2/distance ATAU kolom A/B/C
        keys = list(row.keys())
        col_a = row.get("longlat1") or row.get(keys[0], "") if keys else ""
        col_b = row.get("longlat2") or row.get(keys[1], "") if len(keys) > 1 else ""
        col_c = row.get("distance") or row.get(keys[2], "") if len(keys) > 2 else ""
        col_d = row.get("pairId") or row.get(keys[3], "") if len(keys) > 3 else ""

        # Parse koordinat
        from_coord = parse_coord_cell(col_a)
        to_coord = parse_coord_cell(col_b)
        if not from_coord or not to_coord:
            if col_a.strip() or col_b.strip():
                errors.append(f"  Row {i}: koordinat tidak bisa di-parse — '{col_a}' / '{col_b}'")
            continue

        # Parse distance
        dist_km = parse_distance_km(col_c)
        if dist_km is None:
            skipped_no_distance += 1
            continue

        # Cari pairId: prioritas dari kolom D sheet, fallback ke pending lookup
        pair_id = col_d.strip() if col_d.strip() else None
        if not pair_id:
            key = (from_coord[0], from_coord[1], to_coord[0], to_coord[1])
            pair_id = coord_to_pairid.get(key)

        if not pair_id:
            skipped_no_match += 1
            errors.append(f"  Row {i}: tidak match ke pending — '{col_a}' -> '{col_b}'")
            continue

        # Update cache
        if pair_id in cache:
            existing = float(cache[pair_id].get("distanceKm") or 0)
            if abs(existing - dist_km) < 0.01:
                continue  # Sudah sama, skip
            updated += 1
        else:
            added += 1

        cache[pair_id] = {
            "pairId": pair_id,
            "distanceKm": dist_km,
            "durationMin": "",
            "source": "gsheet",
            "notes": "",
        }

    # 5. Report
    print(f"\n  ✓ Baru ditambah : {added}")
    print(f"  ✓ Di-update     : {updated}")
    print(f"  ○ Skip (kosong) : {skipped_no_distance}")
    print(f"  ✗ Tidak match   : {skipped_no_match}")

    if errors:
        print(f"\n  Warnings ({len(errors)}):")
        for e in errors[:10]:
            print(e)
        if len(errors) > 10:
            print(f"  ... dan {len(errors)-10} lainnya.")

    # 6. Tulis cache
    if args.dry_run:
        print("\n[DRY RUN] Tidak ada yang ditulis ke cache.")
        return

    if added + updated == 0:
        print("\nTidak ada perubahan. Cache sudah up-to-date.")
        return

    print(f"\n[5] Tulis {len(cache)} entries ke {cache_path}...")
    write_cache(cache_path, cache)
    print("  Done. Sekarang jalankan: python build_data.py")


if __name__ == "__main__":
    main()
