import sys

with open('AdminDashboard.jsx', encoding='utf-8') as f:
    lines = f.readlines()

handleResetDatabaseStocks_str = """
    const handleResetDatabaseStocks = async () => {
        const typed = window.prompt(
            'ÇOK ÖNEMLİ: Tüm şubelerin "Kayıtlı Stok (Ana Sistem Stokları)" veritabanından kalıcı silinecektir.\\nDeneme verilerini temizleyip yepyeni bir döneme başlamak için bunu kullanın.\\nOnaylıyorsanız büyük harflerle STOK SIFIRLA yazın:',
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
                                onClick={() => void handleResetDatabaseStocks()}
                                className="px-3 py-1 bg-red-950/40 text-red-400 hover:bg-red-900/60 border border-red-500/30 rounded font-medium text-xs transition-colors flex items-center gap-1 shadow-sm"
                                title="Bütün şubelerin Kayıtlı Sistem Stoklarını (Ana Stokları) kalıcı olarak sıfırlar"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                                <span>Veritabanı Kayıtlı Stok Sıfırla</span>
                            </button>
"""

master_html = """
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
            'DİKKAT: Ürün onay ekranındaki (sadece bu modüldeki) tüm Satış, Tedarik ve Eşleştirme verilerini sileceksiniz.\\nSadece sistem stoklarınız (Kayıtlı Stok) etkilenmez.\\nOnaylıyorsanız "SIFIRLA" yazın:',
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

new_lines = []
inserted_delete_func = False
for i, l in enumerate(lines):
    if 'const handleResetAllCounts = async () => {' in l and not inserted_delete_func:
        new_lines.append(handleResetDatabaseStocks_str + '\n')
        new_lines.append(clear_master_func + '\n')
        new_lines.append(l)
        inserted_delete_func = True
    elif 'onClick={() => void handleResetAllCounts()}' in l:
        new_lines.append(button_html + '\n')
        new_lines.append(l)
    elif 'onClick={() => void setSalesConfirmOpen(true)}' in l:
        new_lines.append(master_html + '\n')
        new_lines.append(l)
    else:
        new_lines.append(l)

with open('AdminDashboard.jsx', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print("added handleResetDatabaseStocks")
