# Yerel veritabanı teknolojisi — seçim özeti

Plan maddesi **local-db-tech** için teknik seçenekler ve önerilen yön.

## Seçenekler

| Yaklaşım | Artı | Eksi |
|----------|------|------|
| **Capacitor + SQLite** (@capacitor-community/sqlite veya benzeri) | Mevcut React/Vite ile kod paylaşımı; tek dil | Şema migrasyonu ve repository katmanı gerekir |
| **Kotlin + Room/SQLite** | Tam native performans | Web ile paylaşım düşük |
| **React Native + SQLite** | Orta yol | Mevcut Vite kodunun taşınması maliyetli |

## Yerel şema taslağı (mantıksal)

Ürün ve sayım için minimum tablolar (örnek isimler):

- `local_products` — id, barkod, ad, birim, …
- `local_counts` — id, product_id, quantity, counted_at, sync_status
- `settings` — tek satır veya key-value

**Senkron** hedefleniyorsa `sync_status` ve `updated_at` zorunlu kabul edilir.

## Önerilen yön

- Yerel varyant üretilecekse öncelik **Capacitor + SQLite** (mevcut ekip React ile kalır).
- Ağır native gereksinim yoksa ayrı Kotlin iskeleti **ertelenir**.

## Kayıt

- **Seçilen stack:** Capacitor + SQLite (varsayılan öneri)
- **Şema:** Uygulama netleşince `docs/` veya `packages/` altında SQL taslağı eklenebilir.
