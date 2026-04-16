#!/usr/bin/env python3
"""
Şubeler Stok Excel/CSV'den tüm tabloyu çeker ve sisteme (Supabase) ekler.
Sütunlar: A=Stok Kodu, B=Stok Adı, C=Grubu, D=Birimi

Kullanım:
  python scripts/import_stok_from_excel.py dosya.xlsx
  python scripts/import_stok_from_excel.py dosya.csv

Ortam değişkenleri (veya .env):
  SUPABASE_URL=https://xxx.supabase.co
  SUPABASE_ANON_KEY=eyJ...
"""

import os
import sys
from typing import List, Dict, Any

# Opsiyonel: .env dosyasından oku
try:
    from dotenv import load_dotenv
    for p in ['.env', '.env.local', os.path.join(os.path.dirname(__file__), '..', '.env.local')]:
        if os.path.isfile(p):
            load_dotenv(p)
            break
except ImportError:
    pass

def _resolve_filepath(filepath: str) -> str:
    """Verilen yolu dene; yoksa proje/üst klasörde subeler_stok.* ara."""
    path = os.path.normpath(os.path.abspath(filepath))
    if os.path.isfile(path):
        return path
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)  # stoksayim
    parent_dir = os.path.dirname(project_root)  # sidereal-photosphere veya üstü
    names = ("subeler_stok.csv", "subeler_stok.xlsx", "şubeler stok.xlsx", "subeler_stok.xls")
    for folder in (os.getcwd(), project_root, parent_dir, script_dir):
        for name in names:
            candidate = os.path.join(folder, name)
            if os.path.isfile(candidate):
                return candidate
    raise FileNotFoundError(
        f"Dosya bulunamadı: {path}\n"
        "Lütfen dosyanın tam yolunu verin, örn:\n"
        '  python scripts/import_stok_from_excel.py "C:\\Users\\ati\\Downloads\\subeler_stok.csv"\n'
        "veya dosyayı proje klasörüne (stoksayim) koyup:\n"
        "  python scripts/import_stok_from_excel.py subeler_stok.csv"
    )


def read_table(filepath: str) -> List[Dict[str, Any]]:
    """Excel veya CSV'den Stok Kodu, Stok Adı, Grubu, Birimi sütunlarını oku."""
    filepath = _resolve_filepath(filepath)

    ext = os.path.splitext(filepath)[1].lower()

    if ext in ('.xlsx', '.xls'):
        import pandas as pd
        df = pd.read_excel(filepath, header=None)
    elif ext == '.csv':
        import pandas as pd
        # Önce ; ile dene, olmazsa , ile
        try:
            df = pd.read_csv(filepath, sep=';', header=None, encoding='utf-8')
        except Exception:
            df = pd.read_csv(filepath, sep=',', header=None, encoding='utf-8')
    else:
        raise ValueError(f"Desteklenen formatlar: .xlsx, .xls, .csv (verilen: {ext})")

    rows = []
    for _, row in df.iterrows():
        # A=0, B=1, C=2, D=3
        stok_kodu = _clean(str(row.iloc[0]) if len(row) > 0 else "")
        stok_adi   = _clean(str(row.iloc[1]) if len(row) > 1 else "")
        grubu      = _clean(str(row.iloc[2]) if len(row) > 2 else "")
        birimi     = _clean(str(row.iloc[3]) if len(row) > 3 else "ADET")

        # Başlık satırını atla
        if stok_kodu.upper() in ('STOK KODU', 'STOK KODU ') or stok_adi.upper() == 'STOK ADI':
            continue
        if not stok_kodu or not stok_adi:
            continue

        birimi = (birimi or "ADET").strip().upper() or "ADET"
        rows.append({
            "stok_kodu": stok_kodu,
            "stok_adi": stok_adi,
            "grubu": grubu or None,
            "birimi": birimi,
        })
    return rows


def _clean(s: str) -> str:
    if s != s:  # NaN
        return ""
    s = str(s).strip()
    return s


def main():
    if len(sys.argv) < 2:
        print("Kullanım: python import_stok_from_excel.py <dosya.xlsx veya dosya.csv>")
        print("Örnek:    python import_stok_from_excel.py ../subeler_stok.csv")
        sys.exit(1)

    filepath = sys.argv[1]
    print(f"Dosya okunuyor: {filepath}")

    rows = read_table(filepath)
    print(f"Toplam {len(rows)} satır ürün okundu (Stok Kodu, Stok Adı, Grubu, Birimi).")

    if not rows:
        print("İşlenecek kayıt yok.")
        sys.exit(0)

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("SUPABASE_KEY")
    if not url or not key:
        print("\nSupabase bilgisi yok. Çıktıyı CSV olarak kaydediyorum; uygulama içinden CSV ile içe aktarabilirsiniz.")
        out_path = filepath.rsplit(".", 1)[0] + "_sisteme_aktarilacak.csv"
        with open(out_path, "w", encoding="utf-8-sig", newline="") as f:
            f.write("Stok Kodu;Stok Adı;Grubu;Birimi\n")
            for r in rows:
                f.write(f"{r['stok_kodu']};{r['stok_adi']};{r['grubu'] or ''};{r['birimi']}\n")
        print(f"Kaydedildi: {out_path}")
        return

    from supabase import create_client
    supabase = create_client(url, key)

    # 1) Kategorileri (Grubu) ekle
    categories = list({r["grubu"] for r in rows if r["grubu"]})
    existing = set()
    try:
        res = supabase.table("categories").select("name").execute()
        existing = {r["name"] for r in (res.data or [])}
    except Exception as e:
        print("Kategoriler okunurken hata (devam ediliyor):", e)
    for name in categories:
        if name and name not in existing:
            try:
                supabase.table("categories").insert({"name": name}).execute()
                existing.add(name)
            except Exception as e:
                if "duplicate" not in str(e).lower() and "unique" not in str(e).lower():
                    print("Kategori eklenirken:", e)

    # 2) Mevcut ürünleri stok_kodu ile çek
    by_stok_kodu = {}
    try:
        res = supabase.table("products").select("id, stok_kodu").execute()
        for p in res.data or []:
            sk = (p.get("stok_kodu") or "").strip()
            if sk and sk not in by_stok_kodu:
                by_stok_kodu[sk] = p
    except Exception as e:
        print("Ürünler okunurken hata:", e)

    inserted = updated = 0
    for r in rows:
        sk = r["stok_kodu"]
        payload = {
            "product_name": r["stok_adi"],
            "category": r["grubu"],
            "unit": r["birimi"],
            "stok_kodu": sk,
            "purchase_price": 0,
            "current_stock": 0,
        }
        if sk in by_stok_kodu:
            try:
                supabase.table("products").update({
                    "product_name": payload["product_name"],
                    "category": payload["category"],
                    "unit": payload["unit"],
                }).eq("id", by_stok_kodu[sk]["id"]).execute()
                updated += 1
            except Exception as e:
                print(f"Güncelleme hatası ({sk}):", e)
        else:
            try:
                supabase.table("products").insert(payload).execute()
                inserted += 1
                by_stok_kodu[sk] = {"id": None}
            except Exception as e:
                print(f"Ekleme hatası ({sk}):", e)

    print(f"\nBitti. Eklenen: {inserted}, Güncellenen: {updated}.")
    print("Uygulama içindeki Ürünler sekmesinden listeyi kontrol edebilirsiniz.")


if __name__ == "__main__":
    main()
