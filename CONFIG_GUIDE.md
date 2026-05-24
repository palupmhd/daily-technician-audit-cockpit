# Panduan Konfigurasi — Audit Map

Dokumen ini menjelaskan setiap parameter di folder `config/` — untuk apa, bagaimana cara mengubahnya, dan apa efeknya terhadap audit.

---

## `audit_rules.json`

File utama yang mengontrol **kapan** sebuah kondisi dianggap issue dan **seberapa serius** issue tersebut.

---

### Jam Kerja

```json
"workStart": "08:00"
```
Jam mulai kerja kontraktual. Digunakan sebagai titik awal penghitungan ekspektasi keberangkatan ke toko pertama. **Bukan** jam absen masuk — semua teknisi sudah absen sebelum jam ini (rata-rata 07:35).

```json
"briefingMin": 15
```
Estimasi durasi briefing/persiapan pagi di kantor cabang sebelum berangkat ke toko. Ditambahkan ke `workStart` untuk menghitung jam berangkat ideal. Nilai ini adalah asumsi flat — belum divalidasi dari data.

---

### Late First Store

```json
"firstStoreGraceMin": 15
```
Toleransi keterlambatan ke toko pertama **setelah** ekspektasi ideal (`workStart + briefing + travelEstimate + setupJob`). Teknisi yang tiba dalam 15 menit dari ekspektasi tidak di-flag. Nilai 5–10 menit terlalu ketat untuk kondisi lapangan, 20+ menit terlalu longgar.

```json
"lateMediumMin": 30
```
Delta (menit terlambat dari ekspektasi) yang memicu severity **Medium**. Artinya: terlambat 30–59 menit = perlu ditanya, ada kemungkinan penjelasan yang valid.

```json
"lateHighMin": 60
```
Delta yang memicu severity **High**. Terlambat 60–119 menit = harus ada penjelasan konkret, cek GPS dan catatan.

```json
"lateCriticalMin": 120
```
Delta yang mengindikasikan potensi masalah serius (2+ jam baru ke toko pertama). Saat ini masih di-map ke severity "high" karena tabel bobot belum memiliki tier "critical". Foundation untuk upgrade di masa depan.

> **Catatan penting:** Sistem secara otomatis menurunkan satu level severity (`lateHighMin` → Medium, `lateMediumMin` → Low) jika ada catatan `PERJALANAN CABANG` sebelum toko pertama dengan notes yang menjelaskan alasan. Auditor tetap perlu verifikasi, tapi issue tidak diperlakukan seagresif keterlambatan tanpa penjelasan.

---

### Makan Siang

```json
"lunchWindowStart": "11:00",
"lunchWindowEnd": "13:30",
"maxLunchDeductionMin": 60
```
Sistem secara otomatis mengurangi waktu istirahat makan siang dari durasi pekerjaan yang melintas jam makan siang. Contoh: pekerjaan mulai 10:00 selesai 14:00 (240 menit total) → dikurangi 60 menit istirahat → efektif 180 menit.

**Aturan penting:** potongan hanya berlaku jika pekerjaan **dimulai sebelum** `lunchWindowStart`. Pekerjaan yang dimulai pada atau setelah 11:00 tidak mendapat potongan — ini mencegah pekerjaan singkat di jam makan siang mendapat effective duration = 0.

`maxLunchDeductionMin` adalah batas maksimum potongan. Bahkan jika overlap lebih dari 60 menit, hanya 60 menit yang dipotong.

---

### Bobot dan Band Risiko

```json
"riskWeights": {
  "high": 5,
  "medium": 3,
  "low": 1
}
```
Bobot per severity untuk menghitung total risk score route. Score = jumlah (bobot × jumlah issue per severity).

```json
"riskBands": [
  {"max": 2,    "label": "Normal"},
  {"max": 6,    "label": "Watch"},
  {"max": 12,   "label": "Needs Review"},
  {"max": 9999, "label": "Critical"}
]
```
Mapping score ke label risiko. Route dengan score ≤2 = Normal (tidak ada issue berarti), ≤6 = perlu diperhatikan, ≤12 = perlu klarifikasi, >12 = investigasi prioritas.

```json
"severityOverride": true
```
Ketika `true`, sistem menerapkan aturan tambahan di atas score:
- ≥1 issue High → minimum **Needs Review** (terlepas dari score)
- ≥3 issue Medium → minimum **Needs Review**
- ≥2 issue High atau ≥4 issue Medium → minimum **Critical**

Ini memastikan route dengan 1 High issue tidak bisa lolos sebagai "Watch" hanya karena total score-nya kecil.

```json
"noiseIssueTypes": [
  "missing_distance",
  "missing_coordinate",
  "attendance_in_missing",
  "attendance_out_missing"
]
```
Issue-issue ini dikecualikan dari perhitungan `severityOverride` dan dari filter "Hanya yang perlu klarifikasi" di UI. Ini adalah masalah infrastruktur data, bukan masalah operasional teknisi.

---

## `job_benchmark.json`

Mendefinisikan berapa lama **yang wajar** untuk setiap jenis pekerjaan, per unit AC. Sistem membandingkan durasi aktual dengan range ini untuk memutuskan apakah pekerjaan terlalu cepat atau terlalu lama.

### Formula

```
expectedMin = max(minTotal, setupMin + qty × minPerUnit) ÷ parallelFactor
expectedMax = max(maxTotal, setupMin + qty × maxPerUnit) ÷ parallelFactor
```

**parallelFactor:** 1.0 (1 teknisi), 1.4 (2 teknisi), 1.7 (3+ teknisi). Mencerminkan efisiensi kerja paralel — tim lebih besar menyelesaikan lebih cepat.

**Catatan:** `minTotal` dan `maxTotal` adalah floor, bukan ceiling. Untuk unit banyak, formula per-unit yang menang. Ini mencegah benchmark terlalu kecil untuk pekerjaan skala besar.

---

### Parameter per Tipe Pekerjaan

#### `servis` — Kalibrasi dari 149 data points
```json
"setupMin": 5,
"minPerUnit": 15,
"maxPerUnit": 50,
"minTotal": 20,
"maxTotal": 180
```
Berdasarkan distribusi aktual: p10=15m/unit, p90=55m/unit (solo equivalent). Range ini mencakup ~80% pekerjaan normal. Di bawah 15m/unit = terlalu cepat (cek foto). Di atas 50m/unit = abnormal (cek catatan kendala).

#### `keluhan` — Rentang lebar, data terbatas
```json
"setupMin": 0,
"minPerUnit": 20,
"maxPerUnit": 180
```
Keluhan bersifat sangat bervariasi — dari pengecekan 30 menit hingga penggantian komponen yang butuh 3+ jam. Hanya 9 sample done tersedia, tidak cukup untuk kalibrasi lebih ketat. Range saat ini menggunakan default.

#### `ac baru` dan `tambah ac` — Identik, data terbatas
```json
"setupMin": 30,
"minPerUnit": 120,
"maxPerUnit": 240,
"minTotal": 120,
"maxTotal": 480
```
Instalasi AC baru adalah pekerjaan berat (bobok dinding, jalur instalasi, koneksi listrik). Minimum 2 jam per unit, maksimum 4 jam. `tambah ac` ke existing infrastructure seharusnya lebih cepat dari `ac baru` di lokasi baru, tapi saat ini disamakan karena data terlalu sedikit untuk memisahkan.

#### `bongkar geser` — Benchmark konservatif, perlu validasi
```json
"setupMin": 30,
"minPerUnit": 120,
"maxPerUnit": 240,
"minTotal": 120,
"maxTotal": 480
```
Hanya 1 sample tersedia (59 menit untuk 2 unit, jauh di bawah benchmark). Benchmark ini belum bisa divalidasi dari data — perlu konfirmasi ke teknisi senior berapa standar waktu bongkar geser 1 unit AC.

#### `bongkar` — Lebih ringan dari bongkar geser
```json
"setupMin": 15,
"minPerUnit": 45,
"maxPerUnit": 90
```
Purely dismantling tanpa reinstall di lokasi baru.

#### `tugas lain` — Tidak di-benchmark
```json
"minPerUnit": 0,
"maxPerUnit": 240
```
Pekerjaan ad-hoc yang tidak terdefinisi. Tidak ada batas minimum sehingga tidak akan pernah di-flag too_short.

---

## `city_traffic_profile.json`

Digunakan untuk menghitung estimasi waktu perjalanan antar toko ketika data jarak sudah tersedia. Formula:

```
estimasiMenit = (jarak_km / avgSpeedKmH) × 60 + bufferMin
```

`bufferMin` mencakup: parkir, masuk area toko, komunikasi dengan penanggung jawab toko, dan ketidakpastian jalan.

---

### Daftar Zona

| Zona | Speed | Buffer | Catatan |
|------|-------|--------|---------|
| JAKARTA | 15 km/h | 12 mnt | Traffic berat, parkir sulit |
| NON_SEWA | 15 km/h | 12 mnt | Operasi di Jabodetabek |
| PENGEMBANGAN | 15 km/h | 12 mnt | Jabodetabek (Cibinong, Jakarta Barat) |
| BEKASI | 17 km/h | 10 mnt | Lebih cair dari Jakarta |
| SURABAYA | 20 km/h | 8 mnt | Kota besar tapi lebih teratur |
| MEDAN | 20 km/h | 8 mnt | |
| BALI | 20 km/h | 8 mnt | Traffic Denpasar mirip kota besar |
| YOGYAKARTA | 20 km/h | 8 mnt | |
| JEMBER | 24 km/h | 6 mnt | Kota sedang |
| MANADO | 24 km/h | 6 mnt | |
| GORONTALO | 24 km/h | 6 mnt | |
| BENGKULU | 24 km/h | 6 mnt | |
| PONTIANAK | 23 km/h | 6 mnt | |
| PURWOKERTO | 24 km/h | 6 mnt | |
| BATAM | 23 km/h | 6 mnt | |
| SINGKAWANG | 25 km/h | 6 mnt | |
| SORONG | 30 km/h | 10 mnt | Traffic ringan, tapi buffer tetap 10 mnt |
| DEFAULT | 22 km/h | 8 mnt | Digunakan untuk zona yang tidak terdaftar |

> **Penting:** `city_traffic_profile.json` menggunakan nama **vehicle zone** (bukan audit zone). Zona seperti `JAKARTA_01`, `JAKARTA_03`, `JAKARTA_PROJECT` semuanya di-map ke `JAKARTA` via `zone_alias.json`, sehingga traffic profile JAKARTA yang dipakai.

---

## `zone_alias.json`

Memetakan nama zona audit ke nama vehicle zone. Vehicle zone digunakan untuk:
1. Menentukan GPS data mana yang diload (semua kendaraan dalam satu vehicle zone berbagi GPS file)
2. Menentukan traffic profile mana yang digunakan

```json
{
  "JAKARTA_01": "JAKARTA",
  "JAKARTA_03": "JAKARTA",
  "JAKARTA_PROJECT": "JAKARTA",
  "JAKARTA_PROJECT": "JAKARTA",
  "NON_SEWA": "JAKARTA",
  "PENGEMBANGAN": "JAKARTA",
  "PENGEMBANGAN_01": "PENGEMBANGAN",
  "PENGEMBANGAN_02": "PENGEMBANGAN",
  "PENGEMBANGAN_03": "PENGEMBANGAN",
  "PENGEMBANGAN_04": "PENGEMBANGAN"
}
```

Zona yang tidak ada di file ini menggunakan nama zonanya sendiri sebagai vehicle zone.

**Kapan perlu ditambah:** ketika ada zona audit baru yang kendaraannya berbagi pool dengan zona lain, atau ketika traffic profile zona tersebut tidak ada di `city_traffic_profile.json` dan ingin menggunakan profile zona lain.

---

## Cara Update

Setelah mengubah file config apapun, selalu jalankan rebuild:

```bash
cd audit-map-v7
python build_data.py
```

Kemudian buka `dist/` melalui server lokal:

```bash
cd dist && python -m http.server 8787
```

Atau untuk update distance cache dari Google Sheets sebelum rebuild:

```bash
python fill_distance.py
python build_data.py
```

---

## Pertanyaan yang Perlu Dijawab Tim Operasional

Beberapa nilai saat ini adalah asumsi yang belum divalidasi. Konfirmasi ke supervisor lapangan:

1. **`briefingMin: 15`** — Berapa lama rata-rata briefing pagi? Apakah berbeda untuk job kompleks (ac baru) vs rutin (servis)?
2. **`bongkar geser` benchmark** — Berapa waktu standar bongkar geser 1 unit AC menurut SOP?
3. **`tambah ac` vs `ac baru`** — Apakah keduanya memang membutuhkan waktu yang setara, atau `tambah ac` ke lokasi existing seharusnya lebih cepat?
4. **`firstStoreGraceMin: 15`** — Apakah 15 menit cukup sebagai toleransi, atau perlu disesuaikan per zona?
