import os
import sys
import re
import pandas as pd


# === KULLANICI SEÇENEĞİ ============================================
# True  → KG/LT satırlarında önce regex ile Stok Adı'ndan gram/ml bulmayı dener.
# False → Doğrudan (Tutar / Miktar) değerini 1000'e bölerek 1 GR / 1 ML fiyatı hesaplar.
USE_REGEX_METHOD = True
# ================================================================


def parse_turkish_number(s: str) -> float:
    """
    '3,000'  → 3.0
    '622,49' → 622.49
    Boş veya hatalıysa NaN döner.
    """
    if pd.isna(s):
        return float("nan")
    s = str(s).strip()
    if not s:
        return float("nan")
    # Türkçe formatta virgül ondalık ayırıcı gibi kullanıldığı için
    # sadece ',' karakterlerini '.' ile değiştiriyoruz.
    s = s.replace(".", "")   # Olası binlik ayırıcıları temizle (nadiren de olsa)
    s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return float("nan")


# Stok Adı içinden gram / ml / kg / lt miktarını çıkarmak için regex.
# Örnek eşleşmeler:
#   "CAJUN BAHARATI 1000 GR"  → value=1000, unit=GR
#   "18 LT FRİTA YAĞI"        → value=18,   unit=LT
#   "5,5 KG ..."              → value=5.5,  unit=KG
SIZE_REGEX = re.compile(
    r"(\d+(?:[.,]\d+)?)\s*(KG|KİLOGRAM|GR|G|LT|LİTRE|ML)",
    flags=re.IGNORECASE
)


def extract_size_from_name(name: str) -> float | None:
    """
    Stok Adı'ndan paket içeriğini GR / ML cinsinden döndürür.
    Örn:
        "1000 GR"  → 1000
        "5 KG"     → 5000
        "18 LT"    → 18000
    Eşleşme yoksa None döner.
    """
    if not isinstance(name, str):
        return None
    m = SIZE_REGEX.search(name)
    if not m:
        return None

    raw_value, raw_unit = m.groups()
    value = float(raw_value.replace(",", "."))
    unit = raw_unit.upper()

    # GR / G / ML → zaten 1'e 1
    if unit in {"GR", "G", "ML"}:
        return value

    # KG / KİLOGRAM / LT / LİTRE → 1000 ile çarp
    if unit in {"KG", "KİLOGRAM", "LT", "LİTRE"}:
        return value * 1000.0

    return None


def compute_unit_price(row, use_regex: bool) -> float | None:
    """
    Bir satır için Birim Fiyat hesaplar.

    - ADET      → (Tutar / Miktar) (satırdaki birim fiyat olduğu varsayılır)
    - KG / LT   → hedef 1 GR / 1 ML fiyatı
        * Regex yöntemi:
            - Stok Adı'ndan paket boyutu (GR / ML) bulunursa:
                BirimFiyat = Tutar / paket_boyutu
              (Tutar tek paket içindir varsayılır)
            - Eşleşme yoksa → 1000 yöntemi
        * 1000 yöntemi:
            - Base = Tutar / Miktar  (1 KG / 1 LT fiyatı)
            - BirimFiyat = Base / 1000
    """
    qty = row["_qty"]
    total = row["_total"]
    unit = str(row.get("Temel Brm.", "")).strip().upper()
    name = row.get("Stok Adı", "")

    if pd.isna(qty) or pd.isna(total) or qty == 0:
        return None

    base_price = total / qty  # Temel hesap (adet, kg veya lt’ye göre)

    if unit == "ADET":
        return base_price

    if unit in {"KİLOGRAM", "KG", "LİTRE", "LT"}:
        # Yöntem A: Regex ile paket boyutunu bul
        if use_regex:
            size_in_gml = extract_size_from_name(name)
            if size_in_gml and size_in_gml > 0:
                # Tutar / (paket içi gram veya ml) = 1 GR / 1 ML fiyatı
                return total / size_in_gml

        # Yöntem B: Base (KG/LT) fiyatını 1000'e böl → 1 GR / 1 ML
        return base_price / 1000.0

    # Diğer birimler için şu anlık base fiyatı döndürelim
    return base_price


def main():
    if len(sys.argv) < 2:
        print("Kullanım: python birim_fiyat_hesapla.py \"C:\\...\\stoklar fiyatlarıyla beraber.csv\"")
        sys.exit(1)

    input_path = sys.argv[1]
    if not os.path.isfile(input_path):
        print(f"Dosya bulunamadı: {input_path}")
        sys.exit(1)

    print(f"CSV okunuyor: {input_path}")
    # ; ile ayrılmış CSV
    df = pd.read_csv(input_path, sep=";", dtype=str)

    # Beklenen kolonları kontrol et
    required_cols = ["Stok Adı", "Temel Mik.", "Temel Brm.", "Tutarı"]
    missing = [c for c in required_cols if c not in df.columns]
    if missing:
        print("Eksik kolon(lar):", ", ".join(missing))
        sys.exit(1)

    # Temel Mik. ve Tutarı kolonlarını sayıya çevir
    df["_qty"] = df["Temel Mik."].apply(parse_turkish_number)
    df["_total"] = df["Tutarı"].apply(parse_turkish_number)

    # Kullanıcıya yöntem sor (istersen tepede USE_REGEX_METHOD ile zorlayabilirsin)
    use_regex = USE_REGEX_METHOD
    try:
        choice = input(
            "KG/LT için birim fiyat hesabı:\n"
            "  1) Regex ile Stok Adı'ndan gram / ml bul (Varsayılan)\n"
            "  2) Sadece (Tutar / Miktar) / 1000 kullan\n"
            "Seçiminiz (1/2, boş bırak: 1): "
        ).strip()
        if choice == "2":
            use_regex = False
        else:
            use_regex = True
    except EOFError:
        # input() kullanılamayan ortamlarda tepede tanımlı sabiti kullan
        pass

    # Birim fiyat hesapla
    df["Birim Fiyat"] = df.apply(lambda row: compute_unit_price(row, use_regex), axis=1)

    # Geçici kolonları temizle
    df.drop(columns=["_qty", "_total"], inplace=True)

    # Çıkış dosya adı
    base, ext = os.path.splitext(input_path)
    output_path = base + "_guncel_fiyatli.csv"

    # ; ayırıcı ile kaydet (Türkçe ondalık için istersen '.' → ',' yapabilirsin)
    df.to_csv(output_path, sep=";", index=False)

    print(f"İşlem tamam. Çıktı kaydedildi: {output_path}")


if __name__ == "__main__":
    main()