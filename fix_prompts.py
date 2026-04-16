import sys
with open('AdminDashboard.jsx', encoding='utf-8') as f:
    text = f.read()

text = text.replace('};\n\\nconst clearAllMasterData = () => {', '};\n\n    const clearAllMasterData = () => {')
text = text.replace('\\n\\n    const handleResetAllCounts = async () => {', '\n\n    const handleResetAllCounts = async () => {')
text = text.replace('    <button\\n                                onClick={() => void clearAllMasterData()}\\n', '                            <button\n                                onClick={() => void clearAllMasterData()}\n')

# Let's fix the prompt string just in case it's broken
text = text.replace(
    "'DİKKAT: Ürün onay ekranındaki (sadece bu modüldeki) tüm Satış, Tedarik ve Eşleştirme verilerini sileceksiniz.\\nSadece sistem stoklarınız (Kayıtlı Stok) etkilenmez.\\nOnaylıyorsanız \"SIFIRLA\" yazın:',",
    "`DİKKAT: Ürün onay ekranındaki (sadece bu modüldeki) tüm Satış, Tedarik ve Eşleştirme verilerini sileceksiniz.\\nSadece sistem stoklarınız (Kayıtlı Stok) etkilenmez.\\nOnaylıyorsanız \"SIFIRLA\" yazın:`,",
)

text = text.replace(
    "'ÇOK ÖNEMLİ: Tüm şubelerin \"Kayıtlı Stok (Ana Sistem Stokları)\" veritabanından kalıcı silinecektir.\\nDeneme verilerini temizleyip yepyeni bir sayım dönemine başlamak için bunu kullanın.\\nOnaylıyorsanız büyük harflerle STOK SIFIRLA yazın:',",
    "`ÇOK ÖNEMLİ: Tüm şubelerin \"Kayıtlı Stok (Ana Sistem Stokları)\" veritabanından kalıcı silinecektir.\\nDeneme verilerini temizleyip yepyeni bir sayım dönemine başlamak için bunu kullanın.\\nOnaylıyorsanız büyük harflerle STOK SIFIRLA yazın:`,",
)

with open('AdminDashboard.jsx', 'w', encoding='utf-8') as f:
    f.write(text)
print("fixed prompts")
