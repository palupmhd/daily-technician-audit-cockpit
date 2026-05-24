# Daily Technician Audit Cockpit v1

Paket ini berisi:

- `build_data.py` — compiler Excel mentah menjadi JSON ringan per tanggal+zona.
- `dist/index.html` — audit cockpit berbasis Leaflet + OpenStreetMap.
- `config/` — konfigurasi zone alias, benchmark pekerjaan, traffic profile, dan audit rules.
- `output/distance_pairs_pending.csv` — pasangan koordinat yang perlu diisi distance-nya.
- `cache/distance_cache.csv` — tempat hasil distance dimasukkan kembali.

## Cara jalan cepat

1. Install dependency:

```bash
pip install -r requirements.txt
```

2. Build data:

```bash
python build_data.py
```

3. Buka HTML lewat local server:

```bash
cd dist
python -m http.server 8787
```

Lalu buka browser:

```text
http://localhost:8787
```

Jangan buka `dist/index.html` langsung lewat `file://`, karena browser biasanya memblokir load JSON lokal.

## Flow distance

Build pertama tetap jalan walau distance belum ada. Sistem akan membuat:

```text
output/distance_pairs_pending.csv
```

Isi hasil distance ke:

```text
cache/distance_cache.csv
```

Format:

```csv
pairId,distanceKm,durationMin,source,notes
```

`durationMin` boleh dikosongkan. Kalau kosong, Python memakai `distanceKm + city_traffic_profile.json` untuk estimasi waktu tempuh.

Setelah distance cache diisi, jalankan ulang:

```bash
python build_data.py
```

## Output report di HTML

- Export Audit Summary CSV
- Export Issue Evidence CSV
- Export Route Detail CSV
- Printable Report

## Catatan logic utama

- Entity utama adalah `route = tanggal + zona + teamKey`.
- `Tim Pekerjaan` dinormalisasi supaya `A,B` sama dengan `B,A`.
- Nama toko dimatch persis ke `db daftar toko`.
- `PERJALANAN CABANG` masuk timeline, tapi tidak tampil di map.
- `STHIRA CABANG` dianggap branch/mess task dan tampil di map jika koordinat tersedia.
- Multiple pekerjaan di lokasi yang sama digabung hanya kalau berurutan dalam sequence.
- GPS diperlakukan sebagai layer kendaraan per zona, bukan assignment team.
- Lunch allowance: overlap 11:00–13:30 dikurangi maksimal 60 menit sebelum dihitung anomaly.

## v3 performance notes

- GPS data is split into separate `*.gps.json` files and loaded only when the GPS toggle is enabled.
- Zone route JSON no longer embeds GPS traces, so initial date/zone load is lighter.
- GPS traces are compacted for browser rendering. `rawPointCount` is preserved in GPS summaries for audit visibility.
- HTML caches loaded date/zone and GPS JSON files in memory to avoid repeated fetches when switching filters.
- Map rendering uses Leaflet canvas renderers for route/GPS polylines.
- GPS points are not included in default map bounds, so selecting a route keeps the map focused on the audited route instead of zooming out to all vehicles in the zone.
- Route and issue lists are capped in the DOM; use search/filter to narrow large datasets.


## v4 map rendering fix
- Map panel is now absolute-positioned to avoid Leaflet size mismatch.
- Basemap switched to Esri Light Gray Canvas with OSM-light fallback.
- Repeated invalidateSize calls are used after layout/data changes to prevent partial tile rendering.


## v7 update
- Added GPS Points map toggle.
- GPS track now renders both polyline and sampled point markers using Leaflet circleMarker.
- Start/end GPS markers remain clickable.
- Map overlay shows rendered GPS track points and rendered GPS point markers.

Run:
```bash
cd dist
python -m http.server 8787
```
Then open http://localhost:8787 and hard refresh with Ctrl+F5.
