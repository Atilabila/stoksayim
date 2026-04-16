# Vercel deploy + Supabase CORS

Vercel’e deploy ettikten sonra **CORS / Çapraz köken isteği engellendi** hatası alıyorsanız:

## 1. Ortam değişkenleri (Vercel)

Vercel projesinde **Settings → Environment Variables** kısmına ekleyin:

- `VITE_SUPABASE_URL` = Supabase proje URL’iniz (örn. `https://xxxx.supabase.co`)
- `VITE_SUPABASE_ANON_KEY` = Supabase anon (public) key

Deploy’u bu değişkenlerle yeniden yapın (redeploy).

## 2. Supabase tarafında izin verilen adresler

Supabase Dashboard’da:

1. **Authentication → URL Configuration**
   - **Site URL:** `https://sizin-vercel-projeniz.vercel.app`
   - **Redirect URLs:** Aynı adresi ekleyin (ve gerekirse `https://*.vercel.app`)

2. **Project Settings → API** (varsa)
   - “Restrict API requests to specific origins” veya “Allowed origins” gibi bir alan varsa, Vercel adresinizi ekleyin: `https://sizin-vercel-projeniz.vercel.app`

Supabase varsayılanında tarayıcıdan gelen isteklere CORS izni verilir; yine de CORS hatası alıyorsanız yukarıdaki ayarları kontrol edin.

## 3. Hâlâ CORS hatası alıyorsanız

- Tarayıcıda **geliştirici araçları → Network** sekmesinde başarısız isteğe tıklayıp **Headers** kısmından:
  - **Request URL** (Supabase’e giden tam adres)
  - **Origin** (sayfanın açıldığı adres, örn. `https://xxx.vercel.app`)
  değerlerini kontrol edin. Supabase’te “Allowed origins” veya “Redirect URLs” listesinde bu Origin / Site URL’in geçtiğinden emin olun.

## 4. Stok kartları export / import formatı (Admin panel)

Admin paneldeki **“Ürünler” → “Stok kartları: Stok Kodu · Stok Adı · Grubu eşleşme listesi”** kutusunda:

- **CSV (UTF-8)** butonu:
  - Virgülle ayrılmış (`.csv`) dosya indirir.
  - Başlık satırı: `Stok Kodu, Stok Adı, Grubu, Maliyet, Birimi, Barkod, Durum`
  - Türkçe karakterler için UTF‑8 kullanılır; Excel’de açarken sorun yaşamamak için dosyayı doğrudan çift tıklayıp açabilirsiniz.

- **Excel (xlsx)** butonu:
  - Aynı kolonlarla `.xlsx` dosyası indirir.

- **CSV/XLSX import** (Stok kartları CSV/XLSX import):
  - Kabul edilen başlıklar (sütun adları) şunlardır:
    - `Stok Kodu`
    - `Stok Adı`
    - `Grubu`
    - `Maliyet`
    - `Birimi`
    - `Barkod`
  - Export ettiğiniz dosyayı Excel’de açıp değerleri değiştirdikten sonra tekrar **CSV (UTF‑8)** veya **Excel (xlsx)** olarak kaydedip aynı yerden geri yükleyebilirsiniz.
  - Import sırasında:
    - `Stok Kodu` doluysa, ilgili ürün `stok_kodu` üzerinden **upsert** edilir (yoksa eklenir, varsa güncellenir).
    - `Stok Kodu` boş ama `Stok Adı` doluysa, ürün adı `ilike` ile aranır; bulunduysa güncellenir, bulunamazsa yeni ürün kartı açılır.
