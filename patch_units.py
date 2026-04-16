"""
Supabase REST API ile birim düzeltmeleri (supabase-py paketi gerekmez)
"""
import os, sys, json, urllib.request

url = key = ""
env_file = ".env.local"
if os.path.exists(env_file):
    for line in open(env_file):
        line = line.strip()
        if line.startswith("VITE_SUPABASE_URL="):
            url = line.split("=", 1)[1].strip()
        elif line.startswith("VITE_SUPABASE_ANON_KEY="):
            key = line.split("=", 1)[1].strip()

if not url or not key:
    print("HATA: .env.local'dan değerler alınamadı!")
    sys.exit(1)

def patch(stok_kodu, yeni_birim, aciklama):
    """PATCH /rest/v1/products?stok_kodu=eq.<kod>"""
    endpoint = f"{url}/rest/v1/products?stok_kodu=eq.{stok_kodu}"
    body = json.dumps({"unit": yeni_birim}).encode()
    req = urllib.request.Request(
        endpoint,
        data=body,
        method="PATCH",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
    )
    try:
        with urllib.request.urlopen(req) as resp:
            rows = json.loads(resp.read())
            if rows:
                print(f"  ✓  {stok_kodu}  ->  {yeni_birim}    {aciklama}")
            else:
                print(f"  !  {stok_kodu}  güncellenmedi — stok kodu bulunamadı?  {aciklama}")
    except Exception as e:
        print(f"  ✗  {stok_kodu}  HATA: {e}  ({aciklama})")

fixes = [
    ("st0000431", "ADET",      "SANDVİÇ EKMEĞİ BÜFE TİP 6*65 GR  PAKET → ADET"),
    ("st0000144", "KİLOGRAM",  "YOĞURT 2 KG  ADET → KİLOGRAM"),
    ("st0000340", "KİLOGRAM",  "SF PATATES KLASİK 9X9 2,5 KG X 5 EDT  KOLİ → KİLOGRAM"),
    ("st0000027", "ADET",      "N73(BÜYÜK) PENNE BARİLLA 2 KG  KİLOGRAM → ADET"),
    ("st0000048", "KOLİ",      "7 OZ KARTON BARDAK  ADET → KOLİ"),
]

print("Birim düzeltmeleri uygulanıyor...\n")
for stok_kodu, yeni_birim, aciklama in fixes:
    patch(stok_kodu, yeni_birim, aciklama)
print("\nBitti.")
