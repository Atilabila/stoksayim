import pandas as pd
import re
from rapidfuzz import fuzz, process

# ----------------------------------
# TEXT NORMALIZATION
# ----------------------------------

def normalize(text):

    if pd.isna(text):
        return ""

    text = str(text).upper()

    tr_map = {
        "Ç": "C",
        "Ö": "O",
        "Ğ": "G",
        "Ş": "S",
        "Ü": "U",
        "İ": "I"
    }

    for k, v in tr_map.items():
        text = text.replace(k, v)

    text = text.replace("×", "X")
    text = text.replace("*", "X")

    text = re.sub(r"[^\w\sX]", " ", text)
    text = re.sub(r"\s+", " ", text)

    return text.strip()


# ----------------------------------
# WEIGHT PARSER
# ----------------------------------

def extract_weight(text):

    text = text.replace(",", ".")

    patterns = [
        r"(\d+)\s*KG",
        r"(\d+)\s*G",
        r"(\d+)\s*ML",
        r"(\d+)\s*L"
    ]

    for p in patterns:

        m = re.search(p, text)

        if m:

            val = float(m.group(1))

            if "KG" in p:
                return val * 1000

            if "L" in p and "ML" not in p:
                return val * 1000

            return val

    return None


# ----------------------------------
# MULTIPACK PARSER
# ----------------------------------

def extract_pack(text):

    m = re.search(r"(\d+)\s*G\s*X\s*(\d+)", text)

    if m:

        g = int(m.group(1))
        n = int(m.group(2))

        return g * n

    return None


# ----------------------------------
# LOAD FILES
# ----------------------------------

print("CSV dosyaları okunuyor...")

ingredients = pd.read_csv("ingredients.csv")
stocks = pd.read_csv("subeler_stok.csv", sep=";")


# normalize
ingredients["norm"] = ingredients["name"].apply(normalize)
stocks["norm"] = stocks["Stok Adı"].apply(normalize)


ingredient_names = ingredients["norm"].tolist()

results = []


# ----------------------------------
# MATCHING
# ----------------------------------

print("Ürün eşleştirme başlıyor...")

for idx, row in stocks.iterrows():

    query = row["norm"]

    match = process.extractOne(
        query,
        ingredient_names,
        scorer=fuzz.token_set_ratio
    )

    best_norm = match[0]
    score = int(match[1])

    ingredient_row = ingredients[ingredients["norm"] == best_norm].iloc[0]

    matched_name = ingredient_row["name"]
    matched_price = ingredient_row["unit_price"]

    # ----------------------------------
    # WEIGHT CHECK
    # ----------------------------------

    w1 = extract_pack(query) or extract_weight(query)
    w2 = extract_pack(best_norm) or extract_weight(best_norm)

    if w1 and w2:

        diff = abs(w1 - w2)

        if diff > (0.2 * max(w1, w2)):
            score -= 15

    if score < 0:
        score = 0


    # ----------------------------------
    # REVIEW FLAG
    # ----------------------------------

    if score >= 90:
        review = 0
    else:
        review = 1


    new_row = row.to_dict()

    new_row["MatchedIngredientName"] = matched_name
    new_row["MatchedPrice"] = matched_price
    new_row["SimScore"] = score
    new_row["NeedsReview"] = review

    results.append(new_row)


# ----------------------------------
# SAVE OUTPUT
# ----------------------------------

print("CSV oluşturuluyor...")

out = pd.DataFrame(results)

out.drop(columns=["norm"], inplace=True)

out.to_csv(
    "subeler_stok_sisteme_aktarilacak_fuzzy.csv",
    index=False,
    encoding="utf-8-sig"
)

print("✔ Tamamlandı")
print("✔ Dosya oluşturuldu:")
print("subeler_stok_sisteme_aktarilacak_fuzzy.csv")