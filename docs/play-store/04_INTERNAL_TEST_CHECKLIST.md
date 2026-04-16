# İç test kanalı — AAB ve akış doğrulama

Plan maddesi **internal-test** için manuel adımlar. Play Console’a yükleme ortamınızda yapılır; bu dosya takip listesidir.

## Ön koşullar

- [ ] Google Play Console hesabı ve uygulama oluşturuldu
- [ ] İmzalı **AAB** üretildi (TWA veya Capacitor Android build)
- [ ] Üretim **HTTPS** URL ve doğru `VITE_SUPABASE_*` ile build

## Yükleme

1. Play Console → Uygulamanız → **Testing** → **Internal testing**
2. Yeni sürüm oluştur → AAB yükle → sürüm notu gir
3. Test kullanıcıları (e-posta listesi) ekle
4. Yayınla; test linki ile indir

## Cihazda doğrulama (checklist)

### Genel

- [ ] Uygulama açılıyor, çökme yok
- [ ] İnternet yokken beklenen davranış (mesaj / boş durum) — tam offline iddiası yoksa açıklama ile uyumlu

### Şube akışı

- [ ] Şube girişi (kullanıcı adı / şifre veya tanımlı model)
- [ ] Ürün arama / liste
- [ ] **Kamera veya QR** ile barkod okuma (izin istemi ve gerçek cihazda test)
- [ ] Sayım kaydı ve listeleme
- [ ] İlk/son sayım zamanı (İstanbul gösterimi) mantıklı

### Admin akışı (Admin APK veya aynı build’de admin yolu)

- [ ] Admin girişi
- [ ] Dönem / şube / sayım listesi
- [ ] Onay veya rapor ekranı (ürününüze göre)

### Mağaza politikası

- [ ] Gizlilik politikası URL’si çalışıyor
- [ ] Uygulama içi “veri nereye gider” beklentisi ile uyumlu

## Sorun kaydı

Her hata için: cihaz modeli, Android sürümü, ekran görüntüsü / logcat özeti.
