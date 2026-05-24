#!/usr/bin/env python3
"""
Daily Technician Audit Map compiler.

Raw Excel -> normalized routes/visits/issues -> partitioned JSON for HTML viewer.
Run from project root:
    python build_data.py

Optional:
    python build_data.py --raw raw --dist dist --cache cache --output output
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, date, time, timedelta
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import pandas as pd

EXCEL_EPOCH = pd.Timestamp("1899-12-30")


def clean_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and math.isnan(value):
        return ""
    text = str(value).strip()
    if text.lower() in {"nan", "nat", "none"}:
        return ""
    return re.sub(r"\s+", " ", text)


def norm_text(value: Any) -> str:
    return clean_str(value).upper().strip()


def safe_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        if isinstance(value, str):
            value = value.strip().replace(",", ".")
            if not value:
                return None
        f = float(value)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    except Exception:
        return None


def valid_lat_lng(lat: Any, lng: Any) -> Tuple[Optional[float], Optional[float]]:
    lat_f = safe_float(lat)
    lng_f = safe_float(lng)
    if lat_f is None or lng_f is None:
        return None, None
    if not (-90 <= lat_f <= 90 and -180 <= lng_f <= 180):
        return None, None
    return round(lat_f, 7), round(lng_f, 7)


def parse_coord(value: Any) -> Tuple[Optional[float], Optional[float]]:
    text = clean_str(value)
    if not text:
        return None, None
    # Accept "lat, lng" and variants with spaces.
    m = re.search(r"(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)", text)
    if not m:
        return None, None
    return valid_lat_lng(m.group(1), m.group(2))


def parse_date_value(value: Any) -> Optional[date]:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    if isinstance(value, pd.Timestamp):
        return value.date()
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, (int, float)):
        try:
            return (EXCEL_EPOCH + pd.to_timedelta(float(value), unit="D")).date()
        except Exception:
            return None
    text = clean_str(value)
    if not text or text == "-":
        return None
    # Prefer day-first for DD-MM-YYYY or DD/MM/YYYY vendor exports.
    parse_order = [{"dayfirst": True}, {}] if re.match(r"^\d{1,2}[-/]\d{1,2}[-/]\d{4}", text) else [{}, {"dayfirst": True}]
    for kwargs in parse_order:
        try:
            ts = pd.to_datetime(text, errors="raise", **kwargs)
            return ts.date()
        except Exception:
            pass
    return None


def parse_datetime_value(value: Any, fallback_date: Optional[date] = None) -> Optional[datetime]:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    if isinstance(value, pd.Timestamp):
        return value.to_pydatetime()
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, time.min)
    if isinstance(value, (int, float)):
        try:
            return (EXCEL_EPOCH + pd.to_timedelta(float(value), unit="D")).to_pydatetime()
        except Exception:
            return None
    text = clean_str(value)
    if not text or text == "-":
        return None
    parse_order = [True, False] if re.match(r"^\d{1,2}[-/]\d{1,2}[-/]\d{4}", text) else [False, True]
    for dayfirst in parse_order:
        try:
            ts = pd.to_datetime(text, errors="raise", dayfirst=dayfirst)
            if isinstance(ts, pd.Timestamp):
                return ts.to_pydatetime()
        except Exception:
            pass
    # Time-only string.
    if fallback_date:
        t = parse_time_value(text)
        if t:
            return datetime.combine(fallback_date, t)
    return None


def parse_time_value(value: Any) -> Optional[time]:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    if isinstance(value, datetime):
        return value.time().replace(microsecond=0)
    if isinstance(value, pd.Timestamp):
        return value.time().replace(microsecond=0)
    if isinstance(value, time):
        return value.replace(microsecond=0)
    if isinstance(value, (int, float)):
        try:
            frac = float(value) % 1
            total_seconds = int(round(frac * 86400))
            total_seconds %= 86400
            return (datetime.combine(date(2000, 1, 1), time.min) + timedelta(seconds=total_seconds)).time()
        except Exception:
            return None
    text = clean_str(value)
    if not text or text == "-":
        return None
    m = re.match(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?$", text)
    if m:
        h, mi, s = int(m.group(1)), int(m.group(2)), int(m.group(3) or 0)
        if 0 <= h < 24 and 0 <= mi < 60 and 0 <= s < 60:
            return time(h, mi, s)
    dt = parse_datetime_value(text)
    return dt.time().replace(microsecond=0) if dt else None


def dt_iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.strftime("%Y-%m-%dT%H:%M:%S") if dt else None


def time_label(dt: Optional[datetime]) -> str:
    return dt.strftime("%H:%M") if dt else "-"


def date_label(d: Optional[date]) -> str:
    return d.isoformat() if d else ""


def minutes_between(start: Optional[datetime], end: Optional[datetime]) -> Optional[int]:
    if not start or not end:
        return None
    return int(round((end - start).total_seconds() / 60))


def overlap_minutes(start: datetime, end: datetime, win_start: datetime, win_end: datetime) -> int:
    if end <= start:
        return 0
    latest_start = max(start, win_start)
    earliest_end = min(end, win_end)
    if earliest_end <= latest_start:
        return 0
    return int(round((earliest_end - latest_start).total_seconds() / 60))


def lunch_deduction(start: Optional[datetime], end: Optional[datetime], rules: Dict[str, Any]) -> int:
    if not start or not end or end <= start:
        return 0
    ws = parse_time_value(rules.get("lunchWindowStart", "11:00")) or time(11, 0)
    we = parse_time_value(rules.get("lunchWindowEnd", "13:30")) or time(13, 30)
    win_start = datetime.combine(start.date(), ws)
    win_end = datetime.combine(start.date(), we)
    # Only apply lunch deduction if the job STARTS before the lunch window.
    # Jobs that begin at or after lunchWindowStart are presumed to already
    # account for any break; deducting from them produces effectiveDuration=0
    # for short jobs fully inside the window, which is misleading.
    if start >= win_start:
        return 0
    deduction = overlap_minutes(start, end, win_start, win_end)
    return min(deduction, int(rules.get("maxLunchDeductionMin", 60)))


def effective_minutes(start: Optional[datetime], end: Optional[datetime], rules: Dict[str, Any]) -> Optional[int]:
    raw = minutes_between(start, end)
    if raw is None:
        return None
    return max(0, raw - lunch_deduction(start, end, rules))


def zone_clean(raw_zone: Any) -> str:
    z = norm_text(raw_zone)
    if z.startswith("ZN_SN_"):
        z = z[len("ZN_SN_"):]
    return z


def vehicle_zone_for(zone: str, alias: Dict[str, str]) -> str:
    z = norm_text(zone)
    return norm_text(alias.get(z, z))


def split_team(text: Any) -> List[str]:
    raw = clean_str(text)
    if not raw:
        return []
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    # Preserve original capitalization while de-duplicating by normalized name.
    seen = set()
    members = []
    for p in parts:
        key = norm_text(p)
        if key not in seen:
            members.append(p)
            seen.add(key)
    return members


def team_key(members: List[str]) -> str:
    keys = sorted(norm_text(m) for m in members if norm_text(m))
    return "|".join(keys)


def team_display(members: List[str]) -> str:
    # Display alphabetically for stable A,B = B,A.
    return ", ".join(sorted(members, key=lambda x: norm_text(x)))


def status_summary(statuses: Iterable[str]) -> str:
    values = [norm_text(s) for s in statuses if clean_str(s)]
    if not values:
        return "unknown"
    done = ["SELESAI" in s for s in values]
    pending = ["DITUNDA" in s for s in values]
    if all(done):
        return "done"
    if all(pending):
        return "postponed"
    return "mixed"


def location_type(location: str) -> str:
    loc = norm_text(location)
    if "PERJALANAN CABANG" in loc:
        return "travel_event"
    if loc.startswith("STHIRA CABANG"):
        return "branch_task"
    return "store_task"


def job_benchmark(job_type: str, unit_qty: Optional[float], cfg: Dict[str, Any], team_size: int = 1) -> Dict[str, Any]:
    jt = norm_text(job_type).lower()
    rule = cfg.get(jt) or cfg.get("default", {})
    qty = safe_float(unit_qty)
    if qty is None or qty <= 0:
        qty = 1
    setup = safe_float(rule.get("setupMin")) or 0
    min_per = safe_float(rule.get("minPerUnit")) or 0
    max_per = safe_float(rule.get("maxPerUnit")) or 0
    min_total_floor = safe_float(rule.get("minTotal")) or 0
    max_total_floor = safe_float(rule.get("maxTotal")) or 0

    raw_min = max(min_total_floor, setup + qty * min_per)
    raw_max = max(max_total_floor, setup + qty * max_per)
    if raw_max < raw_min:
        raw_max = raw_min

    # Team parallel factor; deliberately conservative.
    if team_size <= 1:
        parallel = 1.0
    elif team_size == 2:
        parallel = 1.4
    else:
        parallel = 1.7
    return {
        "expectedMin": int(round(raw_min / parallel)),
        "expectedMax": int(round(raw_max / parallel)),
        "setupMin": int(round(setup)),
        "unitQty": qty,
        "parallelFactor": parallel,
    }


def severity_by_delta(delta_min: int, rules: Dict[str, Any]) -> str:
    if delta_min >= int(rules.get("lateCriticalMin", 120)):
        return "high"  # "critical" not in current weight table; map to high for now
    if delta_min >= int(rules.get("lateHighMin", 60)):
        return "high"
    if delta_min >= int(rules.get("lateMediumMin", 30)):
        return "medium"
    return "low"


def severity_downgrade(sev: str) -> str:
    return {"high": "medium", "medium": "low", "low": "low"}.get(sev, sev)


def risk_level(score: int, rules: Dict[str, Any], issues: Optional[List[Dict[str, Any]]] = None) -> str:
    # Score-based band (existing logic)
    band_label = "Critical"
    for band in rules.get("riskBands", []):
        if score <= int(band.get("max", 9999)):
            band_label = band.get("label", "Unknown")
            break

    # Severity-aware override: a single high or multiple mediums should not be dismissed
    # by a low total score (e.g. 1 high issue = 5 = previously "Watch").
    if issues is not None and rules.get("severityOverride", True):
        # Count actionable issues only (exclude data quality noise types if present)
        noise_types = set(rules.get("noiseIssueTypes", ["missing_distance", "missing_coordinate", "attendance_in_missing", "attendance_out_missing"]))
        actionable = [i for i in issues if i.get("type") not in noise_types]
        high_count = sum(1 for i in actionable if i.get("severity") == "high")
        med_count = sum(1 for i in actionable if i.get("severity") == "medium")

        # Promotion rules:
        # - Any high issue → minimum "Needs Review"
        # - 2+ high issues OR 4+ medium issues → minimum "Critical"
        # - 3+ medium issues → minimum "Needs Review"
        order = ["Normal", "Watch", "Needs Review", "Critical"]
        def at_least(current: str, target: str) -> str:
            try:
                return target if order.index(target) > order.index(current) else current
            except ValueError:
                return current

        if high_count >= 2 or med_count >= 4:
            band_label = at_least(band_label, "Critical")
        elif high_count >= 1 or med_count >= 3:
            band_label = at_least(band_label, "Needs Review")
    return band_label


def add_issue(issues: List[Dict[str, Any]], **kwargs: Any) -> None:
    issue = {
        "id": kwargs.pop("id", None),
        "type": kwargs.pop("type"),
        "severity": kwargs.pop("severity", "low"),
        "message": kwargs.pop("message", ""),
        "routeId": kwargs.pop("routeId", None),
        "visitId": kwargs.pop("visitId", None),
        "visitSeq": kwargs.pop("visitSeq", None),
        "locationName": kwargs.pop("locationName", None),
        "recommendation": kwargs.pop("recommendation", None),
        "metrics": kwargs.pop("metrics", {}),
    }
    issue.update(kwargs)
    issue["id"] = issue["id"] or hashlib.md5(json.dumps(issue, sort_keys=True, default=str).encode()).hexdigest()[:12]
    issues.append(issue)


def pair_id(from_lat: float, from_lng: float, to_lat: float, to_lng: float) -> str:
    raw = f"{from_lat:.6f},{from_lng:.6f}->{to_lat:.6f},{to_lng:.6f}"
    return hashlib.md5(raw.encode()).hexdigest()[:16]


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def read_distance_cache(path: Path) -> Dict[str, Dict[str, Any]]:
    cache: Dict[str, Dict[str, Any]] = {}
    if not path.exists():
        return cache
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            pid = clean_str(row.get("pairId"))
            if not pid:
                continue
            dist = safe_float(row.get("distanceKm"))
            dur = safe_float(row.get("durationMin"))
            cache[pid] = {
                "distanceKm": dist,
                "durationMin": dur,
                "source": clean_str(row.get("source")),
                "notes": clean_str(row.get("notes")),
            }
    return cache


def as_jsonable(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: as_jsonable(v) for k, v in obj.items() if v is not None}
    if isinstance(obj, list):
        return [as_jsonable(v) for v in obj]
    if isinstance(obj, tuple):
        return [as_jsonable(v) for v in obj]
    if isinstance(obj, (datetime, pd.Timestamp)):
        return dt_iso(obj.to_pydatetime() if isinstance(obj, pd.Timestamp) else obj)
    if isinstance(obj, date):
        return obj.isoformat()
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    return obj


@dataclass
class BuildStats:
    task_rows: int = 0
    sn_task_rows: int = 0
    jobs: int = 0
    visits: int = 0
    routes: int = 0
    issues: int = 0
    gps_points: int = 0
    attendance_points: int = 0
    pending_distance_pairs: int = 0


def compact_gps_vehicle(vehicle: Dict[str, Any], max_points: int = 500) -> Dict[str, Any]:
    """Return GPS data optimized for browser rendering.

    The original vendor export can grow quickly. The viewer needs a readable trace,
    not every verbose address string in the route JSON. Keep first/last and a
    stable stride sample, while preserving rawPointCount for audit context.
    """
    points = list(vehicle.get("points") or [])
    raw_count = len(points)
    if raw_count > max_points and max_points > 2:
        stride = max(1, math.ceil(raw_count / max_points))
        sampled = [p for idx, p in enumerate(points) if idx % stride == 0]
        if sampled[-1] != points[-1]:
            sampled.append(points[-1])
    else:
        sampled = points

    # Compact point shape: [time, lat, lng, status]. Address is intentionally
    # omitted from the map payload because it dominates JSON size and is rarely
    # needed for path inspection.
    compact_points = [[p[0], p[1], p[2], p[3] if len(p) > 3 else ""] for p in sampled]
    return {
        "plate": vehicle.get("plate"),
        "vehicleType": vehicle.get("vehicleType"),
        "zone": vehicle.get("zone"),
        "user": vehicle.get("user"),
        "rawPointCount": raw_count,
        "pointCount": len(compact_points),
        "statusCounts": vehicle.get("statusCounts", {}),
        "points": compact_points,
    }


def write_json_min(path: Path, data: Any) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(as_jsonable(data), ensure_ascii=False, separators=(",", ":"))
    path.write_text(payload, encoding="utf-8")
    return len(payload.encode("utf-8"))


def read_excel_selected(path: Path, columns: Iterable[str]) -> pd.DataFrame:
    wanted = {clean_str(c) for c in columns}
    return pd.read_excel(path, usecols=lambda c: clean_str(c) in wanted)


def build(raw_dir: Path, dist_dir: Path, config_dir: Path, cache_dir: Path, output_dir: Path) -> BuildStats:
    stats = BuildStats()
    data_dir = dist_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)

    zone_alias = read_json(config_dir / "zone_alias.json", {})
    bench_cfg = read_json(config_dir / "job_benchmark.json", {})
    traffic_cfg = read_json(config_dir / "city_traffic_profile.json", {})
    rules = read_json(config_dir / "audit_rules.json", {})
    distance_cache = read_distance_cache(cache_dir / "distance_cache.csv")

    task_file = raw_dir / "db task progress.xlsx"
    store_file = raw_dir / "db daftar toko.xlsx"
    absen_file = raw_dir / "db longlat absen.xlsx"
    gps_file = raw_dir / "db gps.xlsx"
    vehicle_file = raw_dir / "db kendaraan.xlsx"

    task = read_excel_selected(task_file, [
        "Id", "Tanggal", "Zona", "Toko", "Cabang", "Jenis Pekerjaan", "Jumlah Unit",
        "Teknisi", "Tim Pekerjaan", "Mulai", "Selesai", "Catatan", "Catatan Masalah", "Status"
    ])
    stores = read_excel_selected(store_file, [
        "Cabang", "Zona", "Kode Toko", "Nama Toko", "Alamat", "Longitude", "Latitude"
    ])
    absens = read_excel_selected(absen_file, ["Tanggal", "Karyawan", "Type", "Jam", "Koordinat"])
    gps = read_excel_selected(gps_file, [
        "Waktu", "Plat", "Pengguna Kendaraan", "Status", "Status Posisi", "Koordinat GPS"
    ])
    vehicles = read_excel_selected(vehicle_file, ["Plat", "Zona", "Tipe Kendaraan"])
    stats.task_rows = len(task)

    # Store lookup by exact normalized full name.
    store_lookup: Dict[str, Dict[str, Any]] = {}
    for _, r in stores.iterrows():
        name = clean_str(r.get("Nama Toko"))
        if not name:
            continue
        lat, lng = valid_lat_lng(r.get("Latitude"), r.get("Longitude"))
        store_lookup[norm_text(name)] = {
            "storeName": name,
            "branch": clean_str(r.get("Cabang")),
            "zoneRaw": clean_str(r.get("Zona")),
            "storeCode": clean_str(r.get("Kode Toko")),
            "address": clean_str(r.get("Alamat")),
            "lat": lat,
            "lng": lng,
            "matchStatus": "matched_by_name",
        }

    # Vehicle lookup by plate.
    vehicle_by_plate: Dict[str, Dict[str, str]] = {}
    for _, r in vehicles.iterrows():
        plate = norm_text(r.get("Plat"))
        if not plate:
            continue
        z = zone_clean(r.get("Zona"))
        vehicle_by_plate[plate] = {
            "plate": clean_str(r.get("Plat")),
            "zone": z,
            "vehicleZone": vehicle_zone_for(z, zone_alias),
            "vehicleType": clean_str(r.get("Tipe Kendaraan")),
        }

    # Normalize attendance by date/name.
    attendance_by_date_member: Dict[Tuple[str, str], List[Dict[str, Any]]] = defaultdict(list)
    for _, r in absens.iterrows():
        d = parse_date_value(r.get("Tanggal"))
        employee = clean_str(r.get("Karyawan"))
        typ = clean_str(r.get("Type"))
        t = parse_time_value(r.get("Jam"))
        lat, lng = parse_coord(r.get("Koordinat"))
        if not d or not employee:
            continue
        dt = datetime.combine(d, t or time.min)
        item = {
            "employee": employee,
            "type": typ.lower(),
            "time": time_label(dt),
            "datetime": dt_iso(dt),
            "lat": lat,
            "lng": lng,
            "isMappable": lat is not None and lng is not None,
        }
        attendance_by_date_member[(d.isoformat(), norm_text(employee))].append(item)
        if item["isMappable"]:
            stats.attendance_points += 1

    # Normalize GPS by date + vehicle zone + plate.
    gps_by_date_zone: Dict[Tuple[str, str], Dict[str, Dict[str, Any]]] = defaultdict(dict)
    for _, r in gps.iterrows():
        dt = parse_datetime_value(r.get("Waktu"))
        plate_key = norm_text(r.get("Plat"))
        lat, lng = parse_coord(r.get("Koordinat GPS"))
        if not dt or not plate_key:
            continue
        veh = vehicle_by_plate.get(plate_key)
        if not veh:
            continue
        zone = veh["vehicleZone"]
        date_str = dt.date().isoformat()
        plate_display = veh["plate"]
        bucket = gps_by_date_zone[(date_str, zone)]
        if plate_key not in bucket:
            bucket[plate_key] = {
                "plate": plate_display,
                "vehicleType": veh.get("vehicleType"),
                "zone": zone,
                "user": clean_str(r.get("Pengguna Kendaraan")),
                "points": [],
                "statusCounts": defaultdict(int),
            }
        status_gps = clean_str(r.get("Status")) or clean_str(r.get("Status Posisi"))
        bucket[plate_key]["statusCounts"][status_gps or "unknown"] += 1
        if lat is not None and lng is not None:
            bucket[plate_key]["points"].append([time_label(dt), lat, lng, status_gps, clean_str(r.get("Alamat"))])
            stats.gps_points += 1

    for _, plate_map in gps_by_date_zone.items():
        for veh in plate_map.values():
            veh["points"].sort(key=lambda p: p[0])
            veh["pointCount"] = len(veh["points"])
            veh["statusCounts"] = dict(veh["statusCounts"])

    # Build jobs from task progress.
    sn = task[task["Zona"].astype(str).str.contains("_SN_", na=False)].copy()
    stats.sn_task_rows = len(sn)
    jobs_by_route: Dict[Tuple[str, str, str], List[Dict[str, Any]]] = defaultdict(list)
    global_issues: List[Dict[str, Any]] = []

    for row_idx, r in sn.reset_index(drop=False).iterrows():
        d = parse_date_value(r.get("Tanggal"))
        if not d:
            continue
        date_str = d.isoformat()
        z = zone_clean(r.get("Zona"))
        vz = vehicle_zone_for(z, zone_alias)
        members = split_team(r.get("Tim Pekerjaan"))
        if not members:
            lead = clean_str(r.get("Teknisi"))
            members = [lead] if lead else []
        tk = team_key(members)
        if not tk:
            tk = "UNKNOWN_TEAM"
        lead = clean_str(r.get("Teknisi")) or (members[0] if members else "")
        location = clean_str(r.get("Toko"))
        loc_key = norm_text(location)
        loc_type = location_type(location)
        store_info = store_lookup.get(loc_key)
        lat = lng = None
        match_status = "unmatched"
        branch = clean_str(r.get("Cabang"))
        store_code = ""
        address = ""
        if store_info:
            lat, lng = store_info["lat"], store_info["lng"]
            match_status = store_info["matchStatus"]
            branch = store_info.get("branch") or branch
            store_code = store_info.get("storeCode", "")
            address = store_info.get("address", "")
        show_on_map = loc_type != "travel_event" and lat is not None and lng is not None
        is_mappable = loc_type != "travel_event"
        start = parse_datetime_value(r.get("Mulai"), d)
        end = parse_datetime_value(r.get("Selesai"), d)
        # Guard against Excel serial end date parsed to wrong date or earlier than start.
        if start and end and end < start and end.date() == start.date():
            end = None
        duration_min = minutes_between(start, end)
        effective_min = effective_minutes(start, end, rules)
        job = {
            "jobId": str(clean_str(r.get("Id")) or row_idx),
            "sourceRow": int(row_idx),
            "date": date_str,
            "zone": z,
            "vehicleZone": vz,
            "teamKey": tk,
            "teamName": team_display(members),
            "members": members,
            "lead": lead,
            "locationName": location,
            "locationKey": loc_key,
            "locationType": loc_type,
            "isMappable": is_mappable,
            "showOnMap": show_on_map,
            "lat": lat,
            "lng": lng,
            "matchStatus": match_status,
            "branch": branch,
            "storeCode": store_code,
            "address": address,
            "jobType": clean_str(r.get("Jenis Pekerjaan")).lower(),
            "unitQty": safe_float(r.get("Jumlah Unit")),
            "status": "done" if "SELESAI" in norm_text(clean_str(r.get("Status","")) ) else "postponed" if "DITUNDA" in norm_text(clean_str(r.get("Status",""))) else clean_str(r.get("Status")),
            "start": start,
            "end": end,
            "startTime": time_label(start),
            "endTime": time_label(end),
            "startIso": dt_iso(start),
            "endIso": dt_iso(end),
            "durationMin": duration_min,
            "effectiveDurationMin": effective_min,
            "lunchDeductionMin": lunch_deduction(start, end, rules) if start and end else 0,
            "notes": clean_str(r.get("Catatan")),
            "problemNotes": clean_str(r.get("Catatan Masalah")),
        }
        jobs_by_route[(date_str, z, tk)].append(job)
        stats.jobs += 1

    all_routes_by_date_zone: Dict[Tuple[str, str], List[Dict[str, Any]]] = defaultdict(list)
    pending_pairs: Dict[str, Dict[str, Any]] = {}

    def compute_travel_duration(distance_km: float, vehicle_zone: str) -> float:
        profile = traffic_cfg.get(vehicle_zone) or traffic_cfg.get("DEFAULT", {})
        speed = safe_float(profile.get("avgSpeedKmH")) or 22
        buffer_min = safe_float(profile.get("bufferMin")) or 8
        return (distance_km / speed) * 60 + buffer_min

    def add_distance_pair(route_id: str, date_str: str, zone: str, from_obj: Dict[str, Any], to_obj: Dict[str, Any], purpose: str) -> Optional[Dict[str, Any]]:
        flt, flg, tlt, tlg = from_obj.get("lat"), from_obj.get("lng"), to_obj.get("lat"), to_obj.get("lng")
        if flt is None or flg is None or tlt is None or tlg is None:
            return None
        pid = pair_id(float(flt), float(flg), float(tlt), float(tlg))
        if pid not in distance_cache:
            pending_pairs[pid] = {
                "pairId": pid,
                "date": date_str,
                "zone": zone,
                "routeId": route_id,
                "purpose": purpose,
                "fromType": from_obj.get("type"),
                "fromLabel": from_obj.get("label") or from_obj.get("locationName"),
                "fromLat": flt,
                "fromLng": flg,
                "toType": to_obj.get("type"),
                "toLabel": to_obj.get("label") or to_obj.get("locationName"),
                "toLat": tlt,
                "toLng": tlg,
            }
        cache_row = distance_cache.get(pid)
        result = {"pairId": pid, **(cache_row or {})}
        # Compute durationMin if missing but distance is known
        if cache_row and safe_float(cache_row.get("distanceKm")) is not None and safe_float(cache_row.get("durationMin")) is None:
            # Resolve vehicle zone from route context — passed implicitly via outer 'vz'
            # but at this scope we use the zone parameter as fallback
            result["durationMin"] = round(compute_travel_duration(float(cache_row["distanceKm"]), zone), 1)
        return result

    for (date_str, z, tk), jobs in jobs_by_route.items():
        jobs.sort(key=lambda j: (j["start"] or datetime.max, j["sourceRow"]))
        route_id = hashlib.md5(f"{date_str}|{z}|{tk}".encode()).hexdigest()[:16]
        members = jobs[0]["members"]
        team_size = max(1, len(members))
        lead = jobs[0]["lead"]
        vz = jobs[0]["vehicleZone"]
        route_issues: List[Dict[str, Any]] = []
        visits: List[Dict[str, Any]] = []
        current: Optional[Dict[str, Any]] = None

        for job in jobs:
            same_as_current = current and current["locationKey"] == job["locationKey"]
            if same_as_current:
                current["jobs"].append(job)
                current["rawEndCandidates"].append(job.get("end"))
                current["rawStartCandidates"].append(job.get("start"))
                current["jobTypes"] = sorted(set(current["jobTypes"] + [job["jobType"]]))
                current["jobCount"] = len(current["jobs"])
                current["unitQtyTotal"] = sum((safe_float(j.get("unitQty")) or 0) for j in current["jobs"])
                current["statusSummary"] = status_summary(j.get("status") for j in current["jobs"])
            else:
                current = {
                    "visitId": f"{route_id}_V{len(visits)+1:03d}",
                    "seq": len(visits) + 1,
                    "type": job["locationType"],
                    "locationName": job["locationName"],
                    "locationKey": job["locationKey"],
                    "label": job["locationName"],
                    "lat": job["lat"],
                    "lng": job["lng"],
                    "isMappable": job["isMappable"],
                    "showOnMap": job["showOnMap"],
                    "matchStatus": job["matchStatus"],
                    "address": job["address"],
                    "branch": job["branch"],
                    "storeCode": job["storeCode"],
                    "jobs": [job],
                    "jobTypes": [job["jobType"]],
                    "jobCount": 1,
                    "unitQtyTotal": safe_float(job.get("unitQty")) or 0,
                    "rawStartCandidates": [job.get("start")],
                    "rawEndCandidates": [job.get("end")],
                    "statusSummary": status_summary([job.get("status")]),
                }
                visits.append(current)

        for v in visits:
            starts = [x for x in v.pop("rawStartCandidates") if x]
            ends = [x for x in v.pop("rawEndCandidates") if x]
            start = min(starts) if starts else None
            end = max(ends) if ends else None
            v["startIso"] = dt_iso(start)
            v["endIso"] = dt_iso(end)
            v["startTime"] = time_label(start)
            v["endTime"] = time_label(end)
            v["durationMin"] = minutes_between(start, end)
            v["lunchDeductionMin"] = lunch_deduction(start, end, rules) if start and end else 0
            v["effectiveDurationMin"] = effective_minutes(start, end, rules)
            v["jobs"] = [
                {
                    "jobId": j["jobId"],
                    "jobType": j["jobType"],
                    "unitQty": j["unitQty"],
                    "status": j["status"],
                    "startTime": j["startTime"],
                    "endTime": j["endTime"],
                    "startIso": j["startIso"],
                    "endIso": j["endIso"],
                    "durationMin": j["durationMin"],
                    "effectiveDurationMin": j["effectiveDurationMin"],
                    "lunchDeductionMin": j["lunchDeductionMin"],
                    "notes": j["notes"],
                    "problemNotes": j["problemNotes"],
                }
                for j in v["jobs"]
            ]
            if v["isMappable"] and not v["showOnMap"]:
                add_issue(route_issues, type="missing_coordinate", severity="medium", routeId=route_id, visitId=v["visitId"], visitSeq=v["seq"], locationName=v["locationName"], message=f"{v['locationName']} belum punya koordinat, jadi tidak tampil di map.", recommendation="Lengkapi Latitude/Longitude di db daftar toko.")
            if v["matchStatus"] == "unmatched" and v["type"] != "travel_event":
                add_issue(route_issues, type="location_unmatched", severity="high", routeId=route_id, visitId=v["visitId"], visitSeq=v["seq"], locationName=v["locationName"], message=f"{v['locationName']} tidak match ke db daftar toko.", recommendation="Samakan nama lokasi di task progress dengan db daftar toko.")

            # Job duration benchmark issues.
            for job in v["jobs"]:
                if job["effectiveDurationMin"] is None:
                    continue
                b = job_benchmark(job["jobType"], job["unitQty"], bench_cfg, team_size)
                job["benchmark"] = b
                if job["jobType"] == "tugas lain":
                    continue
                # Skip scoring for postponed jobs: by definition the job wasn't fully done.
                # Notes/problemNotes capture the reason; auditor reads those separately.
                if job.get("status") == "postponed":
                    continue
                actual = job["effectiveDurationMin"]
                if actual < b["expectedMin"]:
                    delta = b["expectedMin"] - actual
                    add_issue(route_issues, type="work_duration_too_short", severity="medium" if delta >= 30 else "low", routeId=route_id, visitId=v["visitId"], visitSeq=v["seq"], locationName=v["locationName"], message=f"Durasi {job['jobType']} terlalu cepat: {actual} menit, benchmark minimal {b['expectedMin']} menit.", recommendation="Cek bukti pekerjaan/foto/hasil perbaikan, terutama jika unit banyak.", metrics={"actualDurationMin": actual, "expectedMin": b["expectedMin"], "expectedMax": b["expectedMax"], "lunchDeductionMin": job.get("lunchDeductionMin", 0), "unitQty": job.get("unitQty")})
                elif actual > b["expectedMax"]:
                    delta = actual - b["expectedMax"]
                    add_issue(route_issues, type="work_duration_too_long", severity="medium" if delta >= 60 else "low", routeId=route_id, visitId=v["visitId"], visitSeq=v["seq"], locationName=v["locationName"], message=f"Durasi {job['jobType']} terlalu lama: {actual} menit, benchmark maksimal {b['expectedMax']} menit.", recommendation="Cek catatan kendala, sparepart, atau alasan pekerjaan memanjang.", metrics={"actualDurationMin": actual, "expectedMin": b["expectedMin"], "expectedMax": b["expectedMax"], "lunchDeductionMin": job.get("lunchDeductionMin", 0), "unitQty": job.get("unitQty")})

        # Attendance for route members.
        attendance: List[Dict[str, Any]] = []
        for member in members:
            attendance.extend(attendance_by_date_member.get((date_str, norm_text(member)), []))
        attendance.sort(key=lambda a: a.get("datetime", ""))

        if not any(a.get("type") == "in" for a in attendance):
            add_issue(route_issues, type="attendance_in_missing", severity="medium", routeId=route_id, message="Absen masuk member team tidak ditemukan.", recommendation="Cek data longlat absen atau nama teknisi di Tim Pekerjaan.")
        if not any(a.get("type") == "out" for a in attendance):
            add_issue(route_issues, type="attendance_out_missing", severity="low", routeId=route_id, message="Absen pulang member team tidak ditemukan.", recommendation="Cek data longlat absen atau nama teknisi di Tim Pekerjaan.")

        # Distance pairs and missing distance issues.
        mappable_visits = [v for v in visits if v.get("showOnMap")]
        start_att = next((a for a in attendance if a.get("type") == "in" and a.get("isMappable")), None)
        out_att = next((a for a in reversed(attendance) if a.get("type") == "out" and a.get("isMappable")), None)
        route_points: List[Dict[str, Any]] = []
        if start_att:
            route_points.append({"type": "attendance_in", "label": f"Absen masuk {start_att['employee']}", "lat": start_att["lat"], "lng": start_att["lng"], "time": start_att.get("time")})
        route_points.extend({"type": v["type"], "label": v["locationName"], "lat": v["lat"], "lng": v["lng"], "time": v.get("startTime"), "visitId": v["visitId"], "visitSeq": v["seq"]} for v in mappable_visits)
        if out_att:
            route_points.append({"type": "attendance_out", "label": f"Absen pulang {out_att['employee']}", "lat": out_att["lat"], "lng": out_att["lng"], "time": out_att.get("time")})

        route_distances: List[Dict[str, Any]] = []
        for idx in range(len(route_points)-1):
            from_obj, to_obj = route_points[idx], route_points[idx+1]
            if from_obj["lat"] == to_obj["lat"] and from_obj["lng"] == to_obj["lng"]:
                continue
            info = add_distance_pair(route_id, date_str, z, from_obj, to_obj, "route_sequence")
            if info:
                distance_item = {**info, "fromLabel": from_obj["label"], "toLabel": to_obj["label"], "fromType": from_obj["type"], "toType": to_obj["type"]}
                route_distances.append(distance_item)
                if info.get("distanceKm") is None:
                    add_issue(route_issues, type="missing_distance", severity="low", routeId=route_id, visitSeq=to_obj.get("visitSeq"), visitId=to_obj.get("visitId"), locationName=to_obj.get("label"), message=f"Distance belum tersedia: {from_obj['label']} → {to_obj['label']}.", recommendation="Isi distance_cache.csv untuk pair ini agar scoring travel aktif.", metrics={"pairId": info.get("pairId")})

        # Late first store/branch based on standard start plus briefing + setup + distance duration if available.
        first_visit = next((v for v in mappable_visits if v.get("startIso")), None)
        if first_visit:
            d_obj = datetime.strptime(date_str, "%Y-%m-%d").date()
            base_start_time = parse_time_value(rules.get("workStart", "08:00")) or time(8, 0)
            expected = datetime.combine(d_obj, base_start_time) + timedelta(minutes=int(rules.get("briefingMin", 15)))
            first_jobs = first_visit.get("jobs", [])
            setup = 0
            for j in first_jobs:
                b = job_benchmark(j.get("jobType", ""), j.get("unitQty"), bench_cfg, team_size)
                setup = max(setup, int(b.get("setupMin", 0)))
            expected += timedelta(minutes=setup)
            # Use first distance duration if available; otherwise use a conservative fallback 30 min but tell metrics.
            travel_dur = None
            if route_distances:
                first_leg = route_distances[0]
                if first_leg.get("toLabel") == first_visit.get("locationName"):
                    travel_dur = safe_float(first_leg.get("durationMin"))
            expected += timedelta(minutes=int(round(travel_dur if travel_dur is not None else 30)))
            expected += timedelta(minutes=int(rules.get("firstStoreGraceMin", 20)))
            actual = parse_datetime_value(first_visit.get("startIso"))
            if actual and actual > expected:
                delta = int(round((actual - expected).total_seconds()/60))
                # Check for travel_event before first mappable visit with notes that could justify the delay
                first_mappable_seq = first_visit.get("seq", 0)
                travel_events_before = [vv for vv in visits if vv.get("type") == "travel_event" and vv.get("seq", 0) < first_mappable_seq]
                justify_notes: List[str] = []
                for te in travel_events_before:
                    for jj in te.get("jobs", []):
                        note = (jj.get("notes") or "").strip()
                        if note and note != "-":
                            justify_notes.append(note)
                severity = severity_by_delta(delta, rules)
                # Auto-downgrade severity if there's a travel event with explanatory notes
                # Auditor still verifies, but it's not "unexplained late"
                downgraded = False
                if justify_notes and severity in ("high", "medium"):
                    severity = severity_downgrade(severity)
                    downgraded = True
                add_issue(route_issues, type="late_first_store", severity=severity, routeId=route_id, visitId=first_visit["visitId"], visitSeq=first_visit["seq"], locationName=first_visit["locationName"], message=f"Toko/lokasi pertama mulai {first_visit['startTime']}, estimasi latest {expected.strftime('%H:%M')}. Terlambat {delta} menit." + (" Ada catatan perjalanan sebelumnya — verifikasi." if downgraded else ""), recommendation="Klarifikasi aktivitas sebelum toko pertama dan cocokkan dengan absen/GPS.", metrics={"actualStart": first_visit["startTime"], "expectedLatest": expected.strftime("%H:%M"), "deltaMin": delta, "setupMin": setup, "travelDurationEstimatedMin": int(round(travel_dur if travel_dur is not None else 30)), "usedFallbackTravel": travel_dur is None, "justifiedByTravelEvent": downgraded, "travelEventNotes": justify_notes[:3] if justify_notes else None})

        # Travel gap scoring if distance duration exists.
        visit_by_id = {v["visitId"]: v for v in mappable_visits}
        for i in range(len(mappable_visits)-1):
            a, b = mappable_visits[i], mappable_visits[i+1]
            a_end = parse_datetime_value(a.get("endIso"))
            b_start = parse_datetime_value(b.get("startIso"))
            if not a_end or not b_start or b_start <= a_end:
                continue
            actual_gap = minutes_between(a_end, b_start) or 0
            lunch = lunch_deduction(a_end, b_start, rules)
            eff_gap = max(0, actual_gap - lunch)
            dist_item = add_distance_pair(route_id, date_str, z, {"type": a["type"], "label": a["locationName"], "lat": a["lat"], "lng": a["lng"]}, {"type": b["type"], "label": b["locationName"], "lat": b["lat"], "lng": b["lng"]}, "travel_gap")
            duration = safe_float(dist_item.get("durationMin")) if dist_item else None
            distance_km_used = safe_float(dist_item.get("distanceKm")) if dist_item else None
            if duration is not None:
                delta = int(round(eff_gap - duration))
                if delta > 30:
                    add_issue(route_issues, type="travel_gap_too_long", severity=severity_by_delta(delta, rules), routeId=route_id, visitId=b["visitId"], visitSeq=b["seq"], locationName=b["locationName"], message=f"Gap menuju {b['locationName']} terlalu lama: efektif {eff_gap} menit, estimasi travel {int(round(duration))} menit.", recommendation="Cek GPS kendaraan dan alasan jeda antar toko.", metrics={"actualGapMin": actual_gap, "lunchDeductionMin": lunch, "effectiveGapMin": eff_gap, "expectedTravelMin": int(round(duration)), "deltaMin": delta, "distanceKm": distance_km_used, "pairId": dist_item.get("pairId") if dist_item else None})

        # Risk score.
        weights = rules.get("riskWeights", {"high": 5, "medium": 3, "low": 1})
        score = sum(int(weights.get(i.get("severity", "low"), 1)) for i in route_issues)
        start_times = [parse_datetime_value(v.get("startIso")) for v in visits if v.get("startIso")]
        end_times = [parse_datetime_value(v.get("endIso")) for v in visits if v.get("endIso")]
        route = {
            "routeId": route_id,
            "date": date_str,
            "zone": z,
            "vehicleZone": vz,
            "teamKey": tk,
            "teamName": team_display(members),
            "lead": lead,
            "members": members,
            "teamSize": team_size,
            "startTime": time_label(min(start_times) if start_times else None),
            "endTime": time_label(max(end_times) if end_times else None),
            "visitCount": len(visits),
            "mappableVisitCount": len(mappable_visits),
            "jobCount": sum(v.get("jobCount", 0) for v in visits),
            "doneCount": sum(1 for v in visits if v.get("statusSummary") == "done"),
            "postponedCount": sum(1 for v in visits if v.get("statusSummary") == "postponed"),
            "mixedCount": sum(1 for v in visits if v.get("statusSummary") == "mixed"),
            "riskScore": score,
            "riskLevel": risk_level(score, rules, route_issues),
            "issues": route_issues,
            "visits": visits,
            "attendance": attendance,
            "distancePairs": route_distances,
        }
        all_routes_by_date_zone[(date_str, z)].append(route)
        stats.visits += len(visits)
        stats.routes += 1
        stats.issues += len(route_issues)

    # Write pending distance pairs.
    pending_path = output_dir / "distance_pairs_pending.csv"
    with pending_path.open("w", encoding="utf-8", newline="") as f:
        fieldnames = ["pairId", "date", "zone", "routeId", "purpose", "fromType", "fromLabel", "fromLat", "fromLng", "toType", "toLabel", "toLat", "toLng"]
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in sorted(pending_pairs.values(), key=lambda r: (r["date"], r["zone"], r["routeId"], r["pairId"])):
            writer.writerow(row)
    stats.pending_distance_pairs = len(pending_pairs)

    # Create files by date + zone.
    manifest: Dict[str, Any] = {
        "generatedAt": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "availableDates": [],
        "zones": [],
        "files": {},
        "stats": {},
        "notes": "Load manifest first, then date index, then date+zone detail. GPS is zone-level vehicle evidence, not team assignment.",
    }
    date_index: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"zones": {}})
    all_zones = set()

    for (date_str, z), routes in all_routes_by_date_zone.items():
        all_zones.add(z)
        routes.sort(key=lambda r: (-r["riskScore"], r["teamName"]))
        zone_issues = [issue for route in routes for issue in route["issues"]]
        vehicle_zone = vehicle_zone_for(z, zone_alias)
        gps_vehicles_raw = list(gps_by_date_zone.get((date_str, vehicle_zone), {}).values())
        gps_vehicles_raw.sort(key=lambda v: v.get("plate", ""))
        gps_vehicles = [compact_gps_vehicle(v) for v in gps_vehicles_raw]
        gps_raw_points = sum(v.get("rawPointCount", 0) for v in gps_vehicles)
        gps_render_points = sum(v.get("pointCount", 0) for v in gps_vehicles)
        summary = {
            "routeCount": len(routes),
            "visitCount": sum(r["visitCount"] for r in routes),
            "jobCount": sum(r["jobCount"] for r in routes),
            "issueCount": len(zone_issues),
            "highIssues": sum(1 for i in zone_issues if i.get("severity") == "high"),
            "mediumIssues": sum(1 for i in zone_issues if i.get("severity") == "medium"),
            "lowIssues": sum(1 for i in zone_issues if i.get("severity") == "low"),
            "riskScore": sum(r["riskScore"] for r in routes),
            "gpsVehicleCount": len(gps_vehicles),
            "gpsPointCount": gps_raw_points,
            "gpsRenderPointCount": gps_render_points,
        }

        y, m, _ = date_str.split("-")
        rel_dir = Path("data") / y / m
        out_dir = dist_dir / rel_dir
        out_dir.mkdir(parents=True, exist_ok=True)

        gps_filename = f"{date_str}.{z}.gps.json"
        gps_rel_path = str(rel_dir / gps_filename).replace("\\", "/")
        gps_data = {
            "date": date_str,
            "zone": z,
            "vehicleZone": vehicle_zone,
            "summary": {
                "gpsVehicleCount": len(gps_vehicles),
                "gpsPointCount": gps_raw_points,
                "gpsRenderPointCount": gps_render_points,
            },
            "gpsLayer": {"mode": "zone_vehicle", "vehicles": gps_vehicles},
        }
        write_json_min(out_dir / gps_filename, gps_data)

        data = {
            "date": date_str,
            "zone": z,
            "vehicleZone": vehicle_zone,
            "summary": summary,
            "gpsFile": gps_rel_path,
            "routes": routes,
            "issues": zone_issues,
        }
        filename = f"{date_str}.{z}.json"
        write_json_min(out_dir / filename, data)
        rel_path = str(rel_dir / filename).replace("\\", "/")
        date_index[date_str]["zones"][z] = {
            "file": rel_path,
            "gpsFile": gps_rel_path,
            **summary,
        }

    for date_str, idx in date_index.items():
        zones_summary = idx["zones"]
        idx["date"] = date_str
        idx["summary"] = {
            "routeCount": sum(z.get("routeCount", 0) for z in zones_summary.values()),
            "issueCount": sum(z.get("issueCount", 0) for z in zones_summary.values()),
            "highIssues": sum(z.get("highIssues", 0) for z in zones_summary.values()),
            "mediumIssues": sum(z.get("mediumIssues", 0) for z in zones_summary.values()),
            "lowIssues": sum(z.get("lowIssues", 0) for z in zones_summary.values()),
            "riskScore": sum(z.get("riskScore", 0) for z in zones_summary.values()),
        }
        y, m, _ = date_str.split("-")
        rel_dir = Path("data") / y / m
        out_dir = dist_dir / rel_dir
        filename = f"{date_str}.index.json"
        write_json_min(out_dir / filename, idx)
        manifest["files"][date_str] = {
            "index": str(rel_dir / filename).replace("\\", "/"),
            "zones": {z: meta["file"] for z, meta in zones_summary.items()},
        }

    manifest["availableDates"] = sorted(date_index.keys(), reverse=True)
    manifest["zones"] = sorted(all_zones)
    manifest["stats"] = as_jsonable(stats.__dict__)
    with (data_dir / "manifest.json").open("w", encoding="utf-8") as f:
        json.dump(as_jsonable(manifest), f, ensure_ascii=False, indent=2)

    with (output_dir / "build_summary.json").open("w", encoding="utf-8") as f:
        json.dump(as_jsonable({"stats": stats.__dict__, "manifest": manifest, "performanceNotes": ["GPS payload split into lazy-loaded .gps.json files.", "GPS points are compacted for map rendering; rawPointCount remains in summaries."]}), f, ensure_ascii=False, indent=2)

    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Daily Technician Audit Map data.")
    parser.add_argument("--raw", default="raw", help="Raw xlsx folder")
    parser.add_argument("--dist", default="dist", help="Dist folder containing index.html and data")
    parser.add_argument("--config", default="config", help="Config folder")
    parser.add_argument("--cache", default="cache", help="Cache folder")
    parser.add_argument("--output", default="output", help="Output folder for pending distance pairs and build summary")
    args = parser.parse_args()
    root = Path.cwd()
    stats = build(root / args.raw, root / args.dist, root / args.config, root / args.cache, root / args.output)
    print(json.dumps(as_jsonable(stats.__dict__), indent=2))
    print("Build complete. Open dist/index.html through a local server, e.g. cd dist && python -m http.server 8787")


if __name__ == "__main__":
    main()
