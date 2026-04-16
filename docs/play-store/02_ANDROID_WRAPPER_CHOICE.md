# Android paketleme seçimi — TWA vs Capacitor

Plan maddesi **wrap-choice** için teknik karar çerçevesi ve öneri.

## Karşılaştırma

| Kriter | TWA (Trusted Web Activity), örn. Bubblewrap | Capacitor (WebView) |
|--------|-----------------------------------------------|---------------------|
| Render motoru | Chrome (Custom Tabs) | Sistem WebView |
| Sabit HTTPS URL | Gerekli (Digital Asset Links) | Genelde aynı; yerel dosya da mümkün |
| Kamera / QR | Chrome izinleri; genelde stabil | Eklenti + ek test |
| Bakım | Çoğu değişiklik sunucuda | Build pipeline + native sürümler |
| İki APK (Admin/Şube) | İki ayrı TWA paketi, farklı URL veya query | İki flavor, farklı `appId` |

## Önerilen yön

1. **MVP / düşük sürtünme:** Üretim URL’si (ör. Vercel) sabitlendikten sonra **TWA + Bubblewrap** ile ilk **AAB** üretmek.
2. **WebView/kamera uyumsuzluğu veya iki flavor karmaşası** yaşanırsa **Capacitor** ile devam; monorepo’da `apps/admin` ve `apps/sube` için ayrı Capacitor projeleri veya flavor’lar.

## Kayıt (karar)

- **Birincil seçim:** TWA (Bubblewrap) — mevcut Vite SPA ile en az native kod.
- **Yedek:** Capacitor — QR/kamera veya çift APK için daha kontrollü native katman.

Bu dosya “seçildi” olarak kabul edilir; build iskeleti eklendiğinde `README` veya `android/` altında yol güncellenir.
