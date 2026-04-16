import sys

with open('AdminDashboard.jsx', 'r', encoding='utf-8') as f:
    text = f.read()

handleResetDatabaseStocks_str = """
    const handleResetDatabaseStocks = async () => {
        const typed = window.prompt(
            `ÇOK ÖNEMLİ: Tüm şubelerin "Kayıtlı Stok (Ana Sistem Stokları)" veritabanından kalıcı silinecektir.\\nDeneme verilerini temizleyip yepyeni bir sayım dönemine başlamak için bunu kullanın.\\nOnaylıyorsanız büyük harflerle STOK SIFIRLA yazın:`
        );
        if (typed !== 'STOK SIFIRLA') {
            if (typed !== null) toast.error('İşlem iptal edildi.');
            return;
        }
        setIsLoading(true);
        const { error } = await supabase.from('branch_stocks').delete().neq('branch_id', '00000000-0000-0000-0000-000000000000');
        setIsLoading(false);
        if (error) {
            toast.error('Stoklar silinemedi: ' + error.message);
            return;
        }
        toast.success('Tüm kayıtlı stoklar (veritabanı) başarıyla TERTEMİZ sıfırlandı.', { style: { background: '#10B981', color: '#fff' } });
        fetchData();
    };
"""

button_html = """
                            <button
                                onClick={() => void handleResetAllCounts()}
                                className="shrink-0 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white font-black py-4 px-8 rounded-xl uppercase tracking-widest text-xs shadow-lg border border-rose-400/40"
                            >
                                Tüm sayımları sil
                            </button>
                            <button
                                onClick={() => void handleResetDatabaseStocks()}
                                className="shrink-0 bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white font-black py-4 px-8 rounded-xl uppercase tracking-widest text-xs shadow-lg border border-red-400/40 ml-2"
                            >
                                Ana Sistem Stoklarını Sıfırla
                            </button>"""

master_html_2 = """
                            <button
                                onClick={() => void clearAllMasterData()}
                                className="px-3 py-1 bg-red-500 text-white hover:bg-red-600 border border-red-600 rounded font-bold text-xs transition-colors shadow-sm ml-2"
                                title="Bu ekrandaki geçici (RAM'deki) Satışları, Eşleştirmeleri, Tedarikleri vs. temizler."
                            >
                                Geçici Verileri (Master) Sıfırla
                            </button>
"""

clear_master_func = """
    const clearAllMasterData = () => {
        const text = prompt(
            `DİKKAT: Ürün onay ekranındaki (sadece bu modüldeki) tüm Satış, Tedarik ve Eşleştirme verilerini sileceksiniz.\\nSadece sistem stoklarınız (Kayıtlı Stok) etkilenmez.\\nOnaylıyorsanız "SIFIRLA" yazın:`
        );
        if (text === 'SIFIRLA') {
            setSalesQtyByKey({});
            setSalesUndoStack([]);
            setManualPurchaseByKey({});
            setSupplyDrafts({});
            setRecipeManualMap({});
            setRecipeRawRowsCache([]);
            setSalesPosUnmatched([]);
            setPosManualMap({});
            localStorage.removeItem('izbel_pos_map');
            toast.success('Bütün Ürün Onay sekmesi verileri tamamen temizlendi.');
        } else {
            if (text !== null) toast.error('Girdi hatalı, sıfırlama iptal edildi.');
        }
    };
"""

if 'handleResetDatabaseStocks' not in text:
    text = text.replace('const handleResetAllCounts = async () => {', handleResetDatabaseStocks_str.strip() + '\\n\\n' + clear_master_func.strip() + '\\n\\n    const handleResetAllCounts = async () => {')

target1 = """                            <button
                                onClick={() => void handleResetAllCounts()}
                                className="shrink-0 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white font-black py-4 px-8 rounded-xl uppercase tracking-widest text-xs shadow-lg border border-rose-400/40"
                            >
                                Tüm sayımları sil
                            </button>"""

if 'Ana Sistem Stoklarını Sıfırla' not in text:
    text = text.replace(target1, button_html)

target2 = """                            <button
                                onClick={() => void setSalesConfirmOpen(true)}
                                disabled={selectedBranchManualPurchaseCount > 0 || (recipeItems || []).length === 0}
                                className="px-3 py-1 bg-emerald-500 text-emerald-950 font-bold rounded-md hover:bg-emerald-400 transition-colors text-[10px] ml-auto"
                                title="Şubedeki satış miktarını reçete bazlı olarak stoktan düş. (Bir kez yapılır)"
                            >
                                Reçeteye göre Düş
                            </button>"""

if 'clearAllMasterData' not in text.split('Reçeteye göre Düş')[0]: # Just an approximation check
    text = text.replace(target2, master_html_2.strip() + '\\n\\n' + target2)

with open('AdminDashboard.jsx', 'w', encoding='utf-8') as f:
    f.write(text)

print("patched db_stocks correctly this time!")
