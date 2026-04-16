# Stoksayım × NutritionManager Entegrasyonu — Dünün ve Bugünün Mimarisi

Bu doküman iki şeyi anlatır:

- **Dün (Planlanan “cihaz tanımlı otomatik giriş + dış kapı API” mimarisi)**: iOS Safari + Android APK’dan tek tıkla sayım ekranına girme (SSO benzeri).
- **Bugün (Basitleştirilmiş “login ekranına yönlendir” mimarisi)**: APK ve iOS portal üzerinden login ekranına gider, kullanıcı giriş yapar ve sayım yapar.
- Ek olarak, **NutritionManager → Stoksayım ürün/fiyat import + eşleştirme** için net bir dosya spesifikasyonu içerir.

---

## 1) Mevcut Stoksayım Uygulaması — Gerçek Durum (Koddan)

### 1.1. Veri modeli (Supabase)
Stoksayım tarafında ürün kartları `products` tablosunda tutulur:

- **`products.stok_kodu`**: Stok kodu (ör. `ST00168`)
- **`products.product_name`**: Ürün adı
- **`products.category`**: Grubu/Kategori
- **`products.unit`**: Birim (varsayılan `Adet`)
- **`products.purchase_price`**: **Maliyet** (tek fiyat alanı)
- **`products.barcode`**: Barkod (unique)

Sayım kayıtları `counts` tablosunda tutulur ve sayım kaydı **`branch_id`** üzerinden şubeye yazılır.

### 1.2. Giriş (Login) akışı
Stoksayım’da giriş şu an Supabase `branches` tablosu üzerinden yapılır:

- `branches.username`
- `branches.password_hash` (adı “hash” ama pratikte düz metin karşılaştırılıyor)

Başarılı girişte uygulama `branchId` state’ini set eder ve sayım ekranına geçer.

Admin girişi ayrıca hardcoded:

- `admin / supersecret`

### 1.3. Sayım yazımı
Sayım kaydı `counts` tablosuna upsert edilir:

- `branch_id = branchId`
- `product_id`
- `period_id`
- `counted_stock`
- `status = draft`

---

## 2) NutritionManager (ASP.NET) → Stoksayım Ürün/Fiyat Import Eşleştirme

### 2.1. Problem
NutritionManager’da malzeme kartları var ve export çıktısı şu an:

- kolonlar: `urun_adi,fiyat`
- encoding: UTF-8 (BOM’lu)
- fiyat alanı bazen `KgPrice`, bazen `PiecePrice/UnitPrice`’dan geliyor

Stoksayım bu malzemeleri **içeri almak/eşleştirmek** istiyor.

### 2.2. En kritik karar: “Tekil anahtar” (Unique Key)
Yanlış eşleşmeyi önlemek için Stoksayım import/upsert işlemlerinde en güvenli tekil anahtar:

- **`Stok Kodu`** (`products.stok_kodu`) — sizde zaten `ST...` ile başlayan gerçek stok kodları var.

Alternatifler:

- Barkod (`barcode`) DB’de unique ama her üründe olmayabilir.
- Ürün adı ile eşleşme (`ilike %...%`) risklidir (benzer isimlerde yanlış güncelleme yapabilir).

**Standart:** NutritionManager export’unda her satırda `Stok Kodu` **mutlaka dolu** gelmeli.

### 2.3. Stoksayım import dosyası spesifikasyonu (Bugünkü uygulama)
Stoksayım “stok kartları import” akışı şu başlıkları kabul eder:

#### Kolonlar (tam adlarıyla)
- **Zorunlu pratik standart**: `Stok Kodu` (şiddetle önerilir / fiilen zorunlu)
- Diğerleri:
  - `Stok Adı`
  - `Grubu`
  - `Maliyet`
  - `Birimi`
  - `Barkod`

#### Dosya formatı
- CSV veya Excel (`.xlsx`)
- CSV için öneri: **virgül ayraç** (`,`)
- Encoding: UTF-8 (BOM olabilir; Excel uyumu için önerilir)

### 2.4. Fiyat/maliyet standardı
Stoksayım’da tek maliyet alanı vardır:

- **`products.purchase_price`** (UI’da “Maliyet”, para birimi ₺ / TL)

Bu yüzden NutritionManager tarafında tek bir alana standardize edilmelidir:

- KG/LT ürünlerde: `KgPrice` → **`Maliyet`**
- Adet ürünlerde: `PiecePrice` (yoksa `UnitPrice`) → **`Maliyet`**

> Stoksayım’da KDV dahil/hariç ayrımı yoktur. Tek alan olduğu için bir standardı siz belirlemelisiniz.
> Öneri: NutritionManager’daki **net birim fiyat** (örn. `LastNetUnitPrice`) tek kaynak olsun.

### 2.5. Birim standardı
Stoksayım’da `unit` alanı vardır (dönüşüm yok, sadece anlamlandırma).

- `Birimi` boşsa varsayılan `Adet` olur.
- KG/LT ürünlerde mutlaka `KG`/`LT` gönderilmelidir; aksi halde maliyet yanlış yorumlanır.

Önerilen kodlar:

- `KG`, `LT`, `Adet`

### 2.6. Çakışma ve güncelleme kuralları
Önerilen güvenli politika:

- Upsert key: **`Stok Kodu`**
- Güncellenecek alanlar: `Stok Adı`, `Grubu`, `Birimi`, `Maliyet`, `Barkod` (dolu geldiyse)
- Boş gelen alanlar mevcut değeri silmemeli (dokunmamalı)
- `Maliyet` boş gelirse: fiyatı koru (0’a çekme)

### 2.7. İdeal export örneği (NutritionManager → Stoksayım)
CSV (virgüllü):

```csv
Stok Kodu,Stok Adı,Grubu,Maliyet,Birimi,Barkod
ST00168,Süt Tam Yağlı,MANDIRA,42.50,LT,
ST00991,Un (Beyaz),KURU GIDA,18.90,KG,
ST00321,Yumurta,ŞARKÜTERİ,4.00,Adet,
ST00444,Zeytinyağı,KURU GIDA,210.75,LT,
ST00880,Şeker,KURU GIDA,55.10,KG,
```

---

## 3) Dünün Mimarisi (Önerilen) — “Cihaz Tanımlı Otomatik Giriş + Dış Kapı API”

### 3.1. Hedef
- iOS Safari ve Android APK’dan “Sayım”a tıklanınca:
  - Kullanıcı login görmeden (veya minimum sürtünmeyle) sayım ekranı açılsın
  - Sadece **tanımlı cihazlar** erişebilsin
  - Cihazın/kişinin yetkisine göre doğru şube/location’a yazılsın

### 3.2. Bileşenler
- **`devices` tablosu**: cihaz kaydı, `api_key_hash`, `status`, `last_seen_at`
- **Edge Function / API Gateway**:
  - `x-device-id` + `x-api-key` doğrulaması
  - doğrulandıktan sonra kısa ömürlü **SSO token** üretimi
- **SSO endpoint**:
  - `/device/sso?token=...`
  - token doğrulanır → tarayıcıya session/cookie basılır → sayım ekranına yönlendirilir
- **Location/Personel mapping**:
  - personelin yetkili olduğu şubeler/locations
  - location seçimiyle `branch_id` belirlenir

### 3.3. Akış
- Android APK:
  - “Sayım” → `POST /device/login` → `sso_token`
  - tarayıcı/WebView ile `/device/sso?token=...` açılır
- iOS Safari/PWA:
  - ilk kurulumda QR ile cihaz tanımlama
  - sonrasında açılışta aynı SSO ile otomatik oturum

### 3.4. Güvenlik
- API key DB’de düz saklanmaz (hash)
- Token:
  - tek kullanımlık
  - çok kısa ömür (örn. 60–120 sn)
- Rate limit (cihaz bazlı)
- Audit log

> Not: Bu mimari “kurumsal terminal” gibi kullanımda çok iyi çalışır; ancak kurulum/operasyon karmaşıklığı artar.

---

## 4) Bugünün Mimarisi (Seçilen Basit Yol) — “Login Ekranına Yönlendir”

### 4.1. Hedef
Karmaşıklığı azaltmak:

- Android APK “Sayım” butonuna basınca **Stoksayım web login ekranını** açsın.
- iOS Safari kullanıcılar portal/PWA kısayoldan **login ekranına** girsin.
- Kullanıcı adı/şifre ile giriş yapıp sayım yapsın.

### 4.2. Artılar/Eksiler
**Artılar**
- En hızlı canlıya alınır
- Cihaz kayıt/SSO/token altyapısı yok
- Destek yükü düşük

**Eksiler**
- Kullanıcı her seferinde (veya session süresince) giriş yapmak zorunda
- “personel + locations” kurgusu için UI/DB tarafında ayrıca yetki tasarımı gerekir

---

## 5) Önerilen “Minimum Sağlam Standart” (Bugün için)
NutritionManager export’unu Stoksayım’a problemsiz bağlamak için:

- **Stok Kodu zorunlu** (`ST...` kodları)
- **Birim zorunlu** (KG/LT/Adet)
- **Maliyet tek alan** ve standardı net: (tercihen net birim fiyat)
- CSV ayraç: **virgül**
- Encoding: UTF-8 (BOM önerilir)

Bu standartla:

- Import idempotent olur (aynı dosya tekrar import edilse bile bozulmaz)
- Yanlış eşleşme riski minimum olur
- `urun_adi,fiyat` gibi minimal export yerine kontrollü ve güvenli senkron sağlanır

---

## 6) Uygulanabilir karar listesi (kısa)
- **Tekil anahtar**: `Stok Kodu` (`ST...`)
- **Fiyat alanı**: Stoksayım’da `purchase_price` (₺)
- **Fiyat kaynağı**: NM’de net birim fiyatı tek standarda bağla
- **Birim**: KG/LT/Adet zorunlu gönder
- **Delimiter**: `,` (virgül)
- **İsimle eşleşme**: kapalı (stok kodu zorunlu)

