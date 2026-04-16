import pandas as pd
from pathlib import Path

path = Path("şubeler stok.xls")
print("Dosya var mı?:", path.exists())
if not path.exists():
    raise SystemExit("şubeler stok.xls bulunamadı")

xls = pd.ExcelFile(path)
print("Sayfalar:", xls.sheet_names)

for name in xls.sheet_names:
    print("\n=== Sayfa:", name, "===")
    try:
        df = xls.parse(name)
        # İlk 10 satırı göster
        print(df.head(10).to_string(index=False))
    except Exception as e:
        print("Sayfa okunurken hata:", name, e)