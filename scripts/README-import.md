# Stok listesini Excel/CSV'den sisteme aktarma

Bu script, **Stok Kodu | Stok Adı | Grubu | Birimi** sütunlarına sahip bir Excel (.xlsx, .xls) veya CSV dosyasını okuyup tüm ürünleri Supabase’e ekler veya günceller.

## Tablo formatı

| A (Stok Kodu) | B (Stok Adı)     | C (Grubu)        | D (Birimi) |
|---------------|------------------|------------------|------------|
| ST00168       | DS ETİ SUSAMLI ÇUBUK | ATIŞTIRMALIK | ADET       |
| ST00169       | DS ETİ HOŞBEŞ GOFRET |             | ADET       |

- CSV ise ayırıcı **noktalı virgül (;)** veya virgül (,) olabilir.
- İlk satır başlık ise (Stok Kodu, Stok Adı …) otomatik atlanır.

## 1. Bağımlılıkları kur

```bash
pip install -r scripts/requirements-import.txt
```

## 2. Scripti çalıştır

**Sadece CSV üretmek (Supabase kullanmadan):**

```bash
python scripts/import_stok_from_excel.py "C:\yol\subeler_stok.xlsx"
```

Çıkan `*_sisteme_aktarilacak.csv` dosyasını uygulama içindeki **Ürünler → CSV seç** ile içe aktarabilirsiniz.

**Doğrudan Supabase’e yazmak için:**

Proje kökünde `.env` veya `.env.local` dosyasına ekleyin:

```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

(Veya ortam değişkeni olarak verin.)

Sonra:

```bash
python scripts/import_stok_from_excel.py "C:\yol\subeler_stok.xlsx"
```

- Aynı **Stok Kodu** zaten varsa: ürün **güncellenir** (Stok Adı, Grubu, Birimi).
- Yoksa: **yeni ürün** eklenir.
- Grubu (kategori) yoksa `categories` tablosuna da eklenir.

## Örnek

```bash
cd c:\Users\ati\.gemini\antigravity\playground\sidereal-photosphere\stoksayim
pip install -r scripts/requirements-import.txt
python scripts/import_stok_from_excel.py "../subeler_stok.csv"
```
