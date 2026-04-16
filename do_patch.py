import re
import sys

with open('AdminDashboard.jsx', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Number parser
float_func = """
    const humanParseFloat = (val) => {
        if (!val) return 0;
        const str = String(val).trim();
        if (str.includes('.') && str.includes(',')) {
            if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
                return parseFloat(str.replace(/[^0-9,]/g, '').replace(',', '.'));
            } else {
                return parseFloat(str.replace(/[^0-9.]/g, ''));
            }
        }
        if (str.includes(',')) return parseFloat(str.replace(/[^0-9,]/g, '').replace(',', '.'));
        return parseFloat(str.replace(/[^0-9.]/g, '')) || 0;
    };
"""
text = text.replace('const applySupplyDrafts = () => {', float_func.strip() + '\n\n    const applySupplyDrafts = () => {')
text = text.replace("const n = Number(raw.replace(/\./g, '').replace(',', '.'));", "const n = humanParseFloat(raw);")

# 2. Consumption fallback
old_recipe_loop = """            const recipeRows = recipeByProductId.get(recipePid) || [];
            if (recipeRows.length > 0) soldRecipeProductCount++;
            recipeRows.forEach((ri) => {
                const useQty = sold * (Number(ri.quantity_per_recipe) || 0);
                if (!Number.isFinite(useQty) || useQty === 0) return;
                const pid = ri.ingredient_product_id;
                consumptionMap.set(pid, (consumptionMap.get(pid) || 0) + useQty);
            });"""
new_recipe_loop = """            const recipeRows = recipeByProductId.get(recipePid) || [];
            if (recipeRows.length === 0) {
                // Direkt tuketim: recete yoksa kendini 1e 1 dusur (icecek vb)
                consumptionMap.set(recipePid, (consumptionMap.get(recipePid) || 0) + sold);
            } else {
                soldRecipeProductCount++;
                recipeRows.forEach((ri) => {
                    const useQty = sold * (Number(ri.quantity_per_recipe) || 0);
                    if (!Number.isFinite(useQty) || useQty === 0) return;
                    const pid = ri.ingredient_product_id;
                    consumptionMap.set(pid, (consumptionMap.get(pid) || 0) + useQty);
                });
            }"""
text = text.replace(old_recipe_loop, new_recipe_loop)

# 3. State and unmatch variables
state_vars = """
    const [posManualMap, setPosManualMap] = useState(() => {
        try { return JSON.parse(localStorage.getItem('izbel_pos_map')) || {}; } catch { return {}; }
    });
    const [salesPosUnmatched, setSalesPosUnmatched] = useState([]);
    
    const applyManualPosMatches = () => {
        let matched = 0;
        setSalesQtyByKey((prev) => {
            const next = { ...prev };
            const stillUnmatched = [];
            salesPosUnmatched.forEach((u) => {
                const mappedId = posManualMap[u.rawPosName];
                if (mappedId) {
                    const key = `${selectedBranchId}|${mappedId}`;
                    next[key] = (next[key] || 0) + u.qty;
                    matched++;
                } else {
                    stillUnmatched.push(u);
                }
            });
            setSalesPosUnmatched(stillUnmatched);
            return next;
        });
        toast.success(`POS eşleştirmeleri uygulandı: ${matched} yeni satış eklendi.`);
    };

    /** Satış içe aktarma / temizleme öncesi kopyalar (geri al) */
"""
text = text.replace("    /** Satış içe aktarma / temizleme öncesi kopyalar (geri al) */", state_vars.strip() + '\n')

# 4. ScLogger UI changes inside importScLoggerPlainText
sclogger_map_old = """
            const resolveScLoggerProductName = (rawName) => {
                const raw = String(rawName || '').trim();
                if (!raw) return { product: null, reason: 'empty' };
                const k = normalizeText(raw);"""
sclogger_map_new = """
            const resolveScLoggerProductName = (rawName) => {
                const raw = String(rawName || '').trim();
                if (posManualMap[raw]) {
                    const mappedProduct = products.find(p => p.id === posManualMap[raw]);
                    if (mappedProduct) return { product: mappedProduct, reason: null };
                }
                if (!raw) return { product: null, reason: 'empty' };
                const k = normalizeText(raw);"""
text = text.replace(sclogger_map_old, sclogger_map_new)

sclogger_loop_old_1 = """            let skipped = 0;
            let matched = 0;
            let ambiguous = 0;

            setStatusMsg('');
            setSalesQtyByKey((prev) => {
                const next = { ...prev };
                rows.forEach((r) => {
                    const { product, reason } = resolveScLoggerProductName(r.name);
                    if (product) {
                        const key = `${selectedBranchId}|${product.id}`;
                        next[key] = (next[key] || 0) + r.qty;
                        matched++;
                    } else {
                        if (reason === 'ambiguous_name' || reason === 'ambiguous_partial') ambiguous++;
                        else skipped++;
                    }
                });
                return next;
            });"""
sclogger_loop_new_1 = """            let skipped = 0;
            let matched = 0;
            let ambiguous = 0;
            const newUnmatched = [];

            setStatusMsg('');
            setSalesQtyByKey((prev) => {
                const next = { ...prev };
                rows.forEach((r) => {
                    const { product, reason } = resolveScLoggerProductName(r.name);
                    if (product) {
                        const key = `${selectedBranchId}|${product.id}`;
                        next[key] = (next[key] || 0) + r.qty;
                        matched++;
                    } else {
                        if (reason === 'ambiguous_name' || reason === 'ambiguous_partial') ambiguous++;
                        else skipped++;
                        newUnmatched.push({ rawPosName: r.name, qty: r.qty, reason });
                    }
                });
                return next;
            });
            setSalesPosUnmatched(newUnmatched);"""
text = text.replace(sclogger_loop_old_1, sclogger_loop_new_1)

# 5. CSV Sales UI changes inside handleBranchSalesImport
csv_map_old = """            const resolveName = (csvName) => {
                const raw = String(csvName || '').trim();
                if (!raw) return { product: null, reason: 'empty' };
                const k = normalizeText(raw);"""
csv_map_new = """            const resolveName = (csvName) => {
                const raw = String(csvName || '').trim();
                if (posManualMap[raw]) {
                    const mappedProduct = products.find(p => p.id === posManualMap[raw]);
                    if (mappedProduct) return { product: mappedProduct, reason: null };
                }
                if (!raw) return { product: null, reason: 'empty' };
                const k = normalizeText(raw);"""
text = text.replace(csv_map_old, csv_map_new)

csv_loop_old = """            let skipped = 0;
            let matched = 0;
            let ambiguous = 0;

            setSalesQtyByKey((prev) => {
                const next = { ...prev };
                rows.forEach((r) => {
                    const stok = String(r[header[colStok]] || '');
                    const urun = String(r[header[colUrun]] || '');
                    const barkod = String(r[header[colBarkod]] || '');
                    const rawqty = parseFlexibleNumber(r[header[colQty]]);
                    const qty = Number(rawqty) || 0;
                    if (qty <= 0) return;
                    const { product, reason } = resolveRef('sale', stok, urun, barkod);
                    if (product) {
                        const key = `${selectedBranchId}|${product.id}`;
                        next[key] = (next[key] || 0) + qty;
                        matched++;
                    } else {
                        if (reason === 'ambiguous_name' || reason === 'ambiguous_partial') ambiguous++;
                        else skipped++;
                    }
                });
                return next;
            });"""
csv_loop_new = """            let skipped = 0;
            let matched = 0;
            let ambiguous = 0;
            const unmatchArrCsv = [];

            setSalesQtyByKey((prev) => {
                const next = { ...prev };
                rows.forEach((r) => {
                    const stok = String(r[header[colStok]] || '');
                    const urun = String(r[header[colUrun]] || '');
                    const barkod = String(r[header[colBarkod]] || '');
                    const rawqty = parseFlexibleNumber(r[header[colQty]]);
                    const qty = Number(rawqty) || 0;
                    if (qty <= 0) return;
                    const { product, reason } = resolveRef('sale', stok, urun, barkod);
                    if (product) {
                        const key = `${selectedBranchId}|${product.id}`;
                        next[key] = (next[key] || 0) + qty;
                        matched++;
                    } else {
                        if (reason === 'ambiguous_name' || reason === 'ambiguous_partial') ambiguous++;
                        else skipped++;
                        unmatchArrCsv.push({ rawPosName: urun || stok || barkod, qty: qty, reason });
                    }
                });
                return next;
            });
            setSalesPosUnmatched(unmatchArrCsv);"""
text = text.replace(csv_loop_old, csv_loop_new)

# 6. UI for Sales Pos Mapping Needs
pos_ui = """
                            {salesPosUnmatched.length > 0 && selectedBranchId !== 'ALL' && (
                                <details className="mt-3 rounded-xl border border-rose-500/25 bg-rose-950/10 px-4 py-3 print:hidden" open>
                                    <summary className="text-xs font-bold text-rose-200/90 cursor-pointer select-none">
                                        Satış İsimlerini Kayıtlı Ürünlere Bağla ({salesPosUnmatched.length})
                                    </summary>
                                    <p className="text-[10px] text-gray-400 mt-2">
                                        Satış dosyasında bulunan ancak kaydedilemeyen ürünler. Karşısına doğru stoğu seçin, bir kez kaydedince hep hatırlanır.
                                    </p>
                                    <div className="mt-2 max-h-56 overflow-auto space-y-2 pr-1">
                                        {salesPosUnmatched.slice(0, 150).map((u, i) => (
                                            <div key={i + u.rawPosName} className="grid grid-cols-[auto,1fr] gap-2 items-center text-xs">
                                                <div className="text-gray-400 font-mono w-48 truncate" title={u.rawPosName}>
                                                    Satış: {u.rawPosName} ({u.qty} adet)
                                                </div>
                                                <select
                                                    value={posManualMap[u.rawPosName] || ''}
                                                    onChange={(ev) => setPosManualMap((m) => {
                                                        const nm = { ...m, [u.rawPosName]: ev.target.value };
                                                        localStorage.setItem('izbel_pos_map', JSON.stringify(nm));
                                                        return nm;
                                                    })}
                                                    className="bg-izbel-dark border border-white/10 rounded-md py-1.5 px-2 text-white text-xs w-full"
                                                >
                                                    <option value="">Seçiniz...</option>
                                                    {products.filter((p) => p.is_active !== false).map((p) => (
                                                        <option key={p.id} value={p.id}>
                                                            {p.stok_kodu || '—'} · {p.product_name}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        ))}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={applyManualPosMatches}
                                        className="mt-3 bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold py-2 px-3 rounded-lg"
                                    >
                                        POS Eşleştirmelerini Uygula (Tekrar Oku)
                                    </button>
                                </details>
                            )}

                            {salesRecipeNeedsMapping.length > 0 && selectedBranchId !== 'ALL' && ("""
text = text.replace("                            {salesRecipeNeedsMapping.length > 0 && selectedBranchId !== 'ALL' && (", pos_ui.strip() + '\n')

with open('AdminDashboard.jsx', 'w', encoding='utf-8') as f:
    f.write(text)
print("done")
