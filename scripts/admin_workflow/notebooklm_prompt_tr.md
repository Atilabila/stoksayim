SEN BİR EĞİTİM TASARIMCISISIN. ELİNDEKİ EKRAN GÖRÜNTÜLERİNİ KULLANARAK “ŞUBELERİN YAPACAĞI SAYIM” İÇİN BİR SLAYT TASLAĞI HAZIRLA.

## Veri
- `index.md` içindeki ekran adımlarını ve `*.png` görsellerini referans al.

## Çıktı formatı
- Toplam 8-12 slayt üret.
- Her slayt için:
  - `Slayt başlığı: ...`
  - 3-6 kısa madde (kısa cümleler, yönerge tonunda)
  - (varsa) ilgili ekran adı/numarası

## İçerik kapsamı (zorunlu)
1) Şube/personel giriş ekranı: kullanıcı adı + şifre
2) Personel adı sorulması (varsa)
3) Adet/ürün seçimi akışı:
   - Barkod okutup ürün bulma (yerel sistemde yoksa “yeni ürün” modalı)
   - Alternatif: manuel arama
   - Alternatif: “Ürün seç (Kategori → Liste)” gelişmiş filtreleme
4) Miktar girme (numpad veya mobil klavye) ve onaylama
5) Hata senaryoları / geri dönüşler:
   - Kamera açılamazsa ne yapılır (ngrok/HTTPS uyarısı metnini görsele göre ifade et)
   - Barkod bulunamadıysa ne yapılır
6) Geçmiş sayımları gör ve düzenle (edit kalem butonu, yeni adedi girme)

## Stil
- Türkçe, sade ve uygulanabilir.
- Uzun paragraf yok.
- Görsel adımlarını “Ekran X” diye an.

