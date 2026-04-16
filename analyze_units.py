
import csv
from collections import defaultdict

# ---- 1) Receteler.csv'den stok kodu -> (ad, birim) ----
recete_units = {}  # normalized_kodu -> (stok_adi, birim_recete)

with open('Receteler.csv', encoding='utf-8-sig') as f:
    for raw in f:
        line = raw.strip()
        if not line:
            continue
        parts = line.split(';')
        # Malzeme satırı: ilk sütun boş, ikinci sütun st ile başlıyor
        if (len(parts) >= 6
                and parts[0].strip() == ''
                and parts[1].strip().upper().startswith('ST')
                and parts[1].strip().upper() != 'STOK KODU'):
            raw_kod = parts[1].strip()
            norm_kod = raw_kod.upper()
            stok_adi = parts[2].strip()
            birim = parts[5].strip().upper()
            # Aynı ürün farklı birimlerle kullanılmış olabilir; ilk görüleni al
            if norm_kod not in recete_units:
                recete_units[norm_kod] = (raw_kod, stok_adi, birim)

print(f'Receteler.csv benzersiz ürün: {len(recete_units)}')

# ---- 2) products_rows.csv'den stok kodu -> (ad, birim) ----
product_units = {}

with open('products_rows.csv', encoding='utf-8-sig') as f:
    reader = csv.DictReader(f)
    for row in reader:
        kod = row.get('stok_kodu', '').strip()
        if not kod:
            continue
        norm_kod = kod.upper()
        unit = row.get('unit', '').strip().upper()
        name = row.get('product_name', '').strip()
        product_units[norm_kod] = (kod, name, unit)

print(f'products_rows.csv benzersiz ürün: {len(product_units)}')

# ---- 3) Karşılaştır ----
mismatches = []  # (norm_kod, recete_ad, recete_birim, sistem_ad, sistem_birim)
not_found = []   # (norm_kod, recete_ad, recete_birim)

# Birim normalizasyon haritası (eşdeğer birimler)
equiv = {
    'KG': 'KİLOGRAM',
    'KILOGRAM': 'KİLOGRAM',
    'KİLOGRAM': 'KİLOGRAM',
    'LT': 'LİTRE',
    'LİTRE': 'LİTRE',
    'LITRE': 'LİTRE',
    'ADET': 'ADET',
    'PAKET': 'PAKET',
    'GRAM': 'GRAM',
    'KOLİ': 'KOLİ',
    'PKT.': 'PAKET',
    'METRE': 'METRE',
    'KOLİ': 'KOLİ',
}

def normalize(b):
    return equiv.get(b, b)

for norm_kod, (raw_kod_r, adi_r, birim_r) in recete_units.items():
    if norm_kod in product_units:
        raw_kod_p, adi_p, birim_p = product_units[norm_kod]
        n_birim_r = normalize(birim_r)
        n_birim_p = normalize(birim_p)
        if n_birim_r != n_birim_p:
            mismatches.append({
                'stok_kodu': raw_kod_r,
                'recete_adi': adi_r,
                'recete_birimi': birim_r,
                'sistem_adi': adi_p,
                'sistem_birimi': birim_p,
                'dogru_birim': birim_r,  # Recete kaynaktan alınan doğru birim
            })
    else:
        not_found.append({
            'stok_kodu': raw_kod_r,
            'recete_adi': adi_r,
            'recete_birimi': birim_r,
        })

print(f'\n=== BİRİM UYUMSUZLUKLARI ({len(mismatches)} adet) ===')
for m in mismatches:
    print(f"  {m['stok_kodu']:15}  {m['recete_adi'][:35]:35}  "
          f"recete={m['recete_birimi']:12} sistem={m['sistem_birimi']:15}  -> OLMASI GEREKEN: {m['dogru_birim']}")

print(f'\n=== SİSTEMDE BULUNMAYAN ({len(not_found)} adet) ===')
for n in not_found:
    print(f"  {n['stok_kodu']:15}  {n['recete_adi']}")

# CSV olarak kaydet
import json
result = {'mismatches': mismatches, 'not_found': not_found}
with open('unit_mismatches.json', 'w', encoding='utf-8') as out:
    json.dump(result, out, ensure_ascii=False, indent=2)

print(f'\nSonuçlar unit_mismatches.json dosyasına kaydedildi.')
