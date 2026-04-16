# Yerel DB APK — kapsam kararı

Plan maddesi **local-apk-scope** için netleştirme. Bu, **Alternatif B** (cihaz içi SQLite) ile ilgilidir; mevcut Supabase merkezi modelinden farklı bir ürün varyantıdır.

## Soru: Çoklu cihaz / senkron şart mı?

| Senaryo | Yerel-only yeter mi? | Not |
|---------|----------------------|-----|
| Tek şube, tek telefon, veri telefonda kalabilir | Evet | Yedekleme (dışa aktarma) şart |
| Merkez + çok şube + güncel birleşik stok | Hayır | **Supabase (veya başka backend)** gerekir |
| Şube sahada offline, ara sıra merkeze gönderim | Kısmen | “Yarı senkron”: manuel dosya veya batch API |

## Hangi modüller yerel APK’da kalabilir? (örnek kesim)

**Kalabilir (tipik):** Şube girişi, ürün arama, sayım girişi, QR, geçmiş listesi, yerel PIN.

**Çıkarılabilir veya masaüstüne bırakılabilir:** Çok şubeli admin raporu, Excel export, karmaşık onay akışı — ya da sadece **dışa aktarma** ile PC’de açılır.

## Kayıt (doldurulacak)

- **Hedef:** [ ] Sadece tek cihaz [ ] İleride senkron şart
- **Yerel APK üretilecek mi?** [ ] Evet [ ] Hayır (yalnızca Supabase’li web paketi)

Bu karar **local-db-tech** ve monorepo feature flag tasarımını etkiler.
