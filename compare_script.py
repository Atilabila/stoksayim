import csv
import difflib
import io

actual_stocks = {} 
with open('products_rows.csv', 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        code = row.get('stok_kodu', '').strip().upper()
        name = row.get('product_name', '').strip()
        if code and name:
            actual_stocks[name.upper()] = (code, name)

with open('subeler_stok.csv', 'r', encoding='utf-8') as f:
    for i, line in enumerate(f):
        if i == 0: continue
        parts = line.strip('\n').split(';')
        if len(parts) >= 2:
            code = parts[0].strip().upper()
            name = parts[1].strip()
            if code and name:
                actual_stocks[name.upper()] = (code, name)

actual_names = list(actual_stocks.keys())

sales = []
with io.open('scloggerayakustu.csv', 'r', encoding='utf-8-sig', errors='replace') as f:
    for i, line in enumerate(f):
        if i == 0: continue
        parts = line.strip('\n').split(';')
        if len(parts) >= 4:
            s_code = parts[1].strip()
            s_name = parts[2].strip()
            qty = parts[3].strip()
            sales.append((s_code, s_name, qty))

print(f"Toplam satis kalemi: {len(sales)}")
matched = 0
unmatched = []

for s_code, s_name, qty in sales:
    upper_s_name = s_name.upper()
    
    if upper_s_name in actual_stocks:
        matched += 1
        continue
        
    possible_starts = [n for n in actual_names if n.startswith(upper_s_name)]
    if len(possible_starts) == 1:
        matched += 1
        print(f"TRUNCATED MATCH: {s_name} => {actual_stocks[possible_starts[0]][1]} (Kod: {actual_stocks[possible_starts[0]][0]})")
        continue

    # special handle for weird turkish replaces
    replaced_s_name = upper_s_name.replace('İ', 'I').replace('Ç', 'C').replace('Ş', 'S').replace('Ğ', 'G').replace('Ü', 'U').replace('Ö', 'O')
    possible_fuzzies = difflib.get_close_matches(upper_s_name, actual_names, n=1, cutoff=0.8)
    if possible_fuzzies:
        matched += 1
        print(f"FUZZY MATCH: {s_name} => {actual_stocks[possible_fuzzies[0]][1]} (Kod: {actual_stocks[possible_fuzzies[0]][0]})")
    else:
        unmatched.append(s_name)

print("-" * 50)
print(f"EŞLEŞEN: {matched} / {len(sales)}")
print("EŞLEŞMEYENLER:")
for u in unmatched:
    print(u)
