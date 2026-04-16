import sys

with open('AdminDashboard.jsx', encoding='utf-8') as f:
    content = f.read()

# Add clearAllMasterData after clearSalesForSelectedBranch
function_str = """
    const clearAllMasterData = () => {
        const userInput = window.prompt('Tüm satış, reçete verileri ve taslak tedarikleri tamamen SIFIRLAMAK istiyorsanız kutucuğa "SIFIRLA" yazın:');
        if (userInput === 'SIFIRLA') {
            setSalesQtyByKey({});
            setSalesUndoStack([]);
            setRecipeItems([]);
            setRecipeManualMap({});
            setSalesRecipeMap({});
            setManualPurchaseByKey({});
            toast.success('Hafızaya alınmış tüm geçmiş satış verileri, yüklenmiş reçeteler ve geçici tedarikler başarıyla SIFIRLANDI.');
        } else if (userInput !== null) {
            toast.error('Onay metni eşleşmedi, işlem iptal.');
        }
    };
"""

content = content.replace("const clearSalesForSelectedBranch = () => {", function_str + "\n    const clearSalesForSelectedBranch = () => {")

button_str = """
                                <button
                                    type="button"
                                    onClick={clearSalesForSelectedBranch}
                                    className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-rose-300 border border-white/10 rounded-lg px-2 py-2 print:hidden self-start"
                                    title="Seçili şubenin satış rakamlarını silir (Tüm şubeler seçiliyse hepsini siler)"
                                >
                                    Satışı temizle
                                </button>
                                <button
                                    type="button"
                                    onClick={clearAllMasterData}
                                    className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-red-200 hover:text-white border border-red-500/50 rounded-lg px-2 py-2 bg-red-900/30 print:hidden self-start"
                                    title="Bütün şubelerdeki taslak satışları, tedarikleri ve reçeteleri tamamen SIFIRLAR"
                                >
                                    Master Sıfırla
                                </button>"""

content = content.replace("""
                                <button
                                    type="button"
                                    onClick={clearSalesForSelectedBranch}
                                    className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-rose-300 border border-white/10 rounded-lg px-2 py-2 print:hidden self-start"
                                    title="Seçili şubenin satış rakamlarını silir (Tüm şubeler seçiliyse hepsini siler)"
                                >
                                    Satışı temizle
                                </button>""", button_str)

with open('AdminDashboard.jsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Patch applied.")
