import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from './supabaseClient';
import {
    Download, RefreshCw, TrendingDown, DollarSign, Wallet,
    Users, Package, ChevronRight, Check, X, LogOut, Search, CalendarPlus, BarChart3, CheckCircle2, Edit3, Trash2, Printer, Tag, Plus, ChevronUp, ChevronDown, RotateCcw, Warehouse
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid, Legend } from 'recharts';
import toast, { Toaster } from 'react-hot-toast';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';

/** Aynı satırdaki şube sayımlarında medyana göre belirgin sapma (en az 2 dolu şube, spread > 0). */
function getOutlierBranchIdsForRow(byBranch, branchesSorted) {
    const pairs = branchesSorted
        .map(b => ({ id: b.id, v: byBranch[b.id] }))
        .filter(p => p.v != null && p.v !== '' && Number.isFinite(Number(p.v)));
    const nums = pairs.map(p => Number(p.v));
    if (nums.length < 2) return new Set();
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    const spread = sorted[sorted.length - 1] - sorted[0];
    if (spread <= 0) return new Set();
    const thresh = Math.max(spread * 0.35, median > 0 ? median * 0.4 : 0, 2);
    const out = new Set();
    for (const p of pairs) {
        if (Math.abs(Number(p.v) - median) >= thresh) out.add(p.id);
    }
    return out;
}

const EXCEL_THIN_BORDER = {
    top: { style: 'thin', color: { argb: 'FFcbd5e1' } },
    left: { style: 'thin', color: { argb: 'FFcbd5e1' } },
    bottom: { style: 'thin', color: { argb: 'FFcbd5e1' } },
    right: { style: 'thin', color: { argb: 'FFcbd5e1' } },
};

/** counts satırı: ilk/son giriş — sunucu UTC; gösterim Europe/Istanbul */
function formatIstanbulCountTimes(c) {
    const firstIso = c.first_counted_at || c.timestamp;
    const lastIso = c.last_counted_at || c.timestamp;
    const opts = {
        timeZone: 'Europe/Istanbul',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    };
    return {
        first: firstIso ? new Date(firstIso).toLocaleString('tr-TR', opts) : '—',
        last: lastIso ? new Date(lastIso).toLocaleString('tr-TR', opts) : '—',
    };
}

/**
 * SCLogger «Başarılı Satış Ürün Toplamları» — PDF’ten kopyalanan satır: ÜRÜN_ADI adet tutar (örn. 98.160,00)
 */
const SALES_UNDO_MAX = 15;

function parseScLoggerSalesLine(line) {
    const t = String(line || '').trim();
    if (!t) return null;
    const lower = t.toLowerCase();
    if (lower.includes('ürün') && lower.includes('toplam') && (lower.includes('adet') || lower.includes('tutar'))) return null;
    if (lower.includes('sclogger') || lower.includes('127.0.0.1') || lower.includes('aralığı raporlandı')) return null;
    if (lower.includes('başarılı ürün raporu')) return null;
    if (lower.includes('başlangıç tarihi') || lower.includes('bitiş tarihi') || lower === 'raporla') return null;
    if (/^\d{1,2}\.\d{1,2}\.\d{4}/.test(t)) return null;
    if (/^\d+\/\d+$/.test(t)) return null;
    const parts = t.split(/\s+/);
    if (parts.length < 3) return null;
    const amount = parts[parts.length - 1].replace(/\s/g, '');
    if (!/^[\d.]+,\d{2}$/.test(amount)) return null;
    const qtyStr = parts[parts.length - 2];
    if (!/^\d+$/.test(qtyStr)) return null;
    let name = parts.slice(0, -2).join(' ');
    name = name.replace(/^\*+/, '').replace(/\*+$/g, '').trim();
    return { name, qty: parseInt(qtyStr, 10) };
}

export default function AdminDashboard({ onLogout }) {
    const [activeTab, setActiveTab] = useState('finans'); // 'finans', 'subeler', 'urunler', 'suberapor', 'kategoriler', 'tedarikcv'

    // Data States
    const [branches, setBranches] = useState([]);
    const [counts, setCounts] = useState([]);
    const [periods, setPeriods] = useState([]);
    const [products, setProducts] = useState([]);
    const [categories, setCategories] = useState([]);
    const [branchStocks, setBranchStocks] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    /** �?ube stok girişi paneli */
    const [stockEntryBranchId, setStockEntryBranchId] = useState('');
    const [stockEntrySearch, setStockEntrySearch] = useState('');
    const [stockEntryDrafts, setStockEntryDrafts] = useState({});
    const [stockEntryCostDrafts, setStockEntryCostDrafts] = useState({});
    const [stockEntrySaving, setStockEntrySaving] = useState(false);
    /** false: yalnızca seçili şubenin branch_stocks ürünleri; true: tüm katalog (yeni şube satırı için) */
    const [stockEntryShowFullCatalog, setStockEntryShowFullCatalog] = useState(false);

    // Filter States
    const [selectedBranchId, setSelectedBranchId] = useState('ALL');
    const [selectedPeriodId, setSelectedPeriodId] = useState('ALL');
    const [productSearch, setProductSearch] = useState('');
    const [onlyMissingBarcode, setOnlyMissingBarcode] = useState(false);

    // Form States for New Branch
    const [newBranchName, setNewBranchName] = useState('');
    const [newUsername, setNewUsername] = useState('');
    const [newPassword, setNewPassword] = useState('');

    // Form States for New Product
    const [newProductName, setNewProductName] = useState('');
    const [newStokKodu, setNewStokKodu] = useState('');
    const [newBarcode, setNewBarcode] = useState('');
    const [newPurchasePrice, setNewPurchasePrice] = useState('');
    const [newCurrentStock, setNewCurrentStock] = useState('');
    const [newCategory, setNewCategory] = useState('');
    const [newUnit, setNewUnit] = useState('Adet');

    // Modal States for Editing Product
    const [editingProduct, setEditingProduct] = useState(null);
    const [editProductName, setEditProductName] = useState('');
    const [editStokKodu, setEditStokKodu] = useState('');
    const [editBarcode, setEditBarcode] = useState('');
    const [editPurchasePrice, setEditPurchasePrice] = useState('');
    const [editCurrentStock, setEditCurrentStock] = useState('');
    const [editCategory, setEditCategory] = useState('');
    const [editUnit, setEditUnit] = useState('Adet');
    const [existingCategories, setExistingCategories] = useState([]);
    const [showSavedOnButton, setShowSavedOnButton] = useState(false);

    // Nutrition CSV fiyat import önizleme
    const [priceImportRows, setPriceImportRows] = useState([]);
    const [priceImportApplying, setPriceImportApplying] = useState(false);

    /** POS Satış Eşleştirmelerini Kaydet */
    const savePosMap = async () => {
        setPosMapLoading(true);
        const entries = Object.entries(posMapPending);
        if (entries.length === 0) {
            setPosMapLoading(false);
            return;
        }

        const rows = entries.map(([posName, pid]) => ({
            pos_product_name: posName,
            product_id: pid,
            updated_at: new Date().toISOString()
        }));

        const { error } = await supabase.from('pos_product_map').upsert(rows, { onConflict: 'pos_product_name' });
        if (error) {
            toast.error('POS eşleştirme hatası: ' + error.message);
        } else {
            toast.success(`${rows.length} ürün eşleştirmesi kaydedildi.`);
            setPosMapPending({});
            await fetchData();
        }
        setPosMapLoading(false);
    };

    const persistSalesRecipeMatch = async (saleProductId, targetProductId) => {
        if (!saleProductId) return;

        setSalesRecipeMap((prev) => {
            const next = { ...prev };
            if (targetProductId) next[saleProductId] = targetProductId;
            else delete next[saleProductId];
            return next;
        });
        setSalesRecipeMapSaving((prev) => ({ ...prev, [saleProductId]: true }));

        try {
            if (targetProductId) {
                const { error } = await supabase.from('sales_recipe_map').upsert([
                    {
                        sale_product_id: saleProductId,
                        target_product_id: targetProductId,
                        updated_at: new Date().toISOString(),
                    },
                ], { onConflict: 'sale_product_id' });
                if (error) throw error;
            } else {
                const { error } = await supabase.from('sales_recipe_map').delete().eq('sale_product_id', saleProductId);
                if (error) throw error;
            }
        } catch (error) {
            toast.error('Satış -> ürün eşleştirmesi kaydedilemedi: ' + error.message);
        } finally {
            setSalesRecipeMapSaving((prev) => ({ ...prev, [saleProductId]: false }));
        }
    };

    // Barkod "API" (Admin panel içinden direkt Supabase işlemleri)
    const [barcodeQuery, setBarcodeQuery] = useState('');
    const [barcodeLookupLoading, setBarcodeLookupLoading] = useState(false);
    const [barcodeLookupResult, setBarcodeLookupResult] = useState(null);
    const [barcodeBindBarcode, setBarcodeBindBarcode] = useState('');
    const [barcodeBindProductSearch, setBarcodeBindProductSearch] = useState('');
    const [barcodeBindSelectedProductId, setBarcodeBindSelectedProductId] = useState('');
    const [barcodeBulkImporting, setBarcodeBulkImporting] = useState(false);
    const [externalLookupLoading, setExternalLookupLoading] = useState(false);
    const [externalLookupResult, setExternalLookupResult] = useState(null);

    // Category Dropdown States
    const [showNewCatDropdown, setShowNewCatDropdown] = useState(false);
    const [showEditCatDropdown, setShowEditCatDropdown] = useState(false);

    // Kategori yönetimi (Kategoriler sekmesi)
    const [newCategoryName, setNewCategoryName] = useState('');

    // Multi-select state
    const [selectedRecords, setSelectedRecords] = useState([]);
    const [showApprovalFullscreen, setShowApprovalFullscreen] = useState(false);

    // CSV import (�?ubeler Stok: A=Stok Kodu, B=Stok Adı, C=Grubu, D=Birimi)
    const [csvImporting, setCsvImporting] = useState(false);
    const [branchMapImporting, setBranchMapImporting] = useState(false);
    /** URUNISMISUBEMALIYET.csv: �?ube + Maliyet + ürün (Ad ve/veya Stok Kodu ve/veya Barkod — DB ile eşleşir) */
    const [urunSubeMaliyetImporting, setUrunSubeMaliyetImporting] = useState(false);
    /** �?ube × ürün satış miktarı (POS/Excel; PDF önce xlsx/csv yapılmalı). Anahtar: `${branchId}|${productId}` */
    const [salesQtyByKey, setSalesQtyByKey] = useState({});
    const salesQtyByKeyRef = useRef(salesQtyByKey);
    useEffect(() => {
        salesQtyByKeyRef.current = salesQtyByKey;
    }, [salesQtyByKey]);

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

    const [salesUndoStack, setSalesUndoStack] = useState([]);
    const [salesImporting, setSalesImporting] = useState(false);
    const [scLoggerPaste, setScLoggerPaste] = useState('');
    /** Satış içe aktarma önizleme (interaktif onay) */
    const [salesPreviewOpen, setSalesPreviewOpen] = useState(false);
    const [salesPreview, setSalesPreview] = useState(null);
    const [salesPreviewApplying, setSalesPreviewApplying] = useState(false);
    /** Reçete düşümü branch_stocks geri alma yedeği */
    const [stockApplyUndoStack, setStockApplyUndoStack] = useState([]);
    /** Excel export kategori bölme modalı */
    const [showExportCategoriesModal, setShowExportCategoriesModal] = useState(false);
    const [exportCategories, setExportCategories] = useState(() => {
        try {
            const saved = localStorage.getItem('exportCategories_v1');
            return saved ? JSON.parse(saved) : [];
        } catch {
            return [];
        }
    });
    const [exportCategoryProductSearch, setExportCategoryProductSearch] = useState('');
    const [expandedCategoryId, setExpandedCategoryId] = useState(null);
    const [onlyRecipeProducts, setOnlyRecipeProducts] = useState(false);
    /** İlk Sayım Modu: aktifse İmpliye Açılış + Anomali sheet üretir, varyans hesaplamaz */
    const [firstPeriodMode, setFirstPeriodMode] = useState(false);
    /** Manuel alım (tedarik) girdileri: key branch|product -> quantity */
    const [manualPurchaseByKey, setManualPurchaseByKey] = useState({});
    const [showSupplyModal, setShowSupplyModal] = useState(false);
    const [supplyCategory, setSupplyCategory] = useState('ALL');
    const [supplySearch, setSupplySearch] = useState('');
    const [supplyDrafts, setSupplyDrafts] = useState({});
    /** Reçete importu */
    const [recipeItems, setRecipeItems] = useState([]);
    const [recipeImporting, setRecipeImporting] = useState(false);
    const [recipeRawRowsCache, setRecipeRawRowsCache] = useState([]);
    const [recipeUnmatched, setRecipeUnmatched] = useState([]);
    const [recipeManualMap, setRecipeManualMap] = useState({});
    /** Tedarik CSV import paneli */
    const [tcvStep, setTcvStep] = useState('upload'); // 'upload' | 'match' | 'preview'
    const [tcvAggregated, setTcvAggregated] = useState([]); // [{csvBranch, materialName, totalQty, unit, suppliers, key}]
    const [tcvBranchMap, setTcvBranchMap] = useState({}); // csvBranch -> systemBranchId
    const [tcvProductMap, setTcvProductMap] = useState({}); // materialName -> productId
    const [tcvProductSearch, setTcvProductSearch] = useState({}); // materialName -> search query
    const [tcvFilter, setTcvFilter] = useState(''); // genel filtre
    const [tcvShowMatched, setTcvShowMatched] = useState(true);
    const [tcvShowUnmatched, setTcvShowUnmatched] = useState(true);
    /** Miktar düzeltme: key (csvBranch|||material) -> gerçek sistem miktarı */
    const [tcvQtyOverride, setTcvQtyOverride] = useState({});
    /** Önceden kaydedilmiş değerler için düzenleme kilidi: key -> boolean */
    const [tcvUnlockedEdits, setTcvUnlockedEdits] = useState({});

    // POS Eşleştirme States
    const [posManualMap, setPosManualMap] = useState({});
    const [posMapLoading, setPosMapLoading] = useState(false);
    const [posMapSearch, setPosMapSearch] = useState({}); // rawPosName -> string
    const [posMapPending, setPosMapPending] = useState({}); // rawPosName -> productId (kaydedilmemiş)

    /** Satış ürünü -> reçete mamul ürün eşleştirmesi (ürün id -> ürün id) */
    const [salesRecipeMap, setSalesRecipeMap] = useState({});
    const [showSalesRecipeMapModal, setShowSalesRecipeMapModal] = useState(false);
    const [salesRecipeSearch, setSalesRecipeSearch] = useState('');
    const [salesRecipeMapSaving, setSalesRecipeMapSaving] = useState({});
    const [salesRecipeShowResolved, setSalesRecipeShowResolved] = useState(false);
    const [showRecipeBuilderModal, setShowRecipeBuilderModal] = useState(false);
    const [recipeBuilderRecipeProductId, setRecipeBuilderRecipeProductId] = useState('');
    const [recipeBuilderRows, setRecipeBuilderRows] = useState([{ ingredient_product_id: '', qty: '', unit: 'gr' }]);
    const [recipeBuilderSaving, setRecipeBuilderSaving] = useState(false);
    const [recipeBuilderTemplateSelected, setRecipeBuilderTemplateSelected] = useState({});

    const pushSalesUndoSnapshot = useCallback(() => {
        setSalesUndoStack((s) => [...s.slice(-(SALES_UNDO_MAX - 1)), { ...salesQtyByKeyRef.current }]);
    }, []);

    // Stok kartları export/import + eşleşme listesi filtreleri
    const [stokListOnlyMissing, setStokListOnlyMissing] = useState(false);
    const [stokListSearchName, setStokListSearchName] = useState('');
    const [stokListSearchGroup, setStokListSearchGroup] = useState('');
    const [stokListSortBy, setStokListSortBy] = useState('stok_kodu');
    const [stokListSortAsc, setStokListSortAsc] = useState(true);
    const [stokListImporting, setStokListImporting] = useState(false);
    const [showStokListFullscreen, setShowStokListFullscreen] = useState(false);
    const [stokListShowPassive, setStokListShowPassive] = useState(false);
    const [stokListSelectedIds, setStokListSelectedIds] = useState([]);

    // �?ube × stok kodu karşılaştırma raporu (aktif dönem, tüm count status)
    const [subeRaporSearch, setSubeRaporSearch] = useState('');
    const [editPiecesPerPackage, setEditPiecesPerPackage] = useState('');
    const [editLitersPerUnit, setEditLitersPerUnit] = useState('');

    const normalizeText = (value) => {
        if (!value) return '';
        let text = String(value).toLowerCase('tr-TR');
        text = text
            .replace(/İ/g, 'i')
            .replace(/I/g, 'ı')
            .replace(/[^a-zA-Z0-9ığüşöçİ�?Ü�?ÖÇ\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return text;
    };

    /** Excel/CSV'de ASCII şube adı (CINARLI) ile DB'deki Türkçe adı (Çınarlı) eşlemek için */
    const asciiFoldKey = (value) => {
        if (!value) return '';
        let t = normalizeText(value);
        return t
            .replace(/ç/g, 'c')
            .replace(/ğ/g, 'g')
            .replace(/ı/g, 'i')
            .replace(/ö/g, 'o')
            .replace(/ş/g, 's')
            .replace(/ü/g, 'u');
    };

    // "312,5" ve "312.5" gibi değerleri güvenli biçimde parse eder.
    const parseFlexibleNumber = (value) => {
        const raw = String(value ?? '').trim();
        if (!raw) return null;

        let s = raw.replace(/\s+/g, '');
        const hasComma = s.includes(',');
        const hasDot = s.includes('.');

        if (hasComma && hasDot) {
            // Son görülen ayıracı ondalık kabul et, diğerini binlik kabul edip temizle.
            const lastComma = s.lastIndexOf(',');
            const lastDot = s.lastIndexOf('.');
            const decimalSep = lastComma > lastDot ? ',' : '.';
            const thousandSep = decimalSep === ',' ? '.' : ',';
            s = s.replace(new RegExp(`\\${thousandSep}`, 'g'), '');
            if (decimalSep === ',') s = s.replace(',', '.');
        } else if (hasComma) {
            s = s.replace(/\./g, '').replace(',', '.');
        } else if (hasDot) {
            const parts = s.split('.');
            if (parts.length > 2) {
                // 1.234.567 gibi binlik format
                s = parts.join('');
            } else if (parts.length === 2 && parts[1].length === 3 && parts[0].length >= 1) {
                // 1.234 => binlik olma ihtimali yüksek
                s = parts.join('');
            }
        }

        const n = Number(s);
        return Number.isFinite(n) ? n : null;
    };

    const fetchData = async () => {
        setIsLoading(true);
        const { data: bData } = await supabase.from('branches').select('*');
        const { data: pData } = await supabase.from('counting_periods').select('*').order('created_at', { ascending: false });
        const { data: cData } = await supabase.from('counts').select(`
      *,
      products ( id, product_name, current_stock, purchase_price, unit_price, barcode, category, unit, stok_kodu )
    `);
        let bsData = [];
        {
            const { data: bs, error: bsErr } = await supabase.from('branch_stocks').select('branch_id, product_id, quantity, unit_cost, updated_at');
            if (!bsErr && bs) bsData = bs;
        }
        let recipeData = [];
        {
            const { data: ri, error: riErr } = await supabase
                .from('recipe_items')
                .select('recipe_product_id, ingredient_product_id, quantity_per_recipe, recipe_unit, source_recipe_code, source_recipe_name, updated_at');
            if (!riErr && ri) recipeData = ri;
        }
        const { data: catData } = await supabase.from('categories').select('*').order('sort_order').order('name');
        // products select: is_active / dönüşüm kolonları DB'de yoksa fallback
        let prodData = null;
        {
            const trySelect = async (cols) => {
                const { data, error } = await supabase.from('products').select(cols);
                return { data, error };
            };
            let { data, error } = await trySelect('id, product_name, barcode, unit, purchase_price, category, stok_kodu, is_active, pieces_per_package, liters_per_unit');
            if (error) {
                ({ data, error } = await trySelect('id, product_name, barcode, unit, purchase_price, category, stok_kodu, is_active'));
            }
            if (error) {
                ({ data, error } = await trySelect('id, product_name, barcode, unit, purchase_price, category, stok_kodu'));
            }
            if (error) {
                console.error('Products fetch error:', error.message);
                prodData = [];
            } else {
                prodData = (data || []).map(p => ({
                    ...p,
                    is_active: p.is_active !== undefined ? p.is_active : true,
                    pieces_per_package: p.pieces_per_package ?? null,
                    liters_per_unit: p.liters_per_unit ?? null,
                }));
            }
        }

        if (bData) setBranches(bData);
        if (pData) setPeriods(pData);
        if (cData) {
            setCounts(cData);
            const cats = cData.map(c => c.products?.category).filter(Boolean);
            setExistingCategories([...new Set(cats)]);
        }
        if (catData) setCategories(catData);
        if (prodData) setProducts(prodData);
        setBranchStocks(bsData);
        setRecipeItems(recipeData);

        // Otomatik olarak aktif dönemi seç (eğer varsa) ve kullanıcı daha önce bir şey seçmediyse
        const resolvedPeriods = pData || [];
        let activePeriodId = null;
        if (resolvedPeriods.length > 0) {
            const activeP = resolvedPeriods.find(p => p.is_active);
            if (activeP) {
                activePeriodId = activeP.id;
                if (selectedPeriodId === 'ALL') setSelectedPeriodId(activeP.id);
            }
        }

        // --- Manual supplies: DB'den yükle (aktif dönem bazlı) ---
        if (activePeriodId) {
            const { data: msData, error: msErr } = await supabase
                .from('manual_supplies')
                .select('branch_id, product_id, quantity')
                .eq('period_id', activePeriodId);
            if (!msErr && msData && msData.length > 0) {
                const loaded = {};
                msData.forEach((r) => {
                    const k = `${r.branch_id}|${r.product_id}`;
                    loaded[k] = (loaded[k] || 0) + Number(r.quantity);
                });
                setManualPurchaseByKey(loaded);
            } else {
                setManualPurchaseByKey({});
            }
        } else {
            setManualPurchaseByKey({});
        }

        // --- POS Product Map: DB'den yükle ---
        const { data: posData, error: posErr } = await supabase.from('pos_product_map').select('pos_product_name, product_id');
        if (!posErr && posData) {
            const pMap = {};
            posData.forEach(r => { pMap[r.pos_product_name] = r.product_id; });
            setPosManualMap(pMap);
        }

        // --- Sales -> Recipe/Product Map: DB'den yükle ---
        const { data: salesRecipeData, error: salesRecipeErr } = await supabase.from('sales_recipe_map').select('sale_product_id, target_product_id');
        if (!salesRecipeErr && salesRecipeData) {
            const map = {};
            salesRecipeData.forEach((r) => {
                if (r.sale_product_id && r.target_product_id) map[r.sale_product_id] = r.target_product_id;
            });
            setSalesRecipeMap(map);
        }

        setIsLoading(false);
    };

    useEffect(() => {
        fetchData();
    }, []);

    useEffect(() => {
        if (branches.length > 0 && !stockEntryBranchId) {
            setStockEntryBranchId(branches[0].id);
        }
    }, [branches, stockEntryBranchId]);

    useEffect(() => {
        setStockEntryDrafts({});
        setStockEntryCostDrafts({});
    }, [stockEntryBranchId]);

    /** Aktif sayım döneminde counts → stok_kodu (UPPER trim) benzersiz anahtar; şube sütunları + min/max/ort */
    const subeKarsilastirma = useMemo(() => {
        const activeP = periods.find(p => p.is_active);
        const branchesSorted = [...branches].sort((a, b) => (a.branch_name || '').localeCompare(b.branch_name || '', 'tr'));
        if (!activeP) {
            return { activePeriod: null, branchesSorted, withStok: [], missingStok: [] };
        }
        const filtered = counts.filter(c => c.period_id === activeP.id && c.products && c.branch_id);

        const stokMap = new Map();
        const missingMap = new Map();

        for (const c of filtered) {
            const p = c.products;
            const val = Number(c.counted_stock);
            if (!Number.isFinite(val)) continue;
            const bid = c.branch_id;

            const rawSk = (p.stok_kodu || '').trim();
            if (rawSk) {
                const norm = rawSk.toUpperCase();
                if (!stokMap.has(norm)) {
                    stokMap.set(norm, {
                        stokKey: norm,
                        displayCode: rawSk,
                        product_name: p.product_name || '',
                        unit: p.unit || '',
                        category: p.category || '',
                        byBranch: {},
                    });
                }
                const row = stokMap.get(norm);
                row.byBranch[bid] = (row.byBranch[bid] || 0) + val;
                if (rawSk.length >= (row.displayCode || '').length && /[A-Z0-9]/.test(rawSk)) {
                    row.displayCode = rawSk;
                }
            } else {
                const pid = p.id;
                if (!missingMap.has(pid)) {
                    missingMap.set(pid, {
                        product_id: pid,
                        product_name: p.product_name || '',
                        unit: p.unit || '',
                        category: p.category || '',
                        byBranch: {},
                    });
                }
                const m = missingMap.get(pid);
                m.byBranch[bid] = (m.byBranch[bid] || 0) + val;
            }
        }

        const addStats = (row) => {
            const nums = branchesSorted.map(b => row.byBranch[b.id]).filter(v => v != null && Number.isFinite(v));
            const min = nums.length ? Math.min(...nums) : null;
            const max = nums.length ? Math.max(...nums) : null;
            const sum = nums.reduce((a, b) => a + b, 0);
            const avg = nums.length ? sum / nums.length : null;
            const range = min != null && max != null ? max - min : null;
            return { ...row, stats: { min, max, avg, range, seCount: nums.length } };
        };

        const withStok = Array.from(stokMap.values()).map(addStats)
            .sort((a, b) => a.stokKey.localeCompare(b.stokKey, 'tr'));

        const missingStok = Array.from(missingMap.values()).map(addStats)
            .sort((a, b) => (a.product_name || '').localeCompare(b.product_name || '', 'tr'));

        return { activePeriod: activeP, branchesSorted, withStok, missingStok };
    }, [counts, branches, periods]);

    const branchStockByKey = useMemo(() => {
        const m = new Map();
        (branchStocks || []).forEach((r) => {
            m.set(`${r.branch_id}|${r.product_id}`, r);
        });
        return m;
    }, [branchStocks]);

    /** Reçetede kullanılan tüm ürün id'leri (mamul + hammadde) */
    const recipeProductIdSet = useMemo(() => {
        const s = new Set();
        (recipeItems || []).forEach((r) => {
            if (r.recipe_product_id) s.add(String(r.recipe_product_id));
            if (r.ingredient_product_id) s.add(String(r.ingredient_product_id));
        });
        return s;
    }, [recipeItems]);

    /** Reçete raw cache'ten gelen stok kodlarından hangileri sistemde yok? */
    const missingRecipeStokKodlari = useMemo(() => {
        if (!recipeRawRowsCache || recipeRawRowsCache.length === 0) return [];
        const sysSet = new Set(
            products
                .map((p) => String(p.stok_kodu || '').trim().toUpperCase())
                .filter(Boolean),
        );
        const missing = new Map();
        recipeRawRowsCache.forEach((row) => {
            const refs = [
                { code: row.recipe_stok_kodu, name: row.recipe_name, kind: 'Mamul' },
                { code: row.ingredient_stok_kodu, name: row.ingredient_name, kind: 'Hammadde' },
            ];
            refs.forEach((rf) => {
                const c = String(rf.code || '').trim().toUpperCase();
                if (!c) return;
                if (sysSet.has(c)) return;
                if (!missing.has(c)) {
                    missing.set(c, { stok_kodu: c, name: rf.name || '', kind: rf.kind });
                }
            });
        });
        return Array.from(missing.values());
    }, [recipeRawRowsCache, products]);

    const branchStockMap = useMemo(() => {
        const m = new Map();
        branchStockByKey.forEach((r, k) => {
            m.set(k, Number(r.quantity) || 0);
        });
        return m;
    }, [branchStockByKey]);

    /** �?ube+ürün için birim maliyet: önce branch_stocks.unit_cost, yoksa ürün purchase_price. */
    const unitCostForBranchProduct = useCallback(
        (branchId, product) => {
            if (!branchId || !product?.id) return Number(product?.purchase_price) || 0;
            const row = branchStockByKey.get(`${branchId}|${product.id}`);
            const uc = row?.unit_cost;
            if (uc != null && uc !== '' && Number.isFinite(Number(uc))) return Number(uc);
            return Number(product?.purchase_price) || 0;
        },
        [branchStockByKey],
    );

    const unitCostForCount = useCallback(
        (c) => unitCostForBranchProduct(c?.branch_id, c?.products),
        [unitCostForBranchProduct],
    );

    /** Sayım satırı için “sistem stoku”: önce şube stok kartı, yoksa ürün.current_stock (eski veri). */
    const sysStockForCount = useCallback(
        (c) => {
            if (!c?.branch_id || !c?.product_id) return Number(c.products?.current_stock) || 0;
            const k = `${c.branch_id}|${c.product_id}`;
            if (branchStockMap.has(k)) return branchStockMap.get(k);
            return Number(c.products?.current_stock) || 0;
        },
        [branchStockMap],
    );

    const stockEntryBranchProductIds = useMemo(() => {
        if (!stockEntryBranchId) return null;
        const ids = new Set();
        (branchStocks || []).forEach((r) => {
            if (r.branch_id === stockEntryBranchId) ids.add(r.product_id);
        });
        return ids;
    }, [branchStocks, stockEntryBranchId]);

    const stockEntryProducts = useMemo(() => {
        const q = normalizeText(stockEntrySearch);
        let list = products.filter(p => p.is_active !== false);
        if (stockEntryBranchId && !stockEntryShowFullCatalog && stockEntryBranchProductIds) {
            list = list.filter(p => stockEntryBranchProductIds.has(p.id));
        }
        if (q) {
            const words = q.split(' ').filter(Boolean);
            list = list.filter(p => {
                const hay = normalizeText(`${p.stok_kodu || ''} ${p.product_name || ''} ${p.barcode || ''}`);
                return words.every(w => hay.includes(w));
            });
        }
        return list.slice(0, 600);
    }, [products, stockEntrySearch, stockEntryBranchId, stockEntryShowFullCatalog, stockEntryBranchProductIds]);

    const supplyCategories = useMemo(() => {
        const set = new Set();
        products.filter((p) => p.is_active !== false).forEach((p) => {
            const c = String(p.category || '').trim();
            if (c) set.add(c);
        });
        return ['ALL', ...Array.from(set).sort((a, b) => a.localeCompare(b, 'tr'))];
    }, [products]);

    const supplyProducts = useMemo(() => {
        const q = normalizeText(supplySearch);
        let list = products.filter((p) => p.is_active !== false);
        if (supplyCategory !== 'ALL') {
            list = list.filter((p) => String(p.category || '') === supplyCategory);
        }
        if (q) {
            const words = q.split(' ').filter(Boolean);
            list = list.filter((p) => {
                const hay = normalizeText(`${p.stok_kodu || ''} ${p.product_name || ''} ${p.barcode || ''}`);
                return words.every((w) => hay.includes(w));
            });
        }
        return list.slice(0, 800);
    }, [products, supplyCategory, supplySearch]);

    const recipeByProductId = useMemo(() => {
        const m = new Map();
        (recipeItems || []).forEach((r) => {
            const key = r.recipe_product_id;
            if (!key) return;
            if (!m.has(key)) m.set(key, []);
            m.get(key).push(r);
        });
        return m;
    }, [recipeItems]);

    const resolveRecipeProductIdForSaleProduct = useCallback((saleProductId) => {
        if (!saleProductId) return null;
        if (recipeByProductId.has(saleProductId)) return saleProductId;
        const mapped = salesRecipeMap[saleProductId];
        if (mapped) return mapped;
        return null;
    }, [recipeByProductId, salesRecipeMap]);

    const exportSubeKarsilastirmaXlsx = async () => {
        const { activePeriod, branchesSorted, withStok, missingStok } = subeKarsilastirma;
        if (!activePeriod) {
            toast.error('Aktif sayım dönemi yok.');
            return;
        }
        const q = normalizeText(subeRaporSearch);
        const match = (row) => {
            if (!q) return true;
            const code = row.displayCode || row.stokKey || '';
            const hay = normalizeText(`${code} ${row.product_name || ''} ${row.product_id || ''}`);
            const words = q.split(' ').filter(Boolean);
            return words.every(w => hay.includes(w));
        };
        const branchHeaders = branchesSorted.map(b => `sube_${b.branch_name.replace(/\s+/g, '_')}`);
        const headMain = ['stok_kodu', 'urun_adi', 'birim', 'kategori', 'min', 'max', 'ortalama', 'aralik', 'subesi_olan_sayisi', ...branchHeaders];
        const headMiss = ['urun_id', 'urun_adi', 'birim', 'kategori', 'min', 'max', 'ortalama', 'aralik', 'subesi_olan_sayisi', ...branchHeaders];

        const bodyWith = withStok.filter(match).map(row => ({
            byBranch: row.byBranch,
            line: [
                row.displayCode || row.stokKey,
                row.product_name,
                row.unit,
                row.category,
                row.stats.min,
                row.stats.max,
                row.stats.avg != null ? Number(row.stats.avg.toFixed(4)) : '',
                row.stats.range,
                row.stats.seCount,
                ...branchesSorted.map(b => row.byBranch[b.id] ?? ''),
            ],
        }));
        const bodyMiss = missingStok.filter(match).map(row => ({
            byBranch: row.byBranch,
            line: [
                row.product_id,
                row.product_name,
                row.unit,
                row.category,
                row.stats.min,
                row.stats.max,
                row.stats.avg != null ? Number(row.stats.avg.toFixed(4)) : '',
                row.stats.range,
                row.stats.seCount,
                ...branchesSorted.map(b => row.byBranch[b.id] ?? ''),
            ],
        }));

        const applyHeaderGradient = (sheet, headers, variant = 'blue') => {
            const stops =
                variant === 'amber'
                    ? [
                        { position: 0, color: { argb: 'FF7c2d12' } },
                        { position: 0.5, color: { argb: 'FFc2410c' } },
                        { position: 1, color: { argb: 'FFfb923c' } },
                    ]
                    : [
                        { position: 0, color: { argb: 'FF0f172a' } },
                        { position: 0.45, color: { argb: 'FF1d4ed8' } },
                        { position: 1, color: { argb: 'FF38bdf8' } },
                    ];
            const row1 = sheet.getRow(1);
            row1.height = 24;
            for (let c = 1; c <= headers.length; c++) {
                const cell = row1.getCell(c);
                cell.value = headers[c - 1];
                cell.fill = {
                    type: 'gradient',
                    gradient: 'angle',
                    degree: 0,
                    stops,
                };
                cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Calibri', size: 10 };
                cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
                cell.border = EXCEL_THIN_BORDER;
            }
        };

        const fillDataRows = (sheet, body, branchesSorted, firstBranchCol) => {
            const statFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
            const outlierFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE4E6' } };
            let r = 2;
            for (const { line, byBranch } of body) {
                const outliers = getOutlierBranchIdsForRow(byBranch, branchesSorted);
                const excelRow = sheet.getRow(r);
                excelRow.height = 18;
                for (let c = 1; c <= line.length; c++) {
                    const cell = excelRow.getCell(c);
                    cell.value = line[c - 1];
                    const isNumCol = c >= 5 && c <= 9;
                    const isBranchCol = c >= firstBranchCol;
                    const bIdx = c - firstBranchCol;
                    const branch = branchesSorted[bIdx];
                    const isOutlier = branch && outliers.has(branch.id);
                    cell.font = {
                        name: 'Calibri',
                        size: 10,
                        bold: isOutlier,
                        color: { argb: isOutlier ? 'FFb91c1c' : 'FF0f172a' },
                    };
                    cell.alignment = {
                        vertical: 'middle',
                        horizontal: isNumCol ? 'right' : c === 2 || c === 1 ? 'left' : 'left',
                    };
                    if (isOutlier) cell.fill = outlierFill;
                    else if (isNumCol) cell.fill = statFill;
                    cell.border = EXCEL_THIN_BORDER;
                }
                r++;
            }
        };

        const setColumnWidths = (sheet, branchesSorted) => {
            sheet.columns = [
                { width: 12 },
                { width: 38 },
                { width: 10 },
                { width: 18 },
                { width: 9 },
                { width: 9 },
                { width: 11 },
                { width: 10 },
                { width: 12 },
                ...branchesSorted.map(() => ({ width: 13 })),
            ];
        };

        try {
            const wb = new ExcelJS.Workbook();
            wb.creator = 'İzbel Stok Sayım';
            wb.created = new Date();

            const ws1 = wb.addWorksheet('Stok_kodu_karsilastirma', {
                views: [{ state: 'frozen', ySplit: 1, xSplit: 0 }],
            });
            applyHeaderGradient(ws1, headMain, 'blue');
            fillDataRows(ws1, bodyWith, branchesSorted, 10);
            setColumnWidths(ws1, branchesSorted);

            const ws2 = wb.addWorksheet('Eksik_stok_kodu', {
                views: [{ state: 'frozen', ySplit: 1, xSplit: 0 }],
            });
            applyHeaderGradient(ws2, headMiss, 'amber');
            fillDataRows(ws2, bodyMiss, branchesSorted, 10);
            setColumnWidths(ws2, branchesSorted);

            const buf = await wb.xlsx.writeBuffer();
            const blob = new Blob([buf], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `sube_karsilastirma_${activePeriod.period_name.replace(/\s+/g, '_')}.xlsx`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success('Excel indirildi (gradyan başlık + uç sapma vurgusu).');
        } catch (e) {
            console.error(e);
            toast.error('Excel oluşturulamadı: ' + (e?.message || String(e)));
        }
    };

    // --------------- PERIOD MANAGEMENT ---------------
    const handleStartNewPeriod = async () => {
        const periodName = prompt("Yeni sayım dönemi adı girin (Örn: 2026 2. Çeyrek Sayımı):");
        if (!periodName) return;

        setIsLoading(true);
        // Önce eskileri pasife al
        await supabase.from('counting_periods').update({ is_active: false }).neq('id', '00000000-0000-0000-0000-000000000000'); // hacky way to target all

        // Yeni dönemi insert et
        const { error } = await supabase.from('counting_periods').insert([{ period_name: periodName, is_active: true }]);

        if (error) {
            toast.error("Hata: " + error.message);
        } else {
            toast.success(`${periodName} dönemi başarıyla başlatıldı!`);
            fetchData();
        }
        setIsLoading(false);
    };

    const handleCloseActivePeriod = async () => {
        if (!confirm("Aktif sayım dönemini kapatmak istediğinize emin misiniz? �?ubeler ekranlarında artık tarama yapamayacak.")) return;
        setIsLoading(true);
        const activePeriod = periods.find(p => p.is_active);
        if (activePeriod) {
            await supabase.from('counting_periods').update({ is_active: false, closed_at: new Date().toISOString() }).eq('id', activePeriod.id);
            toast.success("Dönem başarıyla kapatıldı ve arşivlendi.");
            setSelectedPeriodId('ALL');
            fetchData();
        }
        setIsLoading(false);
    }

    // --------------- ADMIN APPROVAL LOGIC ---------------
    const handleApproveCount = async (countId, productId, newStock, branchId) => {
        if (!branchId) {
            toast.error('�?ube bilgisi eksik; onay yapılamadı.');
            return;
        }
        setIsLoading(true);
        const existingBs = branchStockByKey.get(`${branchId}|${productId}`);
        const { error: bsErr } = await supabase.from('branch_stocks').upsert(
            {
                branch_id: branchId,
                product_id: productId,
                quantity: newStock,
                unit_cost: existingBs?.unit_cost ?? null,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'branch_id,product_id' },
        );
        if (bsErr) {
            toast.error('�?ube stoku güncellenemedi: ' + bsErr.message);
            setIsLoading(false);
            return;
        }
        const { error: countErr } = await supabase.from('counts').update({ status: 'approved' }).eq('id', countId);
        if (!countErr) {
            toast.success('Sayım onaylandı! Bu şubenin sistem stoku güncellendi.', { style: { background: '#10B981', color: '#fff' } });
            fetchData();
        } else {
            toast.error("Hata: Sayım durumu güncellenemedi.");
            console.error('Count Update Error', countErr);
        }
        setIsLoading(false);
    };

    const handleResetDatabaseStocks = async () => {
        const typed = window.prompt(
            'ÇOK ÖNEMLİ: Tüm şubelerin "Kayıtlı Stok (Ana Sistem Stokları)" veritabanından kalıcı silinecektir.\nDeneme verilerini temizleyip yepyeni bir sayım dönemine başlamak için bunu kullanın.\nOnaylıyorsanız büyük harflerle STOK SIFIRLA yazın:'
        );
        if (typed !== 'STOK SIFIRLA') {
            if (typed !== null) toast.error('İşlem iptal edildi.');
            return;
        }
        setIsLoading(true);
        // 1. �?ube bazlı stokları sil
        const { error } = await supabase.from('branch_stocks').delete().neq('branch_id', '00000000-0000-0000-0000-000000000000');
        
        // 2. Ana sistem ürün stoklarını 0 yap (İlk Stok sorununu çözmek için)
        const { error: pErr } = await supabase.from('products').update({ current_stock: 0 }).neq('id', '00000000-0000-0000-0000-000000000000');
        
        setIsLoading(false);
        if (error || pErr) {
            toast.error('Stoklar silinemedi: ' + (error?.message || pErr?.message));
            return;
        }
        toast.success('Tüm kayıtlı stoklar (veritabanı + ürünler) başarıyla TERTEMİZ sıfırlandı.', { style: { background: '#10B981', color: '#fff' } });
        fetchData();
    };

    const clearAllMasterData = async () => {
        const text = prompt(
            'DİKKAT: Ürün onay ekranındaki (sadece bu modüldeki) tüm Satış, Tedarik ve Eşleştirme verilerini sileceksiniz.\\nSadece sistem stoklarınız (Kayıtlı Stok) etkilenmez.\\nOnaylıyorsanız "SIFIRLA" yazın:'
        );
        if (text === 'SIFIRLA') {
            // DB'deki manual_supplies'ı da temizle (aktif dönem varsa)
            const activePeriod = periods.find(p => p.is_active);
            if (activePeriod) {
                setIsLoading(true);
                await supabase
                    .from('manual_supplies')
                    .delete()
                    .eq('period_id', activePeriod.id);
                setIsLoading(false);
            }
            setSalesQtyByKey({});
            setSalesUndoStack([]);
            setManualPurchaseByKey({});
            setSupplyDrafts({});
            setRecipeManualMap({});
            setRecipeRawRowsCache([]);
            setSalesPosUnmatched([]);
            setPosManualMap({});
            localStorage.removeItem('izbel_pos_map');
            toast.success('Bütün Ürün Onay sekmesi verileri tamamen temizlendi (DB tedarikleri dahil).');
        } else {
            if (text !== null) toast.error('Girdi hatalı, sıfırlama iptal edildi.');
        }
    };

    const handleResetAllCounts = async () => {
        const typed = window.prompt(
            'TÜM sayım kayıtlarını silmek için büyük harflerle SIFIRLA yazın. Ürün kartları, maliyetler ve şube stok girişleri silinmez.',
        );
        if (typed !== 'SIFIRLA') {
            if (typed !== null) toast.error('İşlem iptal edildi.');
            return;
        }
        setIsLoading(true);
        const { error } = await supabase.from('counts').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        setIsLoading(false);
        if (error) {
            toast.error('Sayımlar silinemedi: ' + error.message);
            return;
        }
        toast.success('Tüm sayım kayıtları silindi.', { style: { background: '#10B981', color: '#fff' } });
        setSelectedRecords([]);
        fetchData();
    };

    const saveBranchProductStock = async (branchId, productId, rawValue) => {
        const n = Number(String(rawValue).replace(',', '.'));
        const quantity = Number.isFinite(n) ? n : 0;
        const k = `${branchId}|${productId}`;
        const existingBs = branchStockByKey.get(k);
        const hadRow = branchStockMap.has(k);
        const prevQ = hadRow ? branchStockMap.get(k) : null;
        if (hadRow && Number(prevQ) === quantity) {
            setStockEntryDrafts((d) => {
                const next = { ...d };
                delete next[productId];
                return next;
            });
            return;
        }
        if (!hadRow && quantity === 0) {
            setStockEntryDrafts((d) => {
                const next = { ...d };
                delete next[productId];
                return next;
            });
            return;
        }
        setStockEntrySaving(true);
        const unit_cost = existingBs?.unit_cost ?? null;
        const { error } = await supabase.from('branch_stocks').upsert(
            {
                branch_id: branchId,
                product_id: productId,
                quantity,
                unit_cost,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'branch_id,product_id' },
        );
        setStockEntrySaving(false);
        if (error) {
            toast.error('Kayıt hatası: ' + error.message);
            return;
        }
        const ts = new Date().toISOString();
        setBranchStocks((prev) => {
            const rest = prev.filter((r) => !(r.branch_id === branchId && r.product_id === productId));
            return [...rest, { branch_id: branchId, product_id: productId, quantity, unit_cost, updated_at: ts }];
        });
        setStockEntryDrafts((d) => {
            const next = { ...d };
            delete next[productId];
            return next;
        });
    };

    const saveBranchProductUnitCost = async (branchId, productId, rawValue) => {
        const s = String(rawValue ?? '').trim();
        let unit_cost = null;
        if (s !== '') {
            const n = Number(s.replace(',', '.'));
            unit_cost = Number.isFinite(n) ? n : null;
        }
        const k = `${branchId}|${productId}`;
        const existingBs = branchStockByKey.get(k);
        const prevNum = existingBs?.unit_cost != null && existingBs.unit_cost !== '' && Number.isFinite(Number(existingBs.unit_cost))
            ? Number(existingBs.unit_cost)
            : null;
        if (unit_cost === null && prevNum === null) {
            setStockEntryCostDrafts((d) => {
                const next = { ...d };
                delete next[productId];
                return next;
            });
            return;
        }
        if (unit_cost !== null && prevNum !== null && unit_cost === prevNum) {
            setStockEntryCostDrafts((d) => {
                const next = { ...d };
                delete next[productId];
                return next;
            });
            return;
        }
        const quantity = existingBs ? Number(existingBs.quantity) || 0 : (branchStockMap.has(k) ? branchStockMap.get(k) : 0);
        if (!existingBs && quantity === 0 && unit_cost === null) {
            setStockEntryCostDrafts((d) => {
                const next = { ...d };
                delete next[productId];
                return next;
            });
            return;
        }
        setStockEntrySaving(true);
        const ts = new Date().toISOString();
        const { error } = await supabase.from('branch_stocks').upsert(
            {
                branch_id: branchId,
                product_id: productId,
                quantity,
                unit_cost,
                updated_at: ts,
            },
            { onConflict: 'branch_id,product_id' },
        );
        setStockEntrySaving(false);
        if (error) {
            toast.error('Maliyet kaydı hatası: ' + error.message);
            return;
        }
        setBranchStocks((prev) => {
            const rest = prev.filter((r) => !(r.branch_id === branchId && r.product_id === productId));
            return [...rest, { branch_id: branchId, product_id: productId, quantity, unit_cost, updated_at: ts }];
        });
        setStockEntryCostDrafts((d) => {
            const next = { ...d };
            delete next[productId];
            return next;
        });
    };

    const handleRevertApproval = async (countId) => {
        setIsLoading(true);
        const { error: countErr } = await supabase.from('counts').update({ status: 'draft' }).eq('id', countId);
        if (!countErr) {
            toast.success("Onay kaldırıldı! Lütfen düzenlemeleri yapıp tekrar onaylayın.", { style: { background: '#F59E0B', color: '#fff' } });
            fetchData();
        } else {
            toast.error("İşlem Geri Alınamadı!");
        }
        setIsLoading(false);
    };

    const handleDeleteSelected = async () => {
        if (selectedRecords.length === 0) return;
        const confirmDelete = window.confirm(`Seçilen ${selectedRecords.length} adet sayım kaydını silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`);
        if (!confirmDelete) return;

        setIsLoading(true);
        const { error } = await supabase.from('counts').delete().in('id', selectedRecords);
        if (error) {
            toast.error("Silme işlemi başarısız: " + error.message);
        } else {
            toast.success(`${selectedRecords.length} adet kayıt başarıyla silindi!`, { style: { background: '#10B981', color: '#fff' } });
            setSelectedRecords([]);
            fetchData();
        }
        setIsLoading(false);
    };

    const handleBulkSetDraft = async () => {
        if (selectedRecords.length === 0) return;
        const ok = window.confirm(`Seçilen ${selectedRecords.length} adet kaydın onayını kaldırıp taslak (pasif) yapmak istiyor musunuz?`);
        if (!ok) return;
        setIsLoading(true);
        const { error } = await supabase.from('counts').update({ status: 'draft' }).in('id', selectedRecords);
        if (error) {
            toast.error("Toplu pasife alma başarısız: " + error.message);
        } else {
            toast.success(`${selectedRecords.length} adet kayıt taslak durumuna alındı.`, { style: { background: '#FBBF24', color: '#111827' } });
            setSelectedRecords([]);
            fetchData();
        }
        setIsLoading(false);
    };

    // --------------- CALCULATE FINANACIALS ---------------
    const getFilteredCounts = () => {
        let res = counts;
        if (selectedBranchId !== 'ALL') res = res.filter(c => c.branch_id === selectedBranchId);
        if (selectedPeriodId !== 'ALL') res = res.filter(c => c.period_id === selectedPeriodId);
        return res;
    };

    const filteredCounts = getFilteredCounts();

    // Totals Calculation
    let sysValue = 0;
    let actualValue = 0;

    // Top Kayıplar Grafigi icin data
    const productLossesMap = {};

    filteredCounts.forEach(c => {
        const currentSysStock = sysStockForCount(c);
        const price = unitCostForCount(c);

        // Total value calculation
        sysValue += (currentSysStock * price);
        actualValue += (c.counted_stock * price);

        // Chart data aggregation
        const diff = c.counted_stock - currentSysStock;
        const valueDiff = diff * price;

        if (valueDiff < 0) {
            if (!productLossesMap[c.product_id]) {
                productLossesMap[c.product_id] = {
                    name: c.products?.product_name || 'Bilinmiyor',
                    kayipDeger: Math.abs(valueDiff),
                    kayipAdet: Math.abs(diff)
                };
            } else {
                productLossesMap[c.product_id].kayipDeger += Math.abs(valueDiff);
                productLossesMap[c.product_id].kayipAdet += Math.abs(diff);
            }
        }
    });

    const shrinkageValue = actualValue - sysValue;
    const isLoss = shrinkageValue < 0;

    const top10LossProducts = Object.values(productLossesMap)
        .sort((a, b) => b.kayipDeger - a.kayipDeger)
        .slice(0, 10);

    // Branch summaries (sayılan değer TL için branchActualValue eklendi)
    const branchSummaries = branches.map(branch => {
        const branchC = filteredCounts.filter(c => c.branch_id === branch.id);
        let totalC = 0, mis = 0, exc = 0, dV = 0, branchActualVal = 0;

        branchC.forEach(c => {
            totalC++;
            const sys = sysStockForCount(c);
            const price = unitCostForCount(c);
            branchActualVal += (c.counted_stock * price);
            const diff = c.counted_stock - sys;
            if (diff < 0) mis += Math.abs(diff);
            if (diff > 0) exc += diff;
            dV += (diff * price);
        });

        const isDraft = branchC.some(c => c.status === 'draft');
        const isAllApproved = branchC.length > 0 && branchC.every(c => c.status === 'approved');

        return {
            id: branch.id, ...branch,
            totalCounted: totalC, mis, exc, diffValue: dV, branchActualValue: branchActualVal,
            status: isAllApproved ? 'Onaylandı' : (isDraft ? 'Devam Ediyor' : (totalC === 0 ? 'Başlamadı' : 'Onay Bekliyor'))
        };
    });

    // Eksik sayım: aktif dönemde sayıma başlamayan şubeler ve hiç sayılmayan ürünler
    const activePeriod = periods.find(p => p.is_active);
    const countsInActivePeriod = activePeriod ? counts.filter(c => c.period_id === activePeriod.id) : [];
    const branchesWithNoCountInActivePeriod = activePeriod ? branches.filter(b => !countsInActivePeriod.some(c => c.branch_id === b.id)) : [];
    const productIdsCountedInActivePeriod = new Set(countsInActivePeriod.map(c => c.product_id));
    const productsNotCountedInActivePeriod = activePeriod ? products.filter(p => !productIdsCountedInActivePeriod.has(p.id)) : [];

    // --------------- EXPORTS ---------------
    const exportBranchCSV = () => {
        const data = [
            ["�?ube Adı", "Durum", "Sayılan Çeşit", "Eksik Ürün Adedi", "Fazla Ürün Adedi", "Finansal Fark (TL)"]
        ];

        branchSummaries.forEach(b => {
            data.push([
                b.branch_name,
                b.status,
                b.totalCounted,
                b.mis,
                b.exc,
                b.diffValue
            ]);
        });

        const ws = XLSX.utils.aoa_to_sheet(data);
        ws['!cols'] = [
            { wch: 30 }, // �?ube adı
            { wch: 20 }, // Durumu
            { wch: 15 }, // Sayılan çeşit
            { wch: 18 }, // Eksik ürün
            { wch: 18 }, // Fazla ürün
            { wch: 20 }  // Finansal fark
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "�?ube Özet Tablosu");
        XLSX.writeFile(wb, `izbel_sube_ozet_${new Date().toISOString().split('T')[0]}.xlsx`);
    };

    const exportProductCSV = (customCategories = null, firstPeriodModeArg = false) => {
        void (async () => {
            const branchFilter = selectedBranchId !== 'ALL' ? selectedBranchId : null;
            const asOf = new Date().toISOString().split('T')[0];
            const brPart =
                selectedBranchId !== 'ALL'
                    ? `_${(branches.find((b) => b.id === selectedBranchId)?.branch_name || 'sube').replace(/\s+/g, '_')}`
                    : '';

            // 1) Reçete tüketim haritası + detay (mamul -> satılan adet, mamul+malzeme -> tüketim)
            const consumptionByKey = new Map(); // branch|ingredient -> qty
            const recipeSoldByKey = new Map(); // branch|recipeProduct -> sold qty
            const recipeUseDetail = []; // {branchId, recipePid, ingredientPid, coef, useQty, soldQty}

            Object.keys(salesQtyByKey).forEach((k) => {
                const [bid, soldPid] = k.split('|');
                if (branchFilter && bid !== branchFilter) return;
                const sold = Number(salesQtyByKey[k]);
                if (!Number.isFinite(sold) || sold === 0) return;

                const recipePid = resolveRecipeProductIdForSaleProduct(soldPid);
                if (!recipePid) return;

                const soldKey = `${bid}|${recipePid}`;
                recipeSoldByKey.set(soldKey, (recipeSoldByKey.get(soldKey) || 0) + sold);

                const rows = recipeByProductId.get(recipePid) || [];
                if (!rows.length) {
                    const ck = `${bid}|${recipePid}`;
                    consumptionByKey.set(ck, (consumptionByKey.get(ck) || 0) + sold);
                    recipeUseDetail.push({
                        branchId: bid,
                        recipePid,
                        ingredientPid: recipePid,
                        coef: 1,
                        soldQty: sold,
                        useQty: sold,
                    });
                    return;
                }

                rows.forEach((ri) => {
                    const coef = Number(ri.quantity_per_recipe) || 0;
                    if (!Number.isFinite(coef) || coef === 0) return;
                    const useQty = sold * coef;
                    if (!Number.isFinite(useQty) || useQty === 0) return;
                    const ck = `${bid}|${ri.ingredient_product_id}`;
                    consumptionByKey.set(ck, (consumptionByKey.get(ck) || 0) + useQty);
                    recipeUseDetail.push({
                        branchId: bid,
                        recipePid,
                        ingredientPid: ri.ingredient_product_id,
                        coef,
                        soldQty: sold,
                        useQty,
                    });
                });
            });

            // 2) Yardımcı: stok snapshot (açılış + tedarik - tüketim)
            const getSnapshot = (branchId, productId) => {
                const key = `${branchId}|${productId}`;
                const purchaseNum = Number(manualPurchaseByKey[key] || 0) || 0;
                const consumptionNum = Number(consumptionByKey.get(key) || 0) || 0;
                const p = products.find((x) => String(x.id) === String(productId));
                const currentProductStock = Number(p?.current_stock) || 0;
                const currentSys = branchStockMap.has(key) ? Number(branchStockMap.get(key)) || 0 : currentProductStock;
                const opening = currentSys - purchaseNum + consumptionNum;
                return { key, purchaseNum, consumptionNum, opening, currentSys };
            };

            // 3) Mutabakat satırları: sayılanlar + reçeteden/tedarikten etkilenen ek ürünler
            const countedKeySet = new Set();
            const mutRows = []; // {branchId, periodId, productId, counted, status}
            filteredCounts.forEach((c) => {
                if (branchFilter && String(c.branch_id) !== String(branchFilter)) return;
                const k = `${c.branch_id}|${c.product_id}`;
                countedKeySet.add(k);
                mutRows.push({
                    branchId: c.branch_id,
                    periodId: c.period_id,
                    productId: c.product_id,
                    counted: Number(c.counted_stock),
                    status: c.status,
                });
            });

            const extraKeySet = new Set();
            consumptionByKey.forEach((_, k) => { if (!countedKeySet.has(k)) extraKeySet.add(k); });
            Object.keys(manualPurchaseByKey).forEach((k) => { if (!countedKeySet.has(k)) extraKeySet.add(k); });

            extraKeySet.forEach((k) => {
                const [bid, pid] = k.split('|');
                if (branchFilter && bid !== branchFilter) return;
                const ap = periods.find((p) => p.is_active);
                mutRows.push({
                    branchId: bid,
                    periodId: ap?.id || null,
                    productId: pid,
                    counted: null,
                    status: 'not_counted',
                });
            });

            // Maliyet kontrolü: maliyeti 0 olan ürünleri uyar
            const zeroCostProducts = [];
            mutRows.forEach((r) => {
                const p = products.find((x) => String(x.id) === String(r.productId));
                const cost = unitCostForBranchProduct(r.branchId, p);
                if ((!cost || cost === 0) && (consumptionByKey.get(r.branchId + '|' + r.productId) || 0) > 0) {
                    zeroCostProducts.push(p?.product_name || r.productId);
                }
            });
            if (zeroCostProducts.length > 0) {
                const maxShow = 10;
                const listText = zeroCostProducts.slice(0, maxShow).join('\n  - ');
                const more = zeroCostProducts.length > maxShow ? '\n  ... ve ' + (zeroCostProducts.length - maxShow) + ' ürün daha' : '';
                const proceed = window.confirm(
                    'Dikkat: Aşağıdaki ' + zeroCostProducts.length + ' üründe birim maliyet 0 TL:\n\n  - ' + listText + more + '\n\nMaliyetleri girmeden devam etmek istiyor musunuz?'
                );
                if (!proceed) {
                    toast.info('İndirme iptal edildi. Lütfen önce maliyetleri girin.');
                    return;
                }
            }

            // 4) Workbook
            const workbook = new ExcelJS.Workbook();
            workbook.creator = 'İzbel Stok Sayım';
            workbook.created = new Date();

            const thinBorder = EXCEL_THIN_BORDER;
            const makeSheet = (name, headers, widths) => {
                const ws = workbook.addWorksheet(name);
                ws.addRow(headers);
                ws.getRow(1).height = 24;
                ws.getRow(1).eachCell((cell) => {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
                    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10, name: 'Arial' };
                    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
                    cell.border = thinBorder;
                });
                ws.columns = widths.map((w) => ({ width: w }));
                ws.views = [{ state: 'frozen', ySplit: 1 }];
                return ws;
            };

            // 4.1 Mutabakat (formüllü) — kategori bazlı çoklu sayfa desteği
            const mutHeaders = [
                'Şube',
                'Sayım Dönemi',
                'Stok Kodu',
                'Ürün Adı',
                'Açılış Stok',
                'Tedarik (Manuel)',
                'Reçete Tüketimi',
                'Teorik Kalan',
                'Sayılan Stok',
                'Fark (Sayılan-Teorik)',
                'Birim Maliyet (TL)',
                'Toplam Fark TL',
                'Durum',
            ];
            const mutWidths = [16, 20, 14, 42, 14, 16, 16, 14, 14, 18, 16, 16, 18];

// Mükerrer ürün kaldırma: aynı şube+ürün varsa reçete tüketimi olanı tut
            const mutRowDedup = new Map();
            mutRows.forEach((r) => {
                const dk = r.branchId + '|' + r.productId;
                const existing = mutRowDedup.get(dk);
                if (!existing) { mutRowDedup.set(dk, r); return; }
                const hasCons = (consumptionByKey.get(dk) || 0) > 0;
                if (hasCons && existing.counted == null && r.counted != null) mutRowDedup.set(dk, r);
                if (!hasCons && r.counted != null && existing.counted == null) mutRowDedup.set(dk, r);
            });
            mutRows.length = 0;
            mutRowDedup.forEach((v) => mutRows.push(v));

            // stable siralama (şube + ürün)
            mutRows.sort((a, b) => {
                const ab = branches.find((x) => x.id === a.branchId)?.branch_name || String(a.branchId);
                const bb = branches.find((x) => x.id === b.branchId)?.branch_name || String(b.branchId);
                if (ab !== bb) return ab.localeCompare(bb, 'tr');
                const pa = products.find((x) => String(x.id) === String(a.productId));
                const pb = products.find((x) => String(x.id) === String(b.productId));
                return `${pa?.product_name || ''}`.localeCompare(`${pb?.product_name || ''}`, 'tr');
            });

            
            const renderMutabakatSheet = (sheetName, rowsToRender) => {
                if (!rowsToRender || !rowsToRender.length) return;
                const wsMut = makeSheet(sheetName, mutHeaders, mutWidths);
                const mutStartRow = 2;
                rowsToRender.forEach((r, idx) => {
                    const rowIndex = mutStartRow + idx;
                    const p = products.find((x) => String(x.id) === String(r.productId));
                    const bn = branches.find((x) => x.id === r.branchId)?.branch_name || String(r.branchId);
                    const periodName = periods.find((p0) => p0.id === r.periodId)?.period_name || (periods.find((p0) => p0.is_active)?.period_name || 'Dönemsiz');
                    const snap = getSnapshot(r.branchId, r.productId);
    
                    const unitCost = unitCostForBranchProduct(r.branchId, p);
                    const statusText = r.status === 'approved' ? 'Onaylandı' : r.status === 'not_counted' ? 'Sayılmadı (reçete/tedarik)' : 'Bekliyor';
    
                    const excelRow = wsMut.getRow(rowIndex);
                    excelRow.getCell(1).value = bn;
                    excelRow.getCell(2).value = periodName;
                    excelRow.getCell(3).value = p?.stok_kodu || '';
                    excelRow.getCell(4).value = p?.product_name || '(ürün bulunamadı)';
                    excelRow.getCell(5).value = snap.opening;
                    excelRow.getCell(6).value = snap.purchaseNum;
                    excelRow.getCell(7).value = snap.consumptionNum;
                    excelRow.getCell(8).value = { formula: `E${rowIndex}+F${rowIndex}-G${rowIndex}` };
                    excelRow.getCell(9).value = r.counted != null && Number.isFinite(r.counted) ? r.counted : 0;
                    excelRow.getCell(10).value = r.counted != null && Number.isFinite(r.counted) ? { formula: `I${rowIndex}-H${rowIndex}` } : { formula: `0-H${rowIndex}` };
                    excelRow.getCell(11).value = unitCost || 0;
                    excelRow.getCell(12).value =
                        { formula: `J${rowIndex}*K${rowIndex}` };
                    excelRow.getCell(13).value = statusText;
    
                    for (let c = 1; c <= 13; c++) {
                        const cell = excelRow.getCell(c);
                        cell.border = thinBorder;
                        cell.font = { name: 'Arial', size: 10, color: { argb: 'FF0F172A' } };
                        cell.alignment = { vertical: 'middle', horizontal: [5, 6, 7, 8, 9, 10, 11, 12].includes(c) ? 'right' : 'left' };
                        if ([5, 6, 7, 8, 9, 10].includes(c)) cell.numFmt = '#,##0.00';
                        if ([11, 12].includes(c)) cell.numFmt = '#,##0.00';
                    }
                });
                const mutLastRow = mutStartRow + rowsToRender.length - 1;
                const mutTotalRow = wsMut.getRow(mutLastRow + 1);
                mutTotalRow.getCell(1).value = 'TOPLAM';
                mutTotalRow.getCell(12).value = rowsToRender.length ? { formula: `SUM(L${mutStartRow}:L${mutLastRow})` } : 0;
                mutTotalRow.getCell(12).numFmt = '#,##0.00';
                for (let c = 1; c <= 13; c++) {
                    const cell = mutTotalRow.getCell(c);
                    cell.border = thinBorder;
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
                    cell.font = { ...(cell.font || {}), bold: true, name: 'Arial' };
                }
    
                // Mutabakat: filtre + zebra + pozitif/negatif renklendirme (kâr/zarar)
                wsMut.autoFilter = 'A1:M1';
                const mutZebraFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
                for (let r = mutStartRow; r <= mutLastRow; r++) {
                    if (r % 2 === 0) {
                        const row = wsMut.getRow(r);
                        for (let c = 1; c <= 13; c++) {
                            // Sonuç kolonları (Fark / TL) koşullu biçimlendirme ile boyanacak
                            if (c === 10 || c === 12) continue;
                            row.getCell(c).fill = mutZebraFill;
                        }
                    }
                }
                if (typeof wsMut.addConditionalFormatting === 'function' && rowsToRender.length) {
                    // Fark (J) ve Toplam Fark TL (L): Negatif=kırmızı, Pozitif=yeşil
                    wsMut.addConditionalFormatting({
                        ref: `J${mutStartRow}:J${mutLastRow}`,
                        rules: [
                            {
                                type: 'expression',
                                formulae: [`J${mutStartRow}<0`],
                                style: {
                                    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE4E6' } },
                                    font: { color: { argb: 'FFB91C1C' }, bold: true },
                                },
                            },
                            {
                                type: 'expression',
                                formulae: [`J${mutStartRow}>0`],
                                style: {
                                    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } },
                                    font: { color: { argb: 'FF15803D' }, bold: true },
                                },
                            },
                        ],
                    });
                    wsMut.addConditionalFormatting({
                        ref: `L${mutStartRow}:L${mutLastRow + 1}`,
                        rules: [
                            {
                                type: 'expression',
                                formulae: [`L${mutStartRow}<0`],
                                style: {
                                    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE4E6' } },
                                    font: { color: { argb: 'FF9F1239' }, bold: true },
                                },
                            },
                            {
                                type: 'expression',
                                formulae: [`L${mutStartRow}>0`],
                                style: {
                                    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } },
                                    font: { color: { argb: 'FF166534' }, bold: true },
                                },
                            },
                        ],
                    });
                }
    
    
            };

            // ====== İLK SAYIM (Başlangıç Envanteri) RENDERER ======
            const firstHeaders = [
                'Şube',
                'Sayım Dönemi',
                'Stok Kodu',
                'Ürün Adı',
                'Tedarik (Manuel)',
                'Reçete Tüketimi',
                'Sayılan',
                'İmpliye Açılış',
                'Birim Maliyet (TL)',
                'Stok Değeri TL',
                'Durum',
            ];
            const firstWidths = [16, 18, 14, 42, 16, 16, 14, 18, 16, 18, 22];

            const renderFirstPeriodSheet = (sheetName, rowsToRender) => {
                if (!rowsToRender || !rowsToRender.length) return;
                const wsF = makeSheet(sheetName, firstHeaders, firstWidths);
                const startRow = 2;
                rowsToRender.forEach((r, idx) => {
                    const rowIndex = startRow + idx;
                    const p = products.find((x) => String(x.id) === String(r.productId));
                    const bn = branches.find((x) => x.id === r.branchId)?.branch_name || String(r.branchId);
                    const periodName = periods.find((p0) => p0.id === r.periodId)?.period_name || (periods.find((p0) => p0.is_active)?.period_name || 'Dönemsiz');
                    const snap = getSnapshot(r.branchId, r.productId);
                    const unitCost = unitCostForBranchProduct(r.branchId, p);
                    const countedVal = r.counted != null && Number.isFinite(r.counted) ? r.counted : 0;

                    const row = wsF.getRow(rowIndex);
                    row.getCell(1).value = bn;
                    row.getCell(2).value = periodName;
                    row.getCell(3).value = p?.stok_kodu || '';
                    row.getCell(4).value = p?.product_name || '(ürün bulunamadı)';
                    row.getCell(5).value = snap.purchaseNum;
                    row.getCell(6).value = snap.consumptionNum;
                    row.getCell(7).value = countedVal;
                    // İmpliye Açılış = Sayılan (G) + Reçete Tüketimi (F) − Tedarik (E)
                    row.getCell(8).value = { formula: `G${rowIndex}+F${rowIndex}-E${rowIndex}` };
                    row.getCell(9).value = unitCost || 0;
                    // Stok Değeri TL = Sayılan × Birim Maliyet
                    row.getCell(10).value = { formula: `G${rowIndex}*I${rowIndex}` };
                    // Durum: formül ile metin üret
                    row.getCell(11).value = {
                        formula: `IF(H${rowIndex}<0,"Anomali - Negatif",IF(H${rowIndex}=0,"Tam Tutarlı",IF(H${rowIndex}>(E${rowIndex}+F${rowIndex})*3,"Yüksek Devir Şüphesi","Tutarlı")))`,
                    };

                    for (let c = 1; c <= 11; c++) {
                        const cell = row.getCell(c);
                        cell.border = thinBorder;
                        cell.font = { name: 'Arial', size: 10, color: { argb: 'FF0F172A' } };
                        cell.alignment = { vertical: 'middle', horizontal: [5, 6, 7, 8, 9, 10].includes(c) ? 'right' : 'left' };
                        if ([5, 6, 7, 8, 9, 10].includes(c)) cell.numFmt = '#,##0.00';
                    }
                });
                const lastRow = startRow + rowsToRender.length - 1;
                const totalRow = wsF.getRow(lastRow + 1);
                totalRow.getCell(1).value = 'TOPLAM';
                totalRow.getCell(5).value = rowsToRender.length ? { formula: `SUM(E${startRow}:E${lastRow})` } : 0;
                totalRow.getCell(6).value = rowsToRender.length ? { formula: `SUM(F${startRow}:F${lastRow})` } : 0;
                totalRow.getCell(7).value = rowsToRender.length ? { formula: `SUM(G${startRow}:G${lastRow})` } : 0;
                totalRow.getCell(8).value = rowsToRender.length ? { formula: `SUM(H${startRow}:H${lastRow})` } : 0;
                totalRow.getCell(10).value = rowsToRender.length ? { formula: `SUM(J${startRow}:J${lastRow})` } : 0;
                [5, 6, 7, 8, 10].forEach((c) => { totalRow.getCell(c).numFmt = '#,##0.00'; });
                for (let c = 1; c <= 11; c++) {
                    const cell = totalRow.getCell(c);
                    cell.border = thinBorder;
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
                    cell.font = { ...(cell.font || {}), bold: true, name: 'Arial', color: { argb: 'FF78350F' } };
                }

                wsF.autoFilter = 'A1:K1';
                // Zebra
                const zebraFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
                for (let r = startRow; r <= lastRow; r++) {
                    if (r % 2 === 0) {
                        const row = wsF.getRow(r);
                        for (let c = 1; c <= 11; c++) {
                            if (c === 8 || c === 11) continue; // durum ve impliye açılış koşullu formatlı
                            row.getCell(c).fill = zebraFill;
                        }
                    }
                }

                if (typeof wsF.addConditionalFormatting === 'function' && rowsToRender.length) {
                    // İmpliye Açılış (H): negatif = kırmızı, >3×(E+F) = sarı, >=0 = yeşil
                    wsF.addConditionalFormatting({
                        ref: `H${startRow}:H${lastRow}`,
                        rules: [
                            {
                                type: 'expression',
                                formulae: [`H${startRow}<0`],
                                style: {
                                    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE4E6' } },
                                    font: { color: { argb: 'FFB91C1C' }, bold: true },
                                },
                            },
                            {
                                type: 'expression',
                                formulae: [`H${startRow}>(E${startRow}+F${startRow})*3`],
                                style: {
                                    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } },
                                    font: { color: { argb: 'FFB45309' }, bold: true },
                                },
                            },
                            {
                                type: 'expression',
                                formulae: [`H${startRow}>=0`],
                                style: {
                                    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } },
                                    font: { color: { argb: 'FF166534' }, bold: true },
                                },
                            },
                        ],
                    });
                    // Durum (K): metne göre renklendir
                    wsF.addConditionalFormatting({
                        ref: `K${startRow}:K${lastRow}`,
                        rules: [
                            {
                                type: 'containsText',
                                operator: 'containsText',
                                text: 'Anomali',
                                style: {
                                    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE4E6' } },
                                    font: { color: { argb: 'FFB91C1C' }, bold: true },
                                },
                            },
                            {
                                type: 'containsText',
                                operator: 'containsText',
                                text: 'Yüksek Devir',
                                style: {
                                    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } },
                                    font: { color: { argb: 'FFB45309' }, bold: true },
                                },
                            },
                            {
                                type: 'containsText',
                                operator: 'containsText',
                                text: 'Tutarlı',
                                style: {
                                    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } },
                                    font: { color: { argb: 'FF166534' }, bold: true },
                                },
                            },
                        ],
                    });
                }
            };

            // ====== ANOMALİ TESPİT RENDERER ======
            const renderAnomalySheet = (allRows) => {
                const wsA = makeSheet(
                    'Anomali Tespit',
                    ['Şube', 'Stok Kodu', 'Ürün Adı', 'Tedarik', 'Reçete Tüketimi', 'Sayılan', 'İmpliye Açılış', 'Anomali Tipi', 'Olası Sebep', 'Öncelik TL'],
                    [16, 14, 42, 14, 16, 14, 16, 18, 50, 16],
                );
                // Önceden JS tarafında hesapla ve filtrele
                const anomalies = [];
                allRows.forEach((r) => {
                    const p = products.find((x) => String(x.id) === String(r.productId));
                    const bn = branches.find((x) => x.id === r.branchId)?.branch_name || String(r.branchId);
                    const snap = getSnapshot(r.branchId, r.productId);
                    const counted = r.counted != null && Number.isFinite(r.counted) ? r.counted : 0;
                    const impliye = counted + snap.consumptionNum - snap.purchaseNum;
                    const threshold = (snap.purchaseNum + snap.consumptionNum) * 3;
                    const unitCost = unitCostForBranchProduct(r.branchId, p) || 0;
                    let tip = null;
                    let sebep = '';
                    if (impliye < 0) {
                        tip = 'Negatif';
                        sebep = 'Reçete miktarı fazla yazılmış olabilir VEYA tedarik kaydı eksik VEYA sayım eksik yapılmış olabilir.';
                    } else if (threshold > 0 && impliye > threshold) {
                        tip = 'Yüksek Devir';
                        sebep = 'Sayım öncesi kayıtsız stok büyük olabilir VEYA reçete az hesaplanıyor VEYA tedarik fazla kayıtlı.';
                    }
                    if (!tip) return;
                    anomalies.push({
                        branchName: bn,
                        stokKodu: p?.stok_kodu || '',
                        productName: p?.product_name || '(ürün bulunamadı)',
                        purchase: snap.purchaseNum,
                        consumption: snap.consumptionNum,
                        counted,
                        impliye,
                        tip,
                        sebep,
                        priority: Math.abs(impliye) * unitCost,
                    });
                });
                anomalies.sort((a, b) => b.priority - a.priority);

                if (anomalies.length === 0) {
                    const row = wsA.getRow(2);
                    row.getCell(1).value = 'Hiç anomali tespit edilmedi — reçete, tedarik ve sayım verileri tutarlı görünüyor.';
                    wsA.mergeCells(`A2:J2`);
                    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
                    row.getCell(1).font = { bold: true, color: { argb: 'FF166534' }, name: 'Arial' };
                    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
                    row.height = 40;
                    return;
                }

                const startRow = 2;
                anomalies.forEach((a, idx) => {
                    const rowIndex = startRow + idx;
                    const row = wsA.getRow(rowIndex);
                    row.getCell(1).value = a.branchName;
                    row.getCell(2).value = a.stokKodu;
                    row.getCell(3).value = a.productName;
                    row.getCell(4).value = a.purchase;
                    row.getCell(5).value = a.consumption;
                    row.getCell(6).value = a.counted;
                    row.getCell(7).value = a.impliye;
                    row.getCell(8).value = a.tip;
                    row.getCell(9).value = a.sebep;
                    row.getCell(10).value = a.priority;

                    for (let c = 1; c <= 10; c++) {
                        const cell = row.getCell(c);
                        cell.border = thinBorder;
                        cell.font = { name: 'Arial', size: 10, color: { argb: 'FF0F172A' } };
                        cell.alignment = { vertical: 'middle', horizontal: [4, 5, 6, 7, 10].includes(c) ? 'right' : 'left', wrapText: c === 9 };
                        if ([4, 5, 6, 7, 10].includes(c)) cell.numFmt = '#,##0.00';
                    }

                    // Tip renklendirmesi
                    const tipCell = row.getCell(8);
                    if (a.tip === 'Negatif') {
                        tipCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE4E6' } };
                        tipCell.font = { color: { argb: 'FFB91C1C' }, bold: true, name: 'Arial' };
                    } else if (a.tip === 'Yüksek Devir') {
                        tipCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
                        tipCell.font = { color: { argb: 'FFB45309' }, bold: true, name: 'Arial' };
                    }

                    const impliyeCell = row.getCell(7);
                    if (a.impliye < 0) {
                        impliyeCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE4E6' } };
                        impliyeCell.font = { color: { argb: 'FFB91C1C' }, bold: true, name: 'Arial' };
                    } else {
                        impliyeCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
                        impliyeCell.font = { color: { argb: 'FFB45309' }, bold: true, name: 'Arial' };
                    }
                });
                wsA.autoFilter = `A1:J1`;
            };

            // ====== ANA AKIŞ: Kategori × İlk Sayım matrisi ======
            const renderer = firstPeriodModeArg ? renderFirstPeriodSheet : renderMutabakatSheet;
            const defaultSheetName = firstPeriodModeArg ? 'Başlangıç Envanteri' : 'Mutabakat';
            const otherSheetName = firstPeriodModeArg ? 'Diğer (Başlangıç)' : 'Diğer (Kategorisiz)';

            if (customCategories && Array.isArray(customCategories) && customCategories.length > 0) {
                const usedKeys = new Set();
                customCategories.forEach((cat) => {
                    if (!cat || !cat.name) return;
                    const prodSet = new Set((cat.productIds || []).map(String));
                    const subset = mutRows.filter((r) => {
                        if (!prodSet.has(String(r.productId))) return false;
                        usedKeys.add(r.branchId + '|' + r.productId);
                        return true;
                    });
                    if (subset.length) renderer(cat.name.slice(0, 31), subset);
                });
                const leftovers = mutRows.filter((r) => !usedKeys.has(r.branchId + '|' + r.productId));
                if (leftovers.length) renderer(otherSheetName, leftovers);
            } else {
                renderer(defaultSheetName, mutRows);
            }

            // İlk sayım modundaysa ek olarak Anomali Tespit sayfası üret
            if (firstPeriodModeArg) {
                renderAnomalySheet(mutRows);
            }

            // 4.2 Satış Raporu (ayrı sayfa)
            const wsSales = makeSheet(
                'Satış Raporu',
                ['Şube', 'Stok Kodu', 'Ürün Adı', 'Satış (Adet)'],
                [16, 14, 46, 16],
            );
            const salesKeys = Object.keys(salesQtyByKey)
                .filter((k) => (!branchFilter ? true : k.startsWith(`${branchFilter}|`)))
                .sort((a, b) => a.localeCompare(b, 'tr'));
            salesKeys.forEach((k, i) => {
                const [bid, pid] = k.split('|');
                const bn = branches.find((x) => x.id === bid)?.branch_name || bid;
                const p = products.find((x) => String(x.id) === String(pid));
                const qty = Number(salesQtyByKey[k]) || 0;
                const rowIndex = 2 + i;
                const row = wsSales.getRow(rowIndex);
                row.getCell(1).value = bn;
                row.getCell(2).value = p?.stok_kodu || '';
                row.getCell(3).value = p?.product_name || '(ürün bulunamadı)';
                row.getCell(4).value = qty;
                for (let c = 1; c <= 4; c++) {
                    const cell = row.getCell(c);
                    cell.border = thinBorder;
                    cell.font = { name: 'Arial', size: 10, color: { argb: 'FF0F172A' } };
                    cell.alignment = { vertical: 'middle', horizontal: c === 4 ? 'right' : 'left' };
                    if (c === 4) cell.numFmt = '#,##0.00';
                }
            });
            const salesTotalRow = wsSales.getRow(2 + salesKeys.length);
            salesTotalRow.getCell(3).value = 'TOPLAM';
            salesTotalRow.getCell(4).value = salesKeys.length ? { formula: `SUM(D2:D${1 + salesKeys.length})` } : 0;
            salesTotalRow.getCell(4).numFmt = '#,##0.00';
            salesTotalRow.eachCell((cell) => {
                cell.border = thinBorder;
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
                cell.font = { ...(cell.font || {}), bold: true, name: 'Arial' };
            });

            // 4.3 Hammaddeler (malzeme bazlı)
            const wsIng = makeSheet(
                'Hammaddeler',
                ['Şube', 'Stok Kodu', 'Malzeme Adı', 'Açılış Stok', 'Tedarik (Manuel)', 'Reçete Tüketimi', 'Teorik Kalan'],
                [16, 14, 46, 14, 16, 16, 14],
            );
            const ingKeys = Array.from(consumptionByKey.keys())
                .concat(Object.keys(manualPurchaseByKey))
                .filter((k) => (!branchFilter ? true : k.startsWith(`${branchFilter}|`)));
            const ingKeySet = new Set(ingKeys);
            const ingList = Array.from(ingKeySet).sort((a, b) => a.localeCompare(b, 'tr'));
            ingList.forEach((k, i) => {
                const [bid, pid] = k.split('|');
                const bn = branches.find((x) => x.id === bid)?.branch_name || bid;
                const p = products.find((x) => String(x.id) === String(pid));
                const snap = getSnapshot(bid, pid);
                const rowIndex = 2 + i;
                const row = wsIng.getRow(rowIndex);
                row.getCell(1).value = bn;
                row.getCell(2).value = p?.stok_kodu || '';
                row.getCell(3).value = p?.product_name || '(ürün bulunamadı)';
                row.getCell(4).value = snap.opening;
                row.getCell(5).value = snap.purchaseNum;
                row.getCell(6).value = snap.consumptionNum;
                row.getCell(7).value = { formula: `D${rowIndex}+E${rowIndex}-F${rowIndex}` };

                for (let c = 1; c <= 7; c++) {
                    const cell = row.getCell(c);
                    cell.border = thinBorder;
                    cell.font = { name: 'Arial', size: 10, color: { argb: 'FF0F172A' } };
                    cell.alignment = { vertical: 'middle', horizontal: [4, 5, 6, 7].includes(c) ? 'right' : 'left' };
                    if ([4, 5, 6, 7].includes(c)) cell.numFmt = '#,##0.00';
                }
            });
            const ingTotalRow = wsIng.getRow(2 + ingList.length);
            ingTotalRow.getCell(3).value = 'TOPLAM';
            ingTotalRow.getCell(5).value = ingList.length ? { formula: `SUM(E2:E${1 + ingList.length})` } : 0;
            ingTotalRow.getCell(6).value = ingList.length ? { formula: `SUM(F2:F${1 + ingList.length})` } : 0;
            ingTotalRow.getCell(7).value = ingList.length ? { formula: `SUM(G2:G${1 + ingList.length})` } : 0;
            [5, 6, 7].forEach((c) => (ingTotalRow.getCell(c).numFmt = '#,##0.00'));
            ingTotalRow.eachCell((cell) => {
                cell.border = thinBorder;
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
                cell.font = { ...(cell.font || {}), bold: true, name: 'Arial' };
            });

            // 4.4 Reçete tüketim detay
            const wsDet = makeSheet(
                'Reçete Tüketim Detay',
                ['Şube', 'Mamul Stok Kodu', 'Mamul Adı', 'Satış (Adet)', 'Malzeme Stok Kodu', 'Malzeme Adı', 'Reçete Katsayı', 'Tüketim'],
                [16, 14, 40, 14, 16, 40, 14, 14],
            );
            const detailRows = recipeUseDetail
                .filter((r) => (!branchFilter ? true : String(r.branchId) === String(branchFilter)))
                .sort((a, b) => {
                    const ak = `${a.branchId}|${a.recipePid}|${a.ingredientPid}`;
                    const bk = `${b.branchId}|${b.recipePid}|${b.ingredientPid}`;
                    return ak.localeCompare(bk, 'tr');
                });
            detailRows.forEach((d, i) => {
                const bn = branches.find((x) => x.id === d.branchId)?.branch_name || String(d.branchId);
                const rp = products.find((x) => String(x.id) === String(d.recipePid));
                const ing = products.find((x) => String(x.id) === String(d.ingredientPid));
                const rowIndex = 2 + i;
                const row = wsDet.getRow(rowIndex);
                row.getCell(1).value = bn;
                row.getCell(2).value = rp?.stok_kodu || '';
                row.getCell(3).value = rp?.product_name || '(ürün bulunamadı)';
                row.getCell(4).value = d.soldQty;
                row.getCell(5).value = ing?.stok_kodu || '';
                row.getCell(6).value = ing?.product_name || '(ürün bulunamadı)';
                row.getCell(7).value = d.coef;
                row.getCell(8).value = d.useQty;
                for (let c = 1; c <= 8; c++) {
                    const cell = row.getCell(c);
                    cell.border = thinBorder;
                    cell.font = { name: 'Arial', size: 10, color: { argb: 'FF0F172A' } };
                    cell.alignment = { vertical: 'middle', horizontal: [4, 7, 8].includes(c) ? 'right' : 'left' };
                    if ([4, 7, 8].includes(c)) cell.numFmt = '#,##0.00';
                }
            });

            const buf = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `izbel_urun_raporu${brPart}_${asOf}.xlsx`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success('Excel (sayfalar ayrılmış + formüllü) oluşturuldu.');
        })().catch((e) => {
            console.error(e);
            toast.error('Excel oluşturulamadı: ' + (e?.message || String(e)));
        });
    };

    const exportMissingRecipeTemplateXlsx = (selectedSaleIds = null) => {
        if (selectedBranchId === 'ALL') {
            toast.error('Önce şube seçin; eksik reçete listesi şube satışına göre üretilir.');
            return;
        }

        const selectedSet = selectedSaleIds && selectedSaleIds.length ? new Set(selectedSaleIds) : null;
        const productById = new Map(products.map((x) => [x.id, x]));
        const sourceRows = (salesRecipeAllForBranch || []).filter((r) => !selectedSet || selectedSet.has(r.sale_product_id));

        const missingByTarget = new Map();
        sourceRows.forEach((r) => {
            const key = r.resolved_product_id || r.target_product_id || r.sale_product_id;
            if (!key) return;
            if (missingByTarget.has(key)) return;
            const target = productById.get(key);
            missingByTarget.set(key, {
                target_product_id: key,
                target_stok_kodu: target?.stok_kodu || r.target_stok_kodu || r.sale_stok_kodu || '',
                target_product_name: target?.product_name || r.target_product_name || r.sale_product_name || '(ürün bulunamadı)',
                sale_examples: [
                    `${r.sale_stok_kodu || '—'} · ${r.sale_product_name || ''} · ${r.sold_qty || 0}`,
                ],
            });
        });

        const missingList = Array.from(missingByTarget.values()).sort((a, b) =>
            `${a.target_product_name || ''} ${a.target_stok_kodu || ''}`.localeCompare(
                `${b.target_product_name || ''} ${b.target_stok_kodu || ''}`,
                'tr',
            ),
        );

        if (missingList.length === 0) {
            toast.error('Şablon için ürün bulunamadı. Önce listeden ürün seçin.');
            return;
        }

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'İzbel Stok Sayım';
        workbook.created = new Date();

        const ws = workbook.addWorksheet('Personel Reçete Formu');
        ws.columns = [
            { width: 24 }, // Malzeme stok kodu
            { width: 38 }, // Malzeme adı
            { width: 14 }, // Miktar
            { width: 18 }, // Birim
            { width: 36 }, // Not
        ];

        const titleCell = ws.getCell('A1');
        ws.mergeCells('A1:E1');
        titleCell.value = 'Eksik Reçete Doldurma Formu';
        titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
        titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
        titleCell.alignment = { vertical: 'middle', horizontal: 'left' };

        const branchName = branches.find((b) => b.id === selectedBranchId)?.branch_name || selectedBranchId;
        const info = ws.getCell('A2');
        ws.mergeCells('A2:E2');
        info.value = `Şube: ${branchName} | Bu form personel tarafından doldurulur. Sonra Receteler.csv formatına işlenir.`;
        info.font = { size: 10, color: { argb: 'FF334155' } };
        info.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };

        const hdrRowNo = 4;
        ['Malzeme Stok Kodu', 'Malzeme Adı', 'Miktar', 'Birim (gr/adet/ml)', 'Not'].forEach((h, i) => {
            const c = ws.getRow(hdrRowNo).getCell(i + 1);
            c.value = h;
            c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
            c.border = EXCEL_THIN_BORDER;
            c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        });

        let r = 5;
        missingList.forEach((m, idx) => {
            const head = ws.getCell(`A${r}`);
            ws.mergeCells(`A${r}:E${r}`);
            head.value = `ANA BAŞLIK: ${m.target_product_name} (${m.target_stok_kodu || 'STOK KODU YOK'})`;
            head.font = { bold: true, size: 12, color: { argb: 'FF7C2D12' } };
            head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEDD5' } };
            head.border = EXCEL_THIN_BORDER;
            head.alignment = { vertical: 'middle', horizontal: 'left' };
            ws.getRow(r).height = 24;
            r += 1;

            const ex = ws.getCell(`A${r}`);
            ws.mergeCells(`A${r}:E${r}`);
            ex.value = `Satış örneği: ${m.sale_examples[0] || '-'}`;
            ex.font = { size: 10, color: { argb: 'FF475569' } };
            ex.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
            r += 1;

            for (let i = 0; i < 4; i += 1) {
                for (let c = 1; c <= 5; c += 1) {
                    const cell = ws.getRow(r).getCell(c);
                    cell.value = '';
                    cell.border = EXCEL_THIN_BORDER;
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC' } };
                    cell.alignment = { vertical: 'middle', horizontal: 'left' };
                }
                ws.getRow(r).height = 22;
                r += 1;
            }

            if (idx < missingList.length - 1) {
                r += 1;
            }
        });

        const ws2 = workbook.addWorksheet('Sisteme Aktarım Şablonu');
        ws2.columns = [{ width: 12 }, { width: 16 }, { width: 34 }, { width: 16 }, { width: 34 }, { width: 12 }, { width: 12 }];
        ws2.addRow(['Tip', 'Reçete Stok Kodu', 'Reçete Adı', 'Malzeme Stok Kodu', 'Malzeme Adı', 'Miktar', 'Birim']);
        ws2.getRow(1).eachCell((cell) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
            cell.border = EXCEL_THIN_BORDER;
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        });

        let rowNo = 2;
        missingList.forEach((m) => {
            ws2.addRow(['Reçete', m.target_stok_kodu || '', m.target_product_name || '', '', '', 1, '']);
            rowNo += 1;
            for (let i = 0; i < 4; i += 1) {
                ws2.addRow(['', '', '', '', '', '', '']);
                rowNo += 1;
            }
        });
        for (let i = 2; i <= rowNo; i += 1) {
            ws2.getRow(i).eachCell((cell) => {
                cell.border = EXCEL_THIN_BORDER;
                cell.alignment = { vertical: 'middle', horizontal: 'left' };
            });
        }

        workbook.xlsx.writeBuffer().then((buf) => {
            const blob = new Blob([buf], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `eksik_recete_personel_formu_${new Date().toISOString().split('T')[0]}.xlsx`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success(`Eksik reçete şablonu indirildi (${missingList.length} üretim).`);
        }).catch((e) => {
            console.error(e);
            toast.error('Şablon oluşturulamadı: ' + (e?.message || String(e)));
        });
    };

    const openRecipeBuilder = (seedProductId = '') => {
        const initialProductId = seedProductId || '';
        setRecipeBuilderRecipeProductId(initialProductId);
        if (initialProductId) {
            const existing = (recipeItems || []).filter((ri) => ri.recipe_product_id === initialProductId);
            if (existing.length > 0) {
                setRecipeBuilderRows(existing.map((ri) => ({
                    ingredient_product_id: ri.ingredient_product_id,
                    qty: String(ri.quantity_per_recipe ?? ''),
                    unit: ri.recipe_unit || 'gr',
                })));
            } else {
                setRecipeBuilderRows([{ ingredient_product_id: '', qty: '', unit: 'gr' }]);
            }
        } else {
            setRecipeBuilderRows([{ ingredient_product_id: '', qty: '', unit: 'gr' }]);
        }
        setRecipeBuilderTemplateSelected(Object.fromEntries(salesRecipeRowsForUi.map((r) => [r.sale_product_id, true])));
        setShowRecipeBuilderModal(true);
    };

    const saveRecipeBuilder = async () => {
        if (!recipeBuilderRecipeProductId) {
            toast.error('Önce üretim ürünü seçin.');
            return;
        }

        const normalized = [];
        recipeBuilderRows.forEach((row) => {
            const ingredientId = row.ingredient_product_id;
            const q = parseFlexibleNumber(row.qty);
            if (!ingredientId || q == null || q <= 0) return;
            normalized.push({
                recipe_product_id: recipeBuilderRecipeProductId,
                ingredient_product_id: ingredientId,
                quantity_per_recipe: q,
                recipe_unit: row.unit || null,
                source_recipe_code: null,
                source_recipe_name: null,
                updated_at: new Date().toISOString(),
            });
        });

        if (!normalized.length) {
            toast.error('En az 1 malzeme (miktar > 0) girin.');
            return;
        }

        const dedup = new Map();
        normalized.forEach((r) => {
            dedup.set(`${r.recipe_product_id}|${r.ingredient_product_id}`, r);
        });
        const payload = Array.from(dedup.values());

        setRecipeBuilderSaving(true);
        try {
            const { error: delErr } = await supabase
                .from('recipe_items')
                .delete()
                .eq('recipe_product_id', recipeBuilderRecipeProductId);
            if (delErr) throw delErr;

            const { error: insErr } = await supabase
                .from('recipe_items')
                .upsert(payload, { onConflict: 'recipe_product_id,ingredient_product_id' });
            if (insErr) throw insErr;

            toast.success(`Reçete kaydedildi (${payload.length} malzeme).`);
            await fetchData();
            setShowRecipeBuilderModal(false);
        } catch (error) {
            toast.error('Reçete kaydedilemedi: ' + error.message);
        } finally {
            setRecipeBuilderSaving(false);
        }
    };

    const downloadRecipeTemplateFromBuilderSelection = () => {
        const selectedIds = salesRecipeRowsForUi
            .filter((r) => !!recipeBuilderTemplateSelected[r.sale_product_id])
            .map((r) => r.sale_product_id);
        if (!selectedIds.length) {
            toast.error('Önce şablona eklenecek satışları seçin.');
            return;
        }
        exportMissingRecipeTemplateXlsx(selectedIds);
    };

    /** Receteler.csv importu: mamul -> bileşen tüketimi (adet başı) */
    const importRecipeRowsToDb = useCallback(async (rows, manualMap = {}) => {
        const productByStok = new Map();
        const productsByNorm = new Map();
        const normalizeRecipeName = (value) => {
            let t = normalizeText(value || '');
            t = t
                .replace(/\*/g, ' ')
                .replace(/\b(adet|kg|gr|lt|l|paket|porsiyon|menu|menü)\b/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            return t;
        };
        const productsByRecipeNorm = new Map();
        const registerProductMaps = (p) => {
            if (!p) return;
            const sk = String(p.stok_kodu || '').trim().toUpperCase();
            if (sk) productByStok.set(sk, p);
            const nk = normalizeText(p.product_name);
            if (nk) {
                if (!productsByNorm.has(nk)) productsByNorm.set(nk, []);
                productsByNorm.get(nk).push(p);
            }
            const rk = normalizeRecipeName(p.product_name);
            if (rk) {
                if (!productsByRecipeNorm.has(rk)) productsByRecipeNorm.set(rk, []);
                productsByRecipeNorm.get(rk).push(p);
            }
        };
        products.forEach(registerProductMaps);

        const resolveByName = (name) => {
            const n = normalizeText(name);
            const rn = normalizeRecipeName(name);
            const exactRecipe = productsByRecipeNorm.get(rn);
            if (exactRecipe?.length === 1) return exactRecipe[0];
            const exact = productsByNorm.get(n);
            if (exact?.length === 1) return exact[0];
            const cand = products.filter((p) => {
                const pn = normalizeText(p.product_name);
                return pn.includes(n) || n.includes(pn);
            });
            if (cand.length === 1) return cand[0];
            const srcTokens = new Set(rn.split(' ').filter(Boolean));
            let best = null;
            let bestScore = 0;
            products.forEach((p) => {
                const prn = normalizeRecipeName(p.product_name);
                if (!prn) return;
                const pTokens = prn.split(' ').filter(Boolean);
                if (!pTokens.length) return;
                let common = 0;
                pTokens.forEach((t) => { if (srcTokens.has(t)) common++; });
                const overlap = common / Math.max(srcTokens.size, pTokens.length);
                const includesBoost = (prn.includes(rn) || rn.includes(prn)) ? 0.25 : 0;
                const score = overlap + includesBoost;
                if (score > bestScore) {
                    bestScore = score;
                    best = p;
                }
            });
            if (best && bestScore >= 0.75) return best;
            return null;
        };

        const ensureProductForCode = async (code, name) => {
            const c = String(code || '').trim().toUpperCase();
            if (!c) return null;
            const local = productByStok.get(c);
            if (local) return local;
            const { data: existing, error: exErr } = await supabase
                .from('products')
                .select('id, stok_kodu, product_name, barcode, unit, purchase_price, category, is_active')
                .ilike('stok_kodu', c)
                .limit(1)
                .maybeSingle();
            if (!exErr && existing) {
                registerProductMaps(existing);
                return existing;
            }
            const payload = {
                stok_kodu: c,
                product_name: String(name || '').trim() || c,
                unit: 'Adet',
                purchase_price: 0,
                current_stock: 0,
                is_active: true,
            };
            const { data: inserted, error: insErr } = await supabase
                .from('products')
                .insert([payload])
                .select('id, stok_kodu, product_name, barcode, unit, purchase_price, category, is_active')
                .single();
            if (insErr || !inserted) return null;
            registerProductMaps(inserted);
            return inserted;
        };

        // 1) Stok kodu verilip eşleşmeyenleri otomatik ürün açarak tamamla.
        const missingCodeRefs = new Map();
        rows.forEach((r) => {
            const refs = [
                { kind: 'recipe', code: r.recipe_stok_kodu, name: r.recipe_name },
                { kind: 'ingredient', code: r.ingredient_stok_kodu, name: r.ingredient_name },
            ];
            refs.forEach((rf) => {
                const code = String(rf.code || '').trim().toUpperCase();
                if (!code) return;
                if (productByStok.has(code)) return;
                missingCodeRefs.set(`${rf.kind}|${code}`, { code, name: rf.name || '' });
            });
        });
        let autoCreatedCount = 0;
        for (const rf of missingCodeRefs.values()) {
            const p = await ensureProductForCode(rf.code, rf.name);
            if (p) autoCreatedCount++;
        }

        const unresolvedMap = new Map();
        const payloadMap = new Map();
        const resolveRef = (kind, code, name) => {
            const codeUpper = String(code || '').trim().toUpperCase();
            const mapKey = `${kind}|${codeUpper}|${normalizeText(name)}`;
            if (manualMap[mapKey]) {
                const p = products.find((x) => x.id === manualMap[mapKey]);
                if (p) return p;
            }
            const byCode = codeUpper ? productByStok.get(codeUpper) : null;
            if (byCode) return byCode;
            const byName = resolveByName(name);
            if (byName) return byName;
            unresolvedMap.set(mapKey, {
                mapKey,
                kind,
                stok_kodu: code || '',
                product_name: name || '',
                selectedProductId: manualMap[mapKey] || '',
            });
            return null;
        };

        rows.forEach((r) => {
            const rp = resolveRef('recipe', r.recipe_stok_kodu, r.recipe_name);
            const ip = resolveRef('ingredient', r.ingredient_stok_kodu, r.ingredient_name);
            if (!rp || !ip) return;
            const key = `${rp.id}|${ip.id}`;
            payloadMap.set(key, {
                recipe_product_id: rp.id,
                ingredient_product_id: ip.id,
                quantity_per_recipe: r.qty_per_recipe,
                recipe_unit: r.unit || null,
                source_recipe_code: r.recipe_stok_kodu || null,
                source_recipe_name: r.recipe_name || null,
                updated_at: new Date().toISOString(),
            });
        });

        const unresolved = Array.from(unresolvedMap.values());
        setRecipeUnmatched(unresolved);
        if (unresolved.length > 0) {
            toast.error(`Reçete importunda ${unresolved.length} eşleşmeyen ürün var. Aşağıdan seçip tekrar uygula.`);
            return false;
        }

        const payload = Array.from(payloadMap.values());
        if (!payload.length) {
            toast.error('Reçete satırı bulunamadı.');
            return false;
        }

                // Manuel eklenen reçeteler korunur (source alanları null olanlar).
        const { data: manualRows, error: manualRowsErr } = await supabase
            .from('recipe_items')
            .select('recipe_product_id, ingredient_product_id')
            .is('source_recipe_code', null)
            .is('source_recipe_name', null);
        if (manualRowsErr) {
            toast.error('Manuel reçete katmanı okunamadı: ' + manualRowsErr.message);
            return false;
        }
        const manualKeySet = new Set(
            (manualRows || []).map((r) => `${r.recipe_product_id}|${r.ingredient_product_id}`),
        );

        // CSV importu, manuel satırlarla çakışıyorsa manuel olanı ezme.
        const payloadFiltered = payload.filter(
            (r) => !manualKeySet.has(`${r.recipe_product_id}|${r.ingredient_product_id}`),
        );
        const skippedManualCount = payload.length - payloadFiltered.length;

        // Sadece CSV katmanını temizle; manuel reçeteler kalsın.
        const { error: delErr } = await supabase
            .from('recipe_items')
            .delete()
            .or('source_recipe_code.not.is.null,source_recipe_name.not.is.null');
        if (delErr) {
            toast.error('CSV reçete katmanı temizlenemedi: ' + delErr.message);
            return false;
        }

        for (let i = 0; i < payloadFiltered.length; i += 500) {
            const chunk = payloadFiltered.slice(i, i + 500);
            const { error } = await supabase.from('recipe_items').upsert(chunk, { onConflict: 'recipe_product_id,ingredient_product_id' });
            if (error) {
                toast.error('Reçete yazılamadı: ' + error.message);
                return false;
            }
        }
        toast.success(`Reçeteler işlendi: ${payloadFiltered.length} CSV satırı. Manuel korunan: ${skippedManualCount}. Otomatik açılan ürün: ${autoCreatedCount}.`);
        setRecipeUnmatched([]);
        fetchData();
        return true;
    }, [products, normalizeText]);

    const handleRecipeCsvImport = async (e) => {
        const file = e?.target?.files?.[0];
        if (!file) return;
        setRecipeImporting(true);
        try {
            const text = await file.text();
            const lines = text.split(/\r?\n/);
            const rows = [];
            let current = null;
            const parseNum = (v) => {
                return parseFlexibleNumber(v);
            };
            for (const raw of lines) {
                const cols = String(raw || '').split(';').map((c) => c.trim());
                if (!cols.length) continue;
                if ((cols[0] || '').toLowerCase('tr-TR') === 'reçete' || (cols[0] || '').toLowerCase('tr-TR') === 'recete') {
                    current = {
                        recipe_stok_kodu: cols[1] || '',
                        // Reçete satırı: Stok Adı + Üretim Adı gelebilir; üretim adını önceliklendir.
                        recipe_name: cols[4] || cols[2] || '',
                        plan_qty: parseNum(cols[5]) || 1,
                    };
                    continue;
                }
                if (!current) continue;
                if (!cols[0] && cols[1] && cols[1].toLowerCase('tr-TR') !== 'stok kodu') {
                    const ingredientCode = cols[1] || '';
                    const ingredientName = cols[2] || '';
                    const m = parseNum(cols[3]);
                    if (!ingredientCode && !ingredientName) continue;
                    if (m == null) continue;
                    rows.push({
                        recipe_stok_kodu: current.recipe_stok_kodu,
                        recipe_name: current.recipe_name,
                        ingredient_stok_kodu: ingredientCode,
                        ingredient_name: ingredientName,
                        qty_per_recipe: (m || 0) / (current.plan_qty || 1),
                        unit: cols[5] || cols[7] || '',
                    });
                }
            }
            setRecipeRawRowsCache(rows);
            await importRecipeRowsToDb(rows, recipeManualMap);
        } catch (err) {
            toast.error('Receteler.csv okunamadı: ' + (err?.message || String(err)));
        } finally {
            setRecipeImporting(false);
            e.target.value = '';
        }
    };

    const applyManualRecipeMatches = async () => {
        if (!recipeRawRowsCache.length) {
            toast.error('Önce Receteler.csv içe aktarın.');
            return;
        }
        setRecipeImporting(true);
        try {
            await importRecipeRowsToDb(recipeRawRowsCache, recipeManualMap);
        } finally {
            setRecipeImporting(false);
        }
    };

    /**
     * Receteler.csv raw cache'inde olan ama sistemde bulunmayan ürünleri (mamul + hammadde)
     * toplu olarak Supabase'e ekler. Satış CSV import ya da modal kırmızı uyarı butonundan tetiklenir.
     * @returns {Promise<{created:number, failed:number, total:number}>}
     */
    const syncMissingRecipeProducts = useCallback(async () => {
        if (!recipeRawRowsCache || recipeRawRowsCache.length === 0) {
            return { created: 0, failed: 0, total: 0 };
        }
        const sysSet = new Set(
            products
                .map((p) => String(p.stok_kodu || '').trim().toUpperCase())
                .filter(Boolean),
        );
        // Hem stok kodu olanları hem isim bazlı ama stok kodusuz mamulleri topla
        const missing = new Map();
        recipeRawRowsCache.forEach((row) => {
            const refs = [
                { code: row.recipe_stok_kodu, name: row.recipe_name, kind: 'Mamul' },
                { code: row.ingredient_stok_kodu, name: row.ingredient_name, kind: 'Hammadde' },
            ];
            refs.forEach((rf) => {
                const c = String(rf.code || '').trim().toUpperCase();
                if (!c) return;
                if (sysSet.has(c)) return;
                if (!missing.has(c)) {
                    missing.set(c, { stok_kodu: c, name: rf.name || c, kind: rf.kind });
                }
            });
        });
        const list = Array.from(missing.values());
        if (list.length === 0) return { created: 0, failed: 0, total: 0 };
        let created = 0;
        let failed = 0;
        const batchPayload = list.map((m) => ({
            stok_kodu: m.stok_kodu,
            product_name: String(m.name || m.stok_kodu).trim() || m.stok_kodu,
            unit: 'Adet',
            purchase_price: 0,
            current_stock: 0,
            is_active: true,
        }));
        // Batch insert (500'lük)
        for (let i = 0; i < batchPayload.length; i += 500) {
            const chunk = batchPayload.slice(i, i + 500);
            const { data, error } = await supabase
                .from('products')
                .upsert(chunk, { onConflict: 'stok_kodu' })
                .select('id, stok_kodu');
            if (error) {
                console.error('syncMissingRecipeProducts insert err:', error);
                failed += chunk.length;
                continue;
            }
            created += (data || []).length;
        }
        if (created > 0) await fetchData();
        return { created, failed, total: list.length };
    }, [recipeRawRowsCache, products]);

    /**
     * Satış önizleme modalında verilen kararları uygula:
     *  - 'create' olanları Supabase'e insert eder
     *  - 'map-to' olanları pos_product_map'a kaydeder (kalıcı öğrenme)
     *  - 'keep' olanları mevcut ürüne bağlar
     *  - 'skip' atlanır
     * Sonra satış miktarlarını salesQtyByKey'e ekler.
     */
    const applySalesPreview = useCallback(async () => {
        if (!salesPreview) return;
        setSalesPreviewApplying(true);
        try {
            const { rows, decisions, branchId, branchName } = salesPreview;

            // 1) Oluşturulacak yeni ürünleri topla
            const createPayload = new Map();
            Object.entries(decisions).forEach(([idxStr, dec]) => {
                if (dec?.action !== 'create') return;
                const idx = Number(idxStr);
                const r = rows[idx];
                if (!r) return;
                const code = String(dec.stok_kodu || r.stok_kodu || '').trim().toUpperCase();
                if (!code) return;
                if (createPayload.has(code)) return;
                createPayload.set(code, {
                    stok_kodu: code,
                    product_name: String(dec.name || r.name || code).trim() || code,
                    unit: 'Adet',
                    purchase_price: 0,
                    current_stock: 0,
                    is_active: true,
                });
            });

            const codeToNewProduct = new Map();
            if (createPayload.size > 0) {
                const arr = Array.from(createPayload.values());
                for (let i = 0; i < arr.length; i += 500) {
                    const chunk = arr.slice(i, i + 500);
                    const { data, error } = await supabase
                        .from('products')
                        .upsert(chunk, { onConflict: 'stok_kodu' })
                        .select('id, stok_kodu, product_name, barcode, unit, purchase_price, category, is_active');
                    if (error) {
                        console.error('sales-preview create err:', error);
                        continue;
                    }
                    (data || []).forEach((p) => {
                        codeToNewProduct.set(String(p.stok_kodu || '').toUpperCase(), p);
                    });
                }
            }

            // 2) Manuel eşlemeleri (pos_product_map) kaydet — pos_product_name üzerinden
            const posMapRows = [];
            Object.entries(decisions).forEach(([idxStr, dec]) => {
                if (dec?.action !== 'map-to') return;
                const idx = Number(idxStr);
                const r = rows[idx];
                if (!r || !r.name || !dec.mapProductId) return;
                posMapRows.push({
                    pos_product_name: r.name,
                    product_id: dec.mapProductId,
                    updated_at: new Date().toISOString(),
                });
            });
            if (posMapRows.length > 0) {
                const { error } = await supabase
                    .from('pos_product_map')
                    .upsert(posMapRows, { onConflict: 'pos_product_name' });
                if (error) console.error('pos_product_map upsert err:', error);
            }

            // 3) Satış miktarlarını hesapla
            pushSalesUndoSnapshot();
            const merge = { ...salesQtyByKeyRef.current };
            let applied = 0;
            let skipped = 0;
            let created = 0;
            let mapped = 0;

            rows.forEach((r) => {
                const dec = decisions[r.idx];
                if (!dec || dec.action === 'skip') { skipped++; return; }
                let pid = null;
                if (dec.action === 'keep' || dec.action === 'review-keep') {
                    pid = dec.mapProductId || r.product?.id;
                } else if (dec.action === 'map-to') {
                    pid = dec.mapProductId;
                    if (pid) mapped++;
                } else if (dec.action === 'create') {
                    const code = String(dec.stok_kodu || r.stok_kodu || '').trim().toUpperCase();
                    const p = codeToNewProduct.get(code);
                    if (p) { pid = p.id; created++; }
                }
                if (!pid) { skipped++; return; }
                const k = `${branchId}|${pid}`;
                merge[k] = (Number(merge[k]) || 0) + Number(r.qty || 0);
                applied++;
            });

            setSalesQtyByKey(merge);
            if (created > 0 || mapped > 0) await fetchData();

            toast.success(
                `Satış uygulandı (${branchName}): ${applied} satır işlendi | ${created} yeni ürün | ${mapped} eşleme | ${skipped} atlandı.`,
            );
            setSalesPreviewOpen(false);
            setSalesPreview(null);
        } catch (err) {
            toast.error('Satış uygulama hatası: ' + (err?.message || String(err)));
        } finally {
            setSalesPreviewApplying(false);
        }
    }, [salesPreview, pushSalesUndoSnapshot, setSalesQtyByKey, fetchData]);

    const salesRecipeAllForBranch = useMemo(() => {
        if (selectedBranchId === 'ALL') return [];
        const productById = new Map(products.map((p) => [p.id, p]));
        const salesByProduct = new Map();
        Object.keys(salesQtyByKey).forEach((k) => {
            const [bid, pid] = k.split('|');
            if (bid !== selectedBranchId) return;
            const n = Number(salesQtyByKey[k]) || 0;
            if (n === 0) return;
            salesByProduct.set(pid, (salesByProduct.get(pid) || 0) + n);
        });
        const out = [];
        salesByProduct.forEach((qty, pid) => {
            const p = productById.get(pid);
            const resolvedProductId = resolveRecipeProductIdForSaleProduct(pid);
            out.push({
                sale_product_id: pid,
                sale_stok_kodu: p?.stok_kodu || '',
                sale_product_name: p?.product_name || '(ürün bulunamadı)',
                sold_qty: qty,
                is_resolved: !!resolvedProductId,
                resolved_product_id: resolvedProductId || '',
            });
        });
        out.sort((a, b) => (a.sale_product_name || '').localeCompare(b.sale_product_name || '', 'tr'));
        return out;
    }, [selectedBranchId, salesQtyByKey, resolveRecipeProductIdForSaleProduct, products]);

    const salesRecipeNeedsMapping = useMemo(
        () => salesRecipeAllForBranch.filter((r) => !r.is_resolved),
        [salesRecipeAllForBranch],
    );

    const salesRecipeRowsForUi = useMemo(
        () => (salesRecipeShowResolved ? salesRecipeAllForBranch : salesRecipeNeedsMapping),
        [salesRecipeShowResolved, salesRecipeAllForBranch, salesRecipeNeedsMapping],
    );

    const salesProductsMissingRecipe = useMemo(() => {
        if (selectedBranchId === 'ALL') return [];
        const productById = new Map(products.map((p) => [p.id, p]));
        const recipeCountByProduct = new Map();
        recipeItems.forEach((ri) => {
            const pid = ri?.recipe_product_id;
            if (!pid) return;
            recipeCountByProduct.set(pid, (recipeCountByProduct.get(pid) || 0) + 1);
        });

        const out = [];
        salesRecipeAllForBranch.forEach((row) => {
            if (!row.is_resolved || !row.resolved_product_id) return;
            const targetPid = row.resolved_product_id;
            const hasRecipe = (recipeCountByProduct.get(targetPid) || 0) > 0;
            if (hasRecipe) return;
            const target = productById.get(targetPid);
            out.push({
                sale_product_id: row.sale_product_id,
                sale_stok_kodu: row.sale_stok_kodu,
                sale_product_name: row.sale_product_name,
                sold_qty: row.sold_qty,
                target_product_id: targetPid,
                target_stok_kodu: target?.stok_kodu || '',
                target_product_name: target?.product_name || '(ürün bulunamadı)',
            });
        });

        out.sort((a, b) => (a.sale_product_name || '').localeCompare(b.sale_product_name || '', 'tr'));
        return out;
    }, [selectedBranchId, products, recipeItems, salesRecipeAllForBranch]);

    const salesRecipeCandidateProducts = useMemo(() => {
        const q = normalizeText(salesRecipeSearch);
        const list = products
            .filter((p) => p.is_active !== false)
            .slice()
            .sort((a, b) => {
                const ak = `${a.product_name || ''} ${a.stok_kodu || ''}`;
                const bk = `${b.product_name || ''} ${b.stok_kodu || ''}`;
                return ak.localeCompare(bk, 'tr');
            });

        if (!q) return list;
        const words = q.split(' ').filter(Boolean);
        return list.filter((p) => {
            const hay = normalizeText(`${p.stok_kodu || ''} ${p.product_name || ''} ${p.barcode || ''} ${p.category || ''}`);
            return words.every((w) => hay.includes(w));
        });
    }, [products, salesRecipeSearch]);

    useEffect(() => {
        if (salesRecipeNeedsMapping.length > 0) {
            setShowSalesRecipeMapModal(true);
        }
    }, [salesRecipeNeedsMapping.length]);

    const selectedBranchManualPurchaseCount = useMemo(() => {
        if (selectedBranchId === 'ALL') return 0;
        let n = 0;
        Object.keys(manualPurchaseByKey).forEach((k) => {
            if (k.startsWith(`${selectedBranchId}|`)) n++;
        });
        return n;
    }, [selectedBranchId, manualPurchaseByKey]);

    /** SCLogger PDF’ten kopyalanan metin veya .txt — satır: «ÜRÜN ADET 12.345,00» */
    const importScLoggerPlainText = useCallback(
        (text) => {
            if (selectedBranchId === 'ALL') {
                toast.error('Önce şube seçin; satışlar seçili şubeye yazılır.');
                return;
            }
            const rows = [];
            for (const line of String(text).split(/\r?\n/)) {
                const p = parseScLoggerSalesLine(line);
                if (p) rows.push(p);
            }
            if (rows.length === 0) {
                toast.error(
                    'SCLogger satırı yok. PDF’ten tabloyu seçip kopyalayın; satır sonu: adet + tutar (örn. 98.160,00).',
                );
                return;
            }

            pushSalesUndoSnapshot();

            const productsByNorm = new Map();
            products.forEach((p) => {
                const k = normalizeText(p.product_name);
                if (!k) return;
                if (!productsByNorm.has(k)) productsByNorm.set(k, []);
                productsByNorm.get(k).push(p);
            });

            const resolveScLoggerProductName = (rawName) => {
                const raw = String(rawName || '').trim();
                if (posManualMap[raw]) {
                    const mappedProduct = products.find(p => p.id === posManualMap[raw]);
                    if (mappedProduct) return { product: mappedProduct, reason: null };
                }
                if (!raw) return { product: null, reason: 'empty' };
                const k = normalizeText(raw);
                const exactList = productsByNorm.get(k);
                if (exactList?.length === 1) return { product: exactList[0], reason: null };
                if (exactList?.length > 1) return { product: null, reason: 'ambiguous_name' };
                const candidates = products.filter((p) => {
                    const pn = normalizeText(p.product_name);
                    return pn.includes(k) || k.includes(pn);
                });
                if (candidates.length === 1) return { product: candidates[0], reason: null };
                if (candidates.length > 1) return { product: null, reason: 'ambiguous_partial' };
                const prefixOnly = products.filter((p) => {
                    const pn = normalizeText(p.product_name);
                    return k.length >= 4 && pn.startsWith(k);
                });
                if (prefixOnly.length === 1) return { product: prefixOnly[0], reason: null };
                return { product: null, reason: 'not_found' };
            };

            let matched = 0;
            let skipped = 0;
            let ambiguous = 0;
            setSalesQtyByKey((prev) => {
                const merge = { ...prev };
                for (const { name, qty } of rows) {
                    const { product, reason } = resolveScLoggerProductName(name);
                    if (!product) {
                        if (reason === 'ambiguous_name' || reason === 'ambiguous_partial') ambiguous++;
                        else skipped++;
                        continue;
                    }
                    const key = `${selectedBranchId}|${product.id}`;
                    merge[key] = (Number(merge[key]) || 0) + qty;
                    matched++;
                }
                return merge;
            });
            const bn = branches.find((b) => b.id === selectedBranchId)?.branch_name || '';
            toast.success(
                `SCLogger satışları (${bn}): ${matched} eşleşti, ${skipped} bulunamadı, ${ambiguous} belirsiz.`,
            );
        },
        [products, branches, selectedBranchId, pushSalesUndoSnapshot],
    );

    /** POS / satış raporu: Excel veya CSV. �?ube filtresindeki şubeye yazılır (Tüm şubeler seçiliyse içe aktarılamaz). */
    const handleBranchSalesImport = async (e) => {
        const file = e?.target?.files?.[0];
        if (!file) return;
        if (selectedBranchId === 'ALL') {
            toast.error('Önce şube seçin; satışlar seçili şubeye işlenir.');
            e.target.value = '';
            return;
        }
        setSalesImporting(true);
        try {
            const lowerName = (file.name || '').toLowerCase();
            if (lowerName.endsWith('.txt') || lowerName.endsWith('.text') || (file.type && file.type.startsWith('text/'))) {
                const text = await file.text();
                importScLoggerPlainText(text);
                return;
            }

            const buf = await file.arrayBuffer();
            const wb = XLSX.read(buf, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
            if (!rows?.length) {
                toast.error('Dosya boş.');
                return;
            }
            const header = (rows[0] || []).map((h) => asciiFoldKey(String(h || '')));
            const colStok = header.findIndex((h) => (h.includes('stok') && h.includes('kod')) || h === 'stokkodu');
            const colUrun = header.findIndex(
                (h) =>
                    (h.includes('urun') && h.includes('ad'))
                    || h === 'urun'
                    || (h.includes('stok') && h.includes('ad')),
            );
            const colBarkod = header.findIndex((h) => h.includes('barkod') || h === 'barcode' || h.includes('ean'));
            const colQty = header.findIndex(
                (h) =>
                    h === 'miktar'
                    || h.includes('satis')
                    || h === 'adet'
                    || h === 'qty'
                    || h === 'quantity'
                    || h.includes('cikis')
                    || h.includes('net'),
            );
            if (colQty < 0) {
                toast.error('Miktar sütunu bulunamadı (Miktar, Satış, Adet, Qty vb.).');
                return;
            }

            const normalizeBarcodeCsv = (raw) => String(raw ?? '').trim().replace(/\s+/g, '');
            const productByStokUpper = new Map();
            const stokDup = new Set();
            products.forEach((p) => {
                const sk = String(p.stok_kodu || '').trim().toUpperCase();
                if (!sk) return;
                if (productByStokUpper.has(sk)) stokDup.add(sk);
                else productByStokUpper.set(sk, p);
            });
            const barcodeToList = new Map();
            products.forEach((p) => {
                const b = normalizeBarcodeCsv(p.barcode);
                if (!b) return;
                if (!barcodeToList.has(b)) barcodeToList.set(b, []);
                barcodeToList.get(b).push(p);
            });
            const productsByNorm = new Map();
            products.forEach((p) => {
                const k = normalizeText(p.product_name);
                if (!k) return;
                if (!productsByNorm.has(k)) productsByNorm.set(k, []);
                productsByNorm.get(k).push(p);
            });

            const resolveName = (csvName) => {
                const raw = String(csvName || '').trim();
                if (posManualMap[raw]) {
                    const mappedProduct = products.find(p => p.id === posManualMap[raw]);
                    if (mappedProduct) return { product: mappedProduct, reason: null };
                }
                if (!raw) return { product: null, reason: 'empty' };
                const k = normalizeText(raw);
                const exactList = productsByNorm.get(k);
                if (exactList?.length === 1) return { product: exactList[0], reason: null };
                if (exactList?.length > 1) return { product: null, reason: 'ambiguous_name' };
                const candidates = products.filter((p) => {
                    const pn = normalizeText(p.product_name);
                    return pn.includes(k) || k.includes(pn);
                });
                if (candidates.length === 1) return { product: candidates[0], reason: null };
                if (candidates.length > 1) return { product: null, reason: 'ambiguous_partial' };
                return { product: null, reason: 'not_found' };
            };

            const resolveRow = (cells) => {
                const skRaw = colStok >= 0 ? String(cells[colStok] ?? '').trim() : '';
                if (skRaw) {
                    const sk = skRaw.toUpperCase();
                    // Stok kodu tek başına güvenilir olsa da, CSV kodu farklı bir sistemden geldiyse
                    // barkod/ad fallback ile yine eşleştirmeyi deniyoruz.
                    if (stokDup.has(sk)) {
                        // continue to fallback
                    } else {
                    const ps = productByStokUpper.get(sk);
                    if (ps) return { product: ps, reason: null };
                    }
                }
                const bcRaw = colBarkod >= 0 ? String(cells[colBarkod] ?? '').trim() : '';
                const bc = normalizeBarcodeCsv(bcRaw);
                if (bc) {
                    const list = barcodeToList.get(bc);
                    if (list?.length === 1) return { product: list[0], reason: null };
                    if (list && list.length > 1) return { product: null, reason: 'ambiguous_barcode' };
                }
                const nameRaw = colUrun >= 0 ? String(cells[colUrun] ?? '').trim() : '';
                if (nameRaw) return resolveName(nameRaw);
                if (skRaw) return { product: null, reason: 'stok_not_found' };
                return { product: null, reason: 'empty' };
            };

            const parseQty = (v) => {
                return parseFlexibleNumber(v);
            };

            // ---- Parse + Classify: Preview modalı açılacak, kaydetmek için onay bekleyecek ----
            // Reçete cache'ini hazırla (öneriler için)
            const recipeByCode = new Map();
            const recipeByNameNorm = new Map();
            (recipeRawRowsCache || []).forEach((r) => {
                const refs = [
                    { code: r.recipe_stok_kodu, name: r.recipe_name, kind: 'Mamul' },
                    { code: r.ingredient_stok_kodu, name: r.ingredient_name, kind: 'Hammadde' },
                ];
                refs.forEach((rf) => {
                    const c = String(rf.code || '').trim().toUpperCase();
                    const n = String(rf.name || '').trim();
                    if (c && n) {
                        if (!recipeByCode.has(c)) recipeByCode.set(c, { code: c, name: n, kind: rf.kind });
                        const nk = normalizeText(n);
                        if (nk && !recipeByNameNorm.has(nk)) recipeByNameNorm.set(nk, { code: c, name: n, kind: rf.kind });
                    }
                });
            });

            // Her satırı sınıflandır
            const classified = [];
            for (let i = 1; i < rows.length; i++) {
                const cells = rows[i];
                if (!cells || !cells.length) continue;
                const qty = parseQty(cells[colQty]);
                if (qty == null) continue;
                const skRaw = colStok >= 0 ? String(cells[colStok] ?? '').trim() : '';
                const skUpper = skRaw.toUpperCase();
                const bcRaw = colBarkod >= 0 ? String(cells[colBarkod] ?? '').trim() : '';
                const nmRaw = colUrun >= 0 ? String(cells[colUrun] ?? '').trim() : '';
                const { product, reason } = resolveRow(cells);

                // Güven skoru + eşleşme metodu tespit et
                let confidence = 0;
                let matchMethod = '';
                if (product) {
                    if (skUpper && String(product.stok_kodu || '').toUpperCase() === skUpper) {
                        confidence = 100; matchMethod = 'Stok kodu';
                    } else if (bcRaw && normalizeBarcodeCsv(product.barcode) === normalizeBarcodeCsv(bcRaw)) {
                        confidence = 95; matchMethod = 'Barkod';
                    } else if (nmRaw && normalizeText(product.product_name) === normalizeText(nmRaw)) {
                        confidence = 90; matchMethod = 'Tam isim';
                    } else if (nmRaw && posManualMap[nmRaw]) {
                        confidence = 100; matchMethod = 'Manuel kayıt (POS map)';
                    } else {
                        confidence = 70; matchMethod = 'Kısmi isim';
                    }
                }

                // Öneri (reçeteden veya sistem içinden)
                let suggestion = null;
                if (!product) {
                    if (skUpper && recipeByCode.has(skUpper)) {
                        suggestion = { source: 'recipe', ...recipeByCode.get(skUpper) };
                    } else if (nmRaw) {
                        const nk = normalizeText(nmRaw);
                        const hit = recipeByNameNorm.get(nk);
                        if (hit) suggestion = { source: 'recipe', ...hit };
                    }
                }

                classified.push({
                    idx: classified.length,
                    rowNum: i + 1,
                    stok_kodu: skRaw,
                    barcode: bcRaw,
                    name: nmRaw,
                    qty,
                    product: product || null,
                    confidence,
                    matchMethod,
                    reason: reason || null,
                    suggestion,
                });
            }

            // Aynı satır/ürün için CSV'de mükerrer tespit (stok_kodu bazında)
            const dupMap = new Map();
            classified.forEach((r) => {
                const k = r.stok_kodu ? `C:${r.stok_kodu.toUpperCase()}` : (r.name ? `N:${normalizeText(r.name)}` : '');
                if (!k) return;
                if (!dupMap.has(k)) dupMap.set(k, []);
                dupMap.get(k).push(r.idx);
            });
            classified.forEach((r) => {
                const k = r.stok_kodu ? `C:${r.stok_kodu.toUpperCase()}` : (r.name ? `N:${normalizeText(r.name)}` : '');
                const arr = k ? dupMap.get(k) : null;
                r.duplicateCount = arr ? arr.length : 1;
            });

            // Varsayılan kararlar: eşleşen → keep, eksik + öneri varsa → create, eksik önerisiz → skip
            const defaultDecisions = {};
            classified.forEach((r) => {
                if (r.product) {
                    // confidence >= 90 → otomatik onay, düşükse review
                    defaultDecisions[r.idx] = { action: r.confidence >= 90 ? 'keep' : 'review-keep', mapProductId: r.product.id };
                } else if (r.suggestion) {
                    defaultDecisions[r.idx] = { action: 'create', stok_kodu: r.suggestion.code, name: r.suggestion.name };
                } else {
                    defaultDecisions[r.idx] = { action: 'skip' };
                }
            });

            const bn = branches.find((b) => b.id === selectedBranchId)?.branch_name || '';
            setSalesPreview({
                fileName: file.name,
                branchId: selectedBranchId,
                branchName: bn,
                rows: classified,
                decisions: defaultDecisions,
                activeTab: 'missing', // en önemli sekme default: eksikler
                searchText: '',
            });
            setSalesPreviewOpen(true);
            return; // Kaydetme işi modal onayına bağlı
        } catch (err) {
            toast.error('Satış dosyası okunamadı: ' + (err?.message || String(err)));
        } finally {
            setSalesImporting(false);
            e.target.value = '';
        }
    };

    const undoLastSalesChange = () => {
        setSalesUndoStack((stack) => {
            if (stack.length === 0) {
                toast.error('Geri alınacak satış adımı yok.');
                return stack;
            }
            const nextStack = stack.slice(0, -1);
            const snap = stack[stack.length - 1];
            setSalesQtyByKey({ ...snap });
            toast.success('Son satış değişikliği geri alındı.');
            return nextStack;
        });
    };

    const clearSalesForSelectedBranch = () => {
        pushSalesUndoSnapshot();
        if (selectedBranchId === 'ALL') {
            setSalesQtyByKey({});
            toast.success('Tüm şube satış verileri temizlendi.');
            return;
        }
        setSalesQtyByKey((prev) => {
            const next = { ...prev };
            Object.keys(next).forEach((k) => {
                if (k.startsWith(`${selectedBranchId}|`)) delete next[k];
            });
            return next;
        });
        toast.success('Bu şubenin satış verisi temizlendi.');
    };

    const openSupplyModal = () => {
        if (selectedBranchId === 'ALL') {
            toast.error('Önce şube seçin.');
            return;
        }
        const drafts = {};
        Object.keys(manualPurchaseByKey).forEach((k) => {
            if (!k.startsWith(`${selectedBranchId}|`)) return;
            const pid = k.split('|')[1];
            drafts[pid] = String(manualPurchaseByKey[k]);
        });
        setSupplyDrafts(drafts);
        setSupplyCategory('ALL');
        setSupplySearch('');
        setShowSupplyModal(true);
    };

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

    const applySupplyDrafts = async () => {
        if (selectedBranchId === 'ALL') {
            toast.error('Önce şube seçin.');
            return;
        }
        const activePeriod = periods.find(p => p.is_active);
        if (!activePeriod) {
            toast.error('Aktif sayım dönemi yok. Önce yeni dönem başlatın.');
            return;
        }

        let writtenCount = 0;
        const entries = {};
        Object.keys(supplyDrafts).forEach((pid) => {
            const raw = String(supplyDrafts[pid] ?? '').trim();
            if (!raw) return;
            const n = humanParseFloat(raw);
            if (!Number.isFinite(n) || n <= 0) return;
            entries[`${selectedBranchId}|${pid}`] = n;
            writtenCount++;
        });

        if (writtenCount === 0) {
            toast.error('Kaydedilecek miktar girilmedi. En az bir ürüne sıfırdan büyük değer yazın.');
            return;
        }

        // --- DB'ye kaydet: aktif dönem + seçili şube ---
        setIsLoading(true);
        // Önce bu şubenin bu dönemdeki eski tedarik kayıtlarını sil
        const { error: delErr } = await supabase
            .from('manual_supplies')
            .delete()
            .eq('branch_id', selectedBranchId)
            .eq('period_id', activePeriod.id);
        if (delErr) {
            console.error('manual_supplies delete error:', delErr.message);
        }
        // Yeni satirlari ekle
        const upsertRows = Object.keys(entries).map((k) => {
            const pid = k.split('|')[1];
            return {
                branch_id: selectedBranchId,
                product_id: pid,
                period_id: activePeriod.id,
                quantity: entries[k],
                updated_at: new Date().toISOString(),
            };
        });
        const { error: insErr } = await supabase
            .from('manual_supplies')
            .upsert(upsertRows, { onConflict: 'branch_id,product_id,period_id' });
        setIsLoading(false);
        if (insErr) {
            toast.error('Tedarik DB kayıt hatası: ' + insErr.message);
            return;
        }

        setManualPurchaseByKey((prev) => {
            const updated = { ...prev };
            // Bu şubenin eski alımlarını temizle
            Object.keys(updated).forEach((k) => {
                if (k.startsWith(`${selectedBranchId}|`)) delete updated[k];
            });
            // Yeni girişleri ekle
            Object.assign(updated, entries);
            return updated;
        });

        setShowSupplyModal(false);
        toast.success(`Tedarik kaydedildi (DB + dönem: ${activePeriod.period_name}): ${writtenCount} ürün.`);
    };

    const clearManualPurchasesForSelectedBranch = async () => {
        if (selectedBranchId === 'ALL') {
            toast.error('Önce şube seçin.');
            return;
        }
        const activePeriod = periods.find(p => p.is_active);
        // DB'den de sil
        if (activePeriod) {
            setIsLoading(true);
            await supabase
                .from('manual_supplies')
                .delete()
                .eq('branch_id', selectedBranchId)
                .eq('period_id', activePeriod.id);
            setIsLoading(false);
        }
        setManualPurchaseByKey((prev) => {
            const next = { ...prev };
            Object.keys(next).forEach((k) => {
                if (k.startsWith(`${selectedBranchId}|`)) delete next[k];
            });
            return next;
        });
        toast.success('Bu şubenin manuel alım kayıtları temizlendi (DB + bellek).');
    };

    const calculateRecipeConsumptionForBranch = (branchId) => {
        if (!branchId || branchId === 'ALL') {
            return { ok: false, error: 'Önce bir şube seçin.' };
        }
        const branchSalesKeys = Object.keys(salesQtyByKey).filter((k) => k.startsWith(`${branchId}|`));
        if (branchSalesKeys.length === 0) {
            return { ok: false, error: 'Bu şubede satış verisi yok. Önce satış içe aktarın.' };
        }
        if ((recipeItems || []).length === 0) {
            return { ok: false, error: 'Reçete tablosu boş. Önce Receteler.csv içe aktarın.' };
        }

        const consumptionMap = new Map(); // ingredient_product_id -> qty
        const purchaseMap = new Map(); // ingredient_product_id -> qty
        const recipeProductMap = new Map(); // recipe_product_id -> sold qty (detay icin)
        let soldRecipeProductCount = 0;

        Object.keys(salesQtyByKey).forEach((k) => {
            const [bid, soldPid] = k.split('|');
            if (bid !== branchId) return;
            const sold = Number(salesQtyByKey[k]);
            if (!Number.isFinite(sold) || sold === 0) return;
            const recipePid = resolveRecipeProductIdForSaleProduct(soldPid);
            if (!recipePid) return;

            recipeProductMap.set(recipePid, (recipeProductMap.get(recipePid) || 0) + sold);

            const recipeRows = recipeByProductId.get(recipePid) || [];
            if (recipeRows.length === 0) {
                // Direkt tüketim: reçete yoksa kendini 1'e 1 düşür (içecek vb.)
                consumptionMap.set(recipePid, (consumptionMap.get(recipePid) || 0) + sold);
            } else {
                soldRecipeProductCount++;
                recipeRows.forEach((ri) => {
                    const useQty = sold * (Number(ri.quantity_per_recipe) || 0);
                    if (!Number.isFinite(useQty) || useQty === 0) return;
                    const pid = ri.ingredient_product_id;
                    consumptionMap.set(pid, (consumptionMap.get(pid) || 0) + useQty);
                });
            }
        });

        if (consumptionMap.size === 0) {
            return {
                ok: false,
                error:
                    `Tüketim hesaplanamadı. Şube satış satırı: ${branchSalesKeys.length}, reçeteye eşleşen mamul: ${soldRecipeProductCount}. ` +
                    'Gerekirse aşağıdaki «Satış -> Reçete mamul eşleştirme» panelinden manuel eşleştirin.',
            };
        }

        Object.keys(manualPurchaseByKey).forEach((k) => {
            const [bid, pid] = k.split('|');
            if (bid !== branchId) return;
            const q = Number(manualPurchaseByKey[k]);
            if (!Number.isFinite(q) || q === 0) return;
            purchaseMap.set(pid, (purchaseMap.get(pid) || 0) + q);
        });

        const payload = [];
        const snapshot = [];
        const keys = new Set([...consumptionMap.keys(), ...purchaseMap.keys()]);
        keys.forEach((ingredientPid) => {
            const consumedQty = consumptionMap.get(ingredientPid) || 0;
            const purchaseQty = purchaseMap.get(ingredientPid) || 0;
            const key = `${branchId}|${ingredientPid}`;
            const row = branchStockByKey.get(key);
            const product = products.find((p) => p.id === ingredientPid);
            const prevQty = row ? Number(row.quantity) || 0 : Number(product?.current_stock) || 0;
            const unit_cost = row?.unit_cost ?? null;
            const newQty = prevQty + purchaseQty - consumedQty;
            payload.push({
                branch_id: branchId,
                product_id: ingredientPid,
                quantity: newQty,
                unit_cost,
                updated_at: new Date().toISOString(),
            });
            snapshot.push({
                branch_id: branchId,
                product_id: ingredientPid,
                quantity: prevQty,
                unit_cost,
            });
        });

        return {
            ok: true,
            branchId,
            branchSalesKeyCount: branchSalesKeys.length,
            soldRecipeProductCount,
            consumptionMap,
            purchaseMap,
            recipeProductMap,
            payload,
            snapshot,
        };
    };

    const exportRecipeConsumptionXlsx = async (calc) => {
        const branchId = calc?.branchId;
        const bn = branches.find((b) => b.id === branchId)?.branch_name || branchId || 'Şube';
        const asOf = new Date().toISOString().split('T')[0];

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'İzbel Stok Sayım';
        workbook.created = new Date();

        const thinBorder = EXCEL_THIN_BORDER;

        const makeSheet = (name, columns) => {
            const ws = workbook.addWorksheet(name);
            ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width || 16 }));
            const headerRow = ws.getRow(1);
            headerRow.height = 22;
            headerRow.eachCell((cell) => {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
                cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10, name: 'Arial' };
                cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
                cell.border = thinBorder;
            });
            ws.views = [{ state: 'frozen', ySplit: 1 }];
            return ws;
        };

        // Yardimci haritalar
        const countedByPid = new Map();
        filteredCounts
            .filter((c) => String(c.branch_id) === String(branchId))
            .forEach((c) => {
                if (!c?.product_id) return;
                const v = Number(c.counted_stock);
                if (!Number.isFinite(v)) return;
                countedByPid.set(String(c.product_id), v);
            });

        const impactedKeys = Array.from(new Set([...calc.consumptionMap.keys(), ...calc.purchaseMap.keys()])).map(String);
        impactedKeys.sort((a, b) => {
            const pa = products.find((p) => String(p.id) === String(a));
            const pb = products.find((p) => String(p.id) === String(b));
            return `${pa?.product_name || ''}`.localeCompare(`${pb?.product_name || ''}`, 'tr');
        });

        // Mutabakat
        const wsMut = makeSheet('Mutabakat', [
            { header: 'Stok Kodu', key: 'stok', width: 16 },
            { header: 'Ürün Adı', key: 'name', width: 42 },
            { header: 'Açılış Stok', key: 'opening', width: 14 },
            { header: 'Tedarik (Manuel)', key: 'purchase', width: 16 },
            { header: 'Reçete Tüketimi', key: 'cons', width: 16 },
            { header: 'Teorik Kalan', key: 'theoretical', width: 14 },
            { header: 'Sayılan Stok', key: 'counted', width: 14 },
            { header: 'Fark (Sayılan-Teorik)', key: 'diff', width: 18 },
            { header: 'Birim Maliyet (TL)', key: 'unitCost', width: 16 },
            { header: 'Toplam Fark TL', key: 'diffTl', width: 16 },
        ]);

        // Bilgi satiri (üstte)
        wsMut.spliceRows(1, 0, [`Şube: ${bn} — Tarih: ${asOf} — Mantık: Açılış + Tedarik - Tüketim = Teorik Kalan`]);
        wsMut.mergeCells('A1:J1');
        const info = wsMut.getCell('A1');
        info.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCCFBF1' } };
        info.font = { bold: true, color: { argb: 'FF0F766E' }, size: 11, name: 'Arial' };
        info.alignment = { vertical: 'middle', horizontal: 'left' };
        info.border = thinBorder;
        wsMut.getRow(1).height = 20;

        // Header satiri kaydi 2. satira kaydi
        const headerRow = wsMut.getRow(2);
        headerRow.eachCell((cell) => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10, name: 'Arial' };
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            cell.border = thinBorder;
        });
        wsMut.views = [{ state: 'frozen', ySplit: 2 }];

        const startDataRow = 3;
        impactedKeys.forEach((pid, idx) => {
            const rowIndex = startDataRow + idx;
            const p = products.find((pr) => String(pr.id) === String(pid));
            const key = `${branchId}|${pid}`;
            const purchaseNum = Number(calc.purchaseMap.get(pid) || 0) || 0;
            const consNum = Number(calc.consumptionMap.get(pid) || 0) || 0;
            const currentSys = Number(branchStockMap.get(key) ?? (p?.current_stock ?? 0)) || 0;
            const opening = currentSys - purchaseNum + consNum;
            const counted = countedByPid.has(pid) ? countedByPid.get(pid) : null;
            const unitCost = (() => {
                const row = branchStockByKey.get(key);
                if (row?.unit_cost != null && row?.unit_cost !== '') return Number(row.unit_cost) || 0;
                return Number(p?.unit_cost) || 0;
            })();

            const r = wsMut.getRow(rowIndex);
            r.getCell(1).value = p?.stok_kodu || '';
            r.getCell(2).value = p?.product_name || '(ürün bulunamadı)';
            r.getCell(3).value = opening;
            r.getCell(4).value = purchaseNum;
            r.getCell(5).value = consNum;
            r.getCell(6).value = { formula: `C${rowIndex}+D${rowIndex}-E${rowIndex}` };
            r.getCell(7).value = counted != null ? counted : '';
            r.getCell(8).value = counted != null ? { formula: `G${rowIndex}-F${rowIndex}` } : { formula: `0-F${rowIndex}` };
            r.getCell(9).value = unitCost;
            r.getCell(10).value = { formula: `H${rowIndex}*I${rowIndex}` };

            for (let c = 1; c <= 10; c++) {
                const cell = r.getCell(c);
                cell.border = thinBorder;
                cell.font = { name: 'Arial', size: 10, color: { argb: 'FF0F172A' } };
                cell.alignment = { vertical: 'middle', horizontal: [3, 4, 5, 6, 7, 8, 9, 10].includes(c) ? 'right' : 'left' };
                if ([3, 4, 5, 6, 7, 8].includes(c)) cell.numFmt = '#,##0.00';
                if ([9, 10].includes(c)) cell.numFmt = '#,##0.00';
            }
        });

        // Toplam satiri
        const lastDataRow = startDataRow + impactedKeys.length - 1;
        const totalRowIdx = lastDataRow + 1;
        const tr = wsMut.getRow(totalRowIdx);
        tr.getCell(1).value = 'TOPLAM';
        tr.getCell(1).font = { bold: true, name: 'Arial', size: 10, color: { argb: 'FF0F172A' } };
        tr.getCell(10).value = impactedKeys.length ? { formula: `SUM(J${startDataRow}:J${lastDataRow})` } : 0;
        tr.getCell(10).numFmt = '#,##0.00';
        for (let c = 1; c <= 10; c++) {
            const cell = tr.getCell(c);
            cell.border = thinBorder;
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        }

        // Görsel iyileştirmeler: filtre + zebra satır + pozitif/negatif renklendirme (kâr/zarar)
        wsMut.autoFilter = 'A2:J2';
        const zebraFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        for (let r = startDataRow; r <= lastDataRow; r++) {
            if (r % 2 === 0) {
                const row = wsMut.getRow(r);
                for (let c = 1; c <= 10; c++) {
                    // Sonuç kolonları (Fark / TL) koşullu biçimlendirme ile boyanacak
                    if (c === 8 || c === 10) continue;
                    row.getCell(c).fill = zebraFill;
                }
            }
        }
        if (typeof wsMut.addConditionalFormatting === 'function' && impactedKeys.length) {
            // Fark (H) ve Toplam Fark TL (J): Negatif=kırmızı, Pozitif=yeşil
            wsMut.addConditionalFormatting({
                ref: `H${startDataRow}:H${lastDataRow}`,
                rules: [
                    {
                        type: 'expression',
                        formulae: [`H${startDataRow}<0`],
                        style: {
                            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE4E6' } },
                            font: { color: { argb: 'FFB91C1C' }, bold: true },
                        },
                    },
                    {
                        type: 'expression',
                        formulae: [`H${startDataRow}>0`],
                        style: {
                            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } },
                            font: { color: { argb: 'FF15803D' }, bold: true },
                        },
                    },
                ],
            });
            wsMut.addConditionalFormatting({
                ref: `J${startDataRow}:J${lastDataRow}`,
                rules: [
                    {
                        type: 'expression',
                        formulae: [`J${startDataRow}<0`],
                        style: {
                            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE4E6' } },
                            font: { color: { argb: 'FF9F1239' }, bold: true },
                        },
                    },
                    {
                        type: 'expression',
                        formulae: [`J${startDataRow}>0`],
                        style: {
                            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } },
                            font: { color: { argb: 'FF166534' }, bold: true },
                        },
                    },
                ],
            });
        }

        // Satış Raporu
        const wsSales = makeSheet('Satış Raporu', [
            { header: 'Stok Kodu', key: 'stok', width: 16 },
            { header: 'Ürün Adı', key: 'name', width: 42 },
            { header: 'Satış (Adet)', key: 'qty', width: 16 },
        ]);
        const salesRows = Object.keys(salesQtyByKey)
            .filter((k) => k.startsWith(`${branchId}|`))
            .sort((a, b) => a.localeCompare(b, 'tr'))
            .map((k) => {
                const [, pid] = k.split('|');
                const p = products.find((pr) => String(pr.id) === String(pid));
                return { pid, p, qty: Number(salesQtyByKey[k]) || 0 };
            });
        salesRows.forEach((s, i) => {
            const r = wsSales.getRow(2 + i);
            r.getCell(1).value = s.p?.stok_kodu || '';
            r.getCell(2).value = s.p?.product_name || '(ürün bulunamadı)';
            r.getCell(3).value = s.qty;
            for (let c = 1; c <= 3; c++) {
                const cell = r.getCell(c);
                cell.border = thinBorder;
                cell.font = { name: 'Arial', size: 10, color: { argb: 'FF0F172A' } };
                cell.alignment = { vertical: 'middle', horizontal: c === 3 ? 'right' : 'left' };
                if (c === 3) cell.numFmt = '#,##0.00';
            }
        });
        const salesTotalRow = wsSales.getRow(2 + salesRows.length);
        salesTotalRow.getCell(2).value = 'TOPLAM';
        salesTotalRow.getCell(3).value = salesRows.length ? { formula: `SUM(C2:C${1 + salesRows.length})` } : 0;
        salesTotalRow.getCell(3).numFmt = '#,##0.00';
        salesTotalRow.eachCell((cell) => {
            cell.border = thinBorder;
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
            cell.font = { ...(cell.font || {}), bold: true, name: 'Arial' };
        });

        // Hammaddeler (malzemeler) — Mutabakat ile ayni satirlar, sadece temel kolonlar
        const wsIng = makeSheet('Hammaddeler', [
            { header: 'Stok Kodu', key: 'stok', width: 16 },
            { header: 'Malzeme Adı', key: 'name', width: 44 },
            { header: 'Açılış Stok', key: 'opening', width: 14 },
            { header: 'Tedarik (Manuel)', key: 'purchase', width: 16 },
            { header: 'Reçete Tüketimi', key: 'cons', width: 16 },
            { header: 'Teorik Kalan', key: 'theoretical', width: 14 },
        ]);
        impactedKeys.forEach((pid, idx) => {
            const rowIndex = 2 + idx;
            const p = products.find((pr) => String(pr.id) === String(pid));
            const key = `${branchId}|${pid}`;
            const purchaseNum = Number(calc.purchaseMap.get(pid) || 0) || 0;
            const consNum = Number(calc.consumptionMap.get(pid) || 0) || 0;
            const currentSys = Number(branchStockMap.get(key) ?? (p?.current_stock ?? 0)) || 0;
            const opening = currentSys - purchaseNum + consNum;

            const r = wsIng.getRow(rowIndex);
            r.getCell(1).value = p?.stok_kodu || '';
            r.getCell(2).value = p?.product_name || '(ürün bulunamadı)';
            r.getCell(3).value = opening;
            r.getCell(4).value = purchaseNum;
            r.getCell(5).value = consNum;
            r.getCell(6).value = { formula: `C${rowIndex}+D${rowIndex}-E${rowIndex}` };

            for (let c = 1; c <= 6; c++) {
                const cell = r.getCell(c);
                cell.border = thinBorder;
                cell.font = { name: 'Arial', size: 10, color: { argb: 'FF0F172A' } };
                cell.alignment = { vertical: 'middle', horizontal: [3, 4, 5, 6].includes(c) ? 'right' : 'left' };
                if ([3, 4, 5, 6].includes(c)) cell.numFmt = '#,##0.00';
            }
        });
        const ingTotalRow = wsIng.getRow(2 + impactedKeys.length);
        ingTotalRow.getCell(2).value = 'TOPLAM';
        ingTotalRow.getCell(4).value = impactedKeys.length ? { formula: `SUM(D2:D${1 + impactedKeys.length})` } : 0;
        ingTotalRow.getCell(5).value = impactedKeys.length ? { formula: `SUM(E2:E${1 + impactedKeys.length})` } : 0;
        ingTotalRow.getCell(6).value = impactedKeys.length ? { formula: `SUM(F2:F${1 + impactedKeys.length})` } : 0;
        [4, 5, 6].forEach((c) => (ingTotalRow.getCell(c).numFmt = '#,##0.00'));
        ingTotalRow.eachCell((cell) => {
            cell.border = thinBorder;
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
            cell.font = { ...(cell.font || {}), bold: true, name: 'Arial' };
        });

        // Reçete tüketim detay
        const wsDet = makeSheet('Reçete Tüketim Detay', [
            { header: 'Mamul Stok Kodu', key: 'stok', width: 16 },
            { header: 'Mamul Adı', key: 'name', width: 44 },
            { header: 'Satış (Adet)', key: 'sold', width: 14 },
            { header: 'Malzeme Stok Kodu', key: 'ingStok', width: 16 },
            { header: 'Malzeme Adı', key: 'ingName', width: 44 },
            { header: 'Reçete Katsayı', key: 'coef', width: 14 },
            { header: 'Tüketim', key: 'use', width: 14 },
        ]);

        let detRowIdx = 2;
        Array.from(calc.recipeProductMap.entries())
            .sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'tr'))
            .forEach(([recipePid, soldQty]) => {
                const rp = products.find((pr) => String(pr.id) === String(recipePid));
                const rows = recipeByProductId.get(recipePid) || [];
                if (!rows.length) {
                    // direkt tüketim satiri
                    const r = wsDet.getRow(detRowIdx++);
                    r.getCell(1).value = rp?.stok_kodu || '';
                    r.getCell(2).value = rp?.product_name || '(ürün bulunamadı)';
                    r.getCell(3).value = soldQty;
                    r.getCell(4).value = rp?.stok_kodu || '';
                    r.getCell(5).value = rp?.product_name || '(ürün bulunamadı)';
                    r.getCell(6).value = 1;
                    r.getCell(7).value = soldQty;
                } else {
                    rows.forEach((ri) => {
                        const ing = products.find((pr) => String(pr.id) === String(ri.ingredient_product_id));
                        const coef = Number(ri.quantity_per_recipe) || 0;
                        const use = soldQty * coef;
                        const r = wsDet.getRow(detRowIdx++);
                        r.getCell(1).value = rp?.stok_kodu || '';
                        r.getCell(2).value = rp?.product_name || '(ürün bulunamadı)';
                        r.getCell(3).value = soldQty;
                        r.getCell(4).value = ing?.stok_kodu || '';
                        r.getCell(5).value = ing?.product_name || '(ürün bulunamadı)';
                        r.getCell(6).value = coef;
                        r.getCell(7).value = use;
                    });
                }
            });
        for (let rIdx = 2; rIdx < detRowIdx; rIdx++) {
            const r = wsDet.getRow(rIdx);
            for (let c = 1; c <= 7; c++) {
                const cell = r.getCell(c);
                cell.border = thinBorder;
                cell.font = { name: 'Arial', size: 10, color: { argb: 'FF0F172A' } };
                cell.alignment = { vertical: 'middle', horizontal: [3, 6, 7].includes(c) ? 'right' : 'left' };
                if ([3, 6, 7].includes(c)) cell.numFmt = '#,##0.00';
            }
        }

        const buf = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `recete_dusum_${(bn || 'sube').replace(/\s+/g, '_')}_${asOf}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const applyRecipeConsumptionToBranchStocks = async () => {
        const calc = calculateRecipeConsumptionForBranch(selectedBranchId);
        if (!calc.ok) {
            toast.error(calc.error || 'Hesaplama yapılamadı.');
            return;
        }

        const bn = branches.find((b) => b.id === selectedBranchId)?.branch_name || 'Seçili şube';
        const ok = window.confirm(
            `${bn} için ${calc.consumptionMap.size} malzemede reçete tüketimi hesaplandı.\n\nSistem stoklarına (branch_stocks) yazılsın mı?\n(Veriyi önce "Excel'e Dök" butonu ile inceleyebilirsiniz.)`,
        );
        if (!ok) return;

        setIsLoading(true);
        for (let i = 0; i < calc.payload.length; i += 500) {
            const chunk = calc.payload.slice(i, i + 500);
            const { error } = await supabase.from('branch_stocks').upsert(chunk, { onConflict: 'branch_id,product_id' });
            if (error) {
                setIsLoading(false);
                toast.error('Reçete düşümü yazılamadı: ' + error.message);
                return;
            }
        }
        setStockApplyUndoStack((s) => [...s.slice(-9), { branch_id: selectedBranchId, rows: calc.snapshot }]);
        fetchData();
        setIsLoading(false);
        toast.success(`Reçete işlemi uygulandı: ${calc.payload.length} satır güncellendi (stok + alım - tüketim).`);
    };

    const undoLastRecipeStockApply = async () => {
        if (stockApplyUndoStack.length === 0) {
            toast.error('Geri alınacak reçete stok uygulaması yok.');
            return;
        }
        const last = stockApplyUndoStack[stockApplyUndoStack.length - 1];
        setIsLoading(true);
        for (let i = 0; i < last.rows.length; i += 500) {
            const chunk = last.rows.slice(i, i + 500).map((r) => ({
                branch_id: r.branch_id,
                product_id: r.product_id,
                quantity: r.quantity,
                unit_cost: r.unit_cost ?? null,
                updated_at: new Date().toISOString(),
            }));
            const { error } = await supabase.from('branch_stocks').upsert(chunk, { onConflict: 'branch_id,product_id' });
            if (error) {
                setIsLoading(false);
                toast.error('Reçete geri alma başarısız: ' + error.message);
                return;
            }
        }
        setStockApplyUndoStack((s) => s.slice(0, -1));
        fetchData();
        setIsLoading(false);
        toast.success('Son reçete stok uygulaması geri alındı.');
    };

    // �?ubeler stok formatında Excel: A=Stok Kodu, B=Stok Adı, C=Grubu, D=Birimi, E=Barkod, F/G/H=sabit 3 şube değeri (sayılan × alım fiyatı)
    const SUBE_STOK_SUBE_NAMES = ['MUTLULUK KAHVELERİ', 'ÇINARLI', 'AYAKÜSTÜ'];
    const exportSubelerStokFormat = () => {
        const periodId = selectedPeriodId !== 'ALL' ? selectedPeriodId : (periods.find(p => p.is_active) || periods[0])?.id;
        if (!periodId) {
            toast.error('Lütfen bir sayım dönemi seçin.');
            return;
        }
        const periodCounts = counts.filter(c => c.period_id === periodId);
        const branchIds = SUBE_STOK_SUBE_NAMES.map(name => branches.find(b => b.branch_name.trim().toUpperCase() === name.toUpperCase())?.id).filter(Boolean);
        const countMap = {};
        periodCounts.forEach(c => {
            const key = `${c.product_id}-${c.branch_id}`;
            const price = unitCostForCount(c);
            countMap[key] = (c.counted_stock ?? 0) * price;
        });

        const header = ['Stok Kodu', 'Stok Adı', 'Grubu', 'Birimi', 'Barkod', ...SUBE_STOK_SUBE_NAMES];
        const data = [header];
        products.forEach(p => {
            const v1 = branchIds[0] ? (countMap[`${p.id}-${branchIds[0]}`] ?? 0) : 0;
            const v2 = branchIds[1] ? (countMap[`${p.id}-${branchIds[1]}`] ?? 0) : 0;
            const v3 = branchIds[2] ? (countMap[`${p.id}-${branchIds[2]}`] ?? 0) : 0;
            data.push([
                p.stok_kodu ?? '', // Stok Kodu (ST00168 vb. - products.stok_kodu varsa)
                p.product_name || '',
                p.category || '', // Grubu (ATI�?TIRMALIK, ÇINARLI MENÜ vb.)
                p.unit || 'Adet',
                p.barcode || '',
                v1 === 0 ? '' : Math.round(v1 * 100) / 100,
                v2 === 0 ? '' : Math.round(v2 * 100) / 100,
                v3 === 0 ? '' : Math.round(v3 * 100) / 100
            ]);
        });

        const ws = XLSX.utils.aoa_to_sheet(data);
        ws['!cols'] = [
            { wch: 16 }, { wch: 40 }, { wch: 18 }, { wch: 10 }, { wch: 16 },
            { wch: 18 }, { wch: 14 }, { wch: 14 }
        ];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '�?ubeler Stok');
        XLSX.writeFile(wb, `subeler_stok_sayim_${new Date().toISOString().split('T')[0]}.xlsx`);
        toast.success('�?ubeler stok formatında Excel indirildi.');
    };

    // --- Stok kartları eşleşme listesi için ortak hesaplama (filtre + sıralama) ---
    const getStokListComputed = () => {
        let listBase = stokListShowPassive ? products : products.filter(p => p.is_active !== false);
        let list = stokListOnlyMissing
            ? products.filter(p => !(p.stok_kodu && p.stok_kodu.trim()) || !(p.category && p.category.trim()))
            : listBase;

        const nameQ = (stokListSearchName || '').trim().toLowerCase();
        const groupQ = (stokListSearchGroup || '').trim().toLowerCase();

        if (nameQ) {
            list = list.filter(p =>
                (p.product_name || '').toLowerCase().includes(nameQ) ||
                (p.stok_kodu || '').toLowerCase().includes(nameQ)
            );
        }
        if (groupQ) {
            list = list.filter(p => (p.category || '').toLowerCase().includes(groupQ));
        }

        const sortKey = stokListSortBy;
        const asc = stokListSortAsc;
        const sorted = [...list].sort((a, b) => {
            let va = sortKey === 'stok_kodu'
                ? (a.stok_kodu || '')
                : sortKey === 'product_name'
                    ? (a.product_name || '')
                    : (a.category || '');
            let vb = sortKey === 'stok_kodu'
                ? (b.stok_kodu || '')
                : sortKey === 'product_name'
                    ? (b.product_name || '')
                    : (b.category || '');
            const cmp = (va || '').localeCompare(vb || '', 'tr');
            return asc ? cmp : -cmp;
        });

        const fullMatch = products.filter(p => (p.stok_kodu && p.stok_kodu.trim()) && (p.category && p.category.trim())).length;
        const total = products.length;

        return {
            sorted,
            fullMatch,
            total,
            nameQ,
            groupQ,
            sortKey,
            asc,
        };
    };

    const handleBulkSetProductPassive = async () => {
        if (!stokListSelectedIds.length) {
            toast.error('Önce pasife alınacak ürünleri seçin.');
            return;
        }
        const ok = window.confirm(`Seçilen ${stokListSelectedIds.length} ürünü pasife almak istiyor musunuz?`);
        if (!ok) return;
        setIsLoading(true);
        try {
            const { error } = await supabase
                .from('products')
                .update({ is_active: false })
                .in('id', stokListSelectedIds);
            if (error) {
                toast.error('Pasife alma başarısız: ' + error.message);
                return;
            }
            toast.success(`${stokListSelectedIds.length} ürün pasife alındı.`);
            setStokListSelectedIds([]);
            fetchData();
        } finally {
            setIsLoading(false);
        }
    };

    // --- Stok kartları: CSV (virgüllü, UTF-8) export ---
    const exportStokKartlariCsv = () => {
        const { sorted } = getStokListComputed();
        if (!sorted.length) {
            toast.error('Dışa aktarılacak stok kartı bulunamadı.');
            return;
        }

        const header = ['Stok Kodu', 'Stok Adı', 'Grubu', 'Maliyet', 'Birimi', 'Barkod', 'Durum'];
        const rows = sorted.map(p => {
            const hasCode = !!(p.stok_kodu && p.stok_kodu.trim());
            const hasGroup = !!(p.category && p.category.trim());
            const ok = hasCode && hasGroup;
            return [
                p.stok_kodu ?? '',
                p.product_name ?? '',
                p.category ?? '',
                p.purchase_price != null ? Number(p.purchase_price) : '',
                p.unit || 'Adet',
                p.barcode ?? '',
                ok ? 'Eşleşti' : 'Eksik',
            ];
        });

        const escape = (val) => {
            if (val === null || val === undefined) return '';
            const s = String(val);
            if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
                return `"${s.replace(/"/g, '""')}"`;
            }
            return s;
        };

        const lines = [header, ...rows].map(row => row.map(escape).join(','));
        const csvContent = '\ufeff' + lines.join('\r\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `stok_kartlari_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast.success('Stok kartları CSV olarak indirildi.');
    };

    // --- Stok kartları: XLSX export ---
    const exportStokKartlariXlsx = () => {
        const { sorted } = getStokListComputed();
        if (!sorted.length) {
            toast.error('Dışa aktarılacak stok kartı bulunamadı.');
            return;
        }

        const header = ['Stok Kodu', 'Stok Adı', 'Grubu', 'Maliyet', 'Birimi', 'Barkod', 'Durum'];
        const data = [header];

        sorted.forEach(p => {
            const hasCode = !!(p.stok_kodu && p.stok_kodu.trim());
            const hasGroup = !!(p.category && p.category.trim());
            const ok = hasCode && hasGroup;
            data.push([
                p.stok_kodu ?? '',
                p.product_name ?? '',
                p.category ?? '',
                p.purchase_price != null ? Number(p.purchase_price) : '',
                p.unit || 'Adet',
                p.barcode ?? '',
                ok ? 'Eşleşti' : 'Eksik',
            ]);
        });

        const ws = XLSX.utils.aoa_to_sheet(data);
        ws['!cols'] = [
            { wch: 16 }, // Stok Kodu
            { wch: 40 }, // Stok Adı
            { wch: 22 }, // Grubu
            { wch: 14 }, // Maliyet
            { wch: 10 }, // Birimi
            { wch: 22 }, // Barkod
            { wch: 14 }, // Durum
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Stok Kartları');
        XLSX.writeFile(wb, `stok_kartlari_${new Date().toISOString().split('T')[0]}.xlsx`);
        toast.success('Stok kartları Excel olarak indirildi.');
    };

    // --- Stok kartları: CSV/XLSX import ---
    const handleStokKartlariImport = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setStokListImporting(true);
        try {
            const ext = file.name.toLowerCase().split('.').pop();
            let rows = [];

            if (ext === 'csv') {
                const text = await file.text();
                const wb = XLSX.read(text, { type: 'string' });
                const ws = wb.Sheets[wb.SheetNames[0]];
                rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
            } else {
                const data = await file.arrayBuffer();
                const wb = XLSX.read(data, { type: 'array' });
                const ws = wb.Sheets[wb.SheetNames[0]];
                rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
            }

            if (!rows.length) {
                toast.error('Dosyada satır bulunamadı.');
                return;
            }

            let updated = 0;
            let skipped = 0;

            for (const row of rows) {
                const stokKodu = (row['Stok Kodu'] ?? '').toString().trim();
                const productName = (row['Stok Adı'] ?? '').toString().trim();
                const category = (row['Grubu'] ?? '').toString().trim();
                const unit = (row['Birimi'] ?? '').toString().trim() || 'Adet';
                const barcode = (row['Barkod'] ?? '').toString().trim();

                let purchasePrice = row['Maliyet'];
                if (typeof purchasePrice === 'string') {
                    const cleaned = purchasePrice.replace(/\./g, '').replace(',', '.');
                    const num = Number(cleaned);
                    purchasePrice = Number.isFinite(num) ? num : null;
                }

                if (!stokKodu && !productName) {
                    skipped += 1;
                    continue;
                }

                const payload = {
                    ...(productName && { product_name: productName }),
                    ...(stokKodu && { stok_kodu: stokKodu }),
                    ...(category && { category }),
                    ...(unit && { unit }),
                    ...(purchasePrice != null && { purchase_price: purchasePrice }),
                    ...(barcode && { barcode }),
                };

                if (!Object.keys(payload).length) {
                    skipped += 1;
                    continue;
                }

                if (stokKodu) {
                    const { error } = await supabase
                        .from('products')
                        .upsert({ ...payload }, { onConflict: 'stok_kodu' });
                    if (error) {
                        console.error('Stok kartı güncellenemedi:', error.message);
                        skipped += 1;
                    } else {
                        updated += 1;
                    }
                } else {
                    // stok_kodu yoksa, product_name üzerinden yumuşak eşleştirme
                    const { data: existing, error: fetchErr } = await supabase
                        .from('products')
                        .select('id')
                        .ilike('product_name', `%${productName}%`)
                        .limit(1)
                        .maybeSingle();

                    if (fetchErr) {
                        console.error('Ürün aranırken hata:', fetchErr.message);
                        skipped += 1;
                        continue;
                    }

                    if (existing?.id) {
                        const { error } = await supabase
                            .from('products')
                            .update(payload)
                            .eq('id', existing.id);
                        if (error) {
                            console.error('Stok kartı güncellenemedi:', error.message);
                            skipped += 1;
                        } else {
                            updated += 1;
                        }
                    } else {
                        // Yeni kayıt olarak ekle
                        const { error } = await supabase.from('products').insert([{ ...payload }]);
                        if (error) {
                            console.error('Stok kartı eklenemedi:', error.message);
                            skipped += 1;
                        } else {
                            updated += 1;
                        }
                    }
                }
            }

            toast.success(`Stok kartları import tamamlandı. Güncellenen/eklenen: ${updated}, atlanan: ${skipped}`);
            fetchData();
        } catch (err) {
            console.error(err);
            toast.error('Stok kartları import edilirken hata oluştu.');
        } finally {
            setStokListImporting(false);
            event.target.value = '';
        }
    };

    // --- Nutrition ingredients_rows.csv → fiyat önizleme import ---
    const handleNutritionPriceImport = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            const ext = file.name.toLowerCase().split('.').pop();
            let rows = [];

            if (ext === 'csv') {
                const text = await file.text();
                const wb = XLSX.read(text, { type: 'string' });
                const ws = wb.Sheets[wb.SheetNames[0]];
                rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
            } else {
                const data = await file.arrayBuffer();
                const wb = XLSX.read(data, { type: 'array' });
                const ws = wb.Sheets[wb.SheetNames[0]];
                rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
            }

            if (!rows.length) {
                toast.error('ingredients_rows CSV içinde satır bulunamadı.');
                return;
            }

            const productsMap = new Map();
            products.forEach(p => {
                const key = normalizeText(p.product_name);
                if (!key) return;
                if (!productsMap.has(key)) productsMap.set(key, []);
                productsMap.get(key).push(p);
            });

            const prepared = rows.map((row, index) => {
                const externalName = (row.name ?? row.Name ?? '').toString().trim();
                const unitPriceRaw = (row.unit_price ?? row.UnitPrice ?? '').toString().trim();
                const cleaned = unitPriceRaw.replace(/\./g, '').replace(',', '.');
                const num = cleaned ? Number(cleaned) : null;
                const externalPrice = Number.isFinite(num) ? num : null;

                const key = normalizeText(externalName);
                const candidates = key ? (productsMap.get(key) || []) : [];
                let matchedProductId = null;
                let matchedBy = null;
                let currentProductName = '';
                let currentPrice = null;

                if (candidates.length === 1) {
                    matchedProductId = candidates[0].id;
                    matchedBy = 'name_exact';
                    currentProductName = candidates[0].product_name;
                    currentPrice = candidates[0].purchase_price ?? null;
                }

                return {
                    rowIndex: index + 2,
                    externalId: row.id || row.ID || '',
                    externalName,
                    externalUnit: row.piece_name || row.unit || '',
                    externalPriceRaw: unitPriceRaw,
                    externalPrice,
                    matchedProductId,
                    matchedBy,
                    currentProductName,
                    currentPrice,
                    decision: matchedProductId && externalPrice != null ? 'accept' : 'pending',
                };
            });

            setPriceImportRows(prepared);
            toast.success(`Nutrition CSV içe aktarıldı. ${prepared.length} satır önizlemeye hazır.`);
        } catch (err) {
            console.error(err);
            toast.error('Nutrition CSV okunurken hata oluştu.');
        } finally {
            event.target.value = '';
        }
    };

    const updatePriceImportRow = (index, patch) => {
        setPriceImportRows(prev => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    };

    const applyNutritionPriceImport = async () => {
        const toApply = priceImportRows.filter(
            r => r.decision === 'accept' && r.matchedProductId && r.externalPrice != null
        );
        if (!toApply.length) {
            toast.error('Güncellenecek satır seçmediniz.');
            return;
        }

        setPriceImportApplying(true);
        let successCount = 0;
        let failCount = 0;

        try {
            for (const row of toApply) {
                const payload = {
                    purchase_price: row.externalPrice,
                };
                const trimmedName = (row.externalName || '').trim();
                if (trimmedName) {
                    payload.product_name = trimmedName;
                }

                const { error } = await supabase
                    .from('products')
                    .update(payload)
                    .eq('id', row.matchedProductId);

                if (error) {
                    console.error('Fiyat güncellenemedi', error);
                    failCount += 1;
                } else {
                    successCount += 1;
                }
            }

            if (successCount) {
                toast.success(`${successCount} ürünün fiyatı güncellendi.`);
                fetchData();
            }
            if (failCount) {
                toast.error(`${failCount} satır güncellenemedi, detaylar konsolda.`);
            }
        } catch (err) {
            console.error(err);
            toast.error('Fiyatlar güncellenirken genel bir hata oluştu.');
        } finally {
            setPriceImportApplying(false);
        }
    };

    // --- Barkod sorgula ---
    const handleBarcodeLookup = async () => {
        const q = (barcodeQuery || '').trim();
        if (!q) {
            toast.error('Lütfen barkod yazın.');
            return;
        }
        setBarcodeLookupLoading(true);
        setBarcodeLookupResult(null);
        setExternalLookupResult(null);
        try {
            const { data, error } = await supabase
                .from('products')
                .select('id, product_name, stok_kodu, barcode, purchase_price, unit, category')
                .eq('barcode', q)
                .maybeSingle();
            if (error) {
                toast.error('Barkod sorgusu başarısız: ' + error.message);
                return;
            }
            if (!data) {
                toast.error('Bu barkod sistemde bulunamadı. Dış API ile sorgulayabilirsiniz.');
                return;
            }
            setBarcodeLookupResult(data);
            toast.success('Ürün bulundu.');
        } catch (err) {
            toast.error('Barkod sorgulanırken hata oluştu.');
        } finally {
            setBarcodeLookupLoading(false);
        }
    };

    const handleExternalBarcodeLookup = async () => {
        const q = (barcodeQuery || '').trim();
        if (!q) {
            toast.error('Lütfen barkod yazın.');
            return;
        }
        setExternalLookupLoading(true);
        setExternalLookupResult(null);
        try {
            const params = new URLSearchParams({
                page: '0',
                size: '10',
                marketPrices: 'true',
                preferredMarkets: 'A101,�?ok Market',
                historyPrices: 'false',
                barcode: q,
            });

            const res = await fetch(`https://camgoz.jojapi.net/api/external/getProducts?${params.toString()}`, {
                method: 'GET',
                headers: {
                    'X-JoJAPI-Key': 'jk_319L4C0bQBeeH3s46ItRFbxEU1a258953HOWc4A66fgo3b3cKB9m3qb10d299abj',
                },
            });

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            const data = await res.json();

            // En iyi tahmin: liste içinden ilk ürünü al
            const item = data?.data?.[0] || data?.data?.items?.[0] || data?.items?.[0] || null;
            const name = item?.name || item?.productName || item?.product_name || null;

            if (!name) {
                toast.error('Dış API ürünü bulamadı (isim gelmedi).');
                return;
            }

            setExternalLookupResult({ name, raw: item });
            toast.success('Dış API’den ürün adı bulundu.');

            // Kolaylık: bağlama kutularını doldur
            setBarcodeBindBarcode(q);
            setBarcodeBindProductSearch(name);
        } catch (err) {
            console.error(err);
            toast.error('Dış API sorgusu başarısız.');
        } finally {
            setExternalLookupLoading(false);
        }
    };

    // --- Barkodu ürüne bağla/güncelle ---
    const handleBindBarcodeToProduct = async () => {
        const barcode = (barcodeBindBarcode || '').trim();
        const productId = (barcodeBindSelectedProductId || '').trim();
        if (!barcode) {
            toast.error('Barkod boş olamaz.');
            return;
        }
        if (!productId) {
            toast.error('Lütfen bir ürün seçin.');
            return;
        }
        setBarcodeBulkImporting(true);
        try {
            // Mevcut barkodu olan ürüne dokunma (sadece barkodsuz ürünleri güncelle)
            const { data: pData, error: pErr } = await supabase
                .from('products')
                .select('barcode')
                .eq('id', productId)
                .maybeSingle();
            if (pErr) {
                toast.error('Ürün kontrolü başarısız: ' + pErr.message);
                return;
            }
            const existingBarcode = (pData?.barcode || '').trim();
            if (existingBarcode) {
                toast.error('Bu ürünün zaten barkodu var. Mevcut barkodlara dokunmuyoruz.');
                return;
            }

            const { error } = await supabase
                .from('products')
                .update({ barcode })
                .eq('id', productId);
            if (error) {
                toast.error('Barkod bağlanamadı: ' + error.message);
                return;
            }
            toast.success('Barkod kaydedildi.');
            fetchData();
            setBarcodeBindBarcode('');
            setBarcodeBindSelectedProductId('');
            setBarcodeBindProductSearch('');
        } catch (err) {
            toast.error('Barkod kaydedilirken hata oluştu.');
        } finally {
            setBarcodeBulkImporting(false);
        }
    };

    // --- Toplu barkod import (CSV: Ürün Adı;Barkod veya Ürün Adı,Barkod) ---
    const handleBarcodeBulkImport = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setBarcodeBulkImporting(true);
        try {
            const text = await file.text();
            const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
            if (lines.length < 2) {
                toast.error('CSV boş görünüyor.');
                return;
            }
            const header = lines[0];
            const delimiter = header.includes(';') ? ';' : ',';
            const headers = header.split(delimiter).map(h => h.trim());
            const nameIdx = headers.findIndex(h => normalizeText(h) === normalizeText('Ürün Adı') || normalizeText(h) === normalizeText('Stok Adı') || normalizeText(h) === normalizeText('ExternalName'));
            const brkIdx = headers.findIndex(h => normalizeText(h) === normalizeText('Barkod') || normalizeText(h) === normalizeText('Barcode'));
            if (nameIdx === -1 || brkIdx === -1) {
                toast.error('CSV başlıkları bulunamadı. Beklenen: Ürün Adı ve Barkod');
                return;
            }

            // ürün adı → aday ürünler map'i
            const prodMap = new Map();
            products.forEach(p => {
                const key = normalizeText(p.product_name);
                if (!key) return;
                if (!prodMap.has(key)) prodMap.set(key, []);
                prodMap.get(key).push(p);
            });

            let updated = 0;
            let skipped = 0;
            let ambiguous = 0;
            let skippedAlreadyHasBarcode = 0;

            for (let i = 1; i < lines.length; i++) {
                const cols = lines[i].split(delimiter);
                const name = (cols[nameIdx] ?? '').trim().replace(/^"|"$/g, '');
                const barcode = (cols[brkIdx] ?? '').trim().replace(/^"|"$/g, '');
                if (!name || !barcode) {
                    skipped++;
                    continue;
                }
                const key = normalizeText(name);
                const candidates = prodMap.get(key) || [];
                if (candidates.length !== 1) {
                    if (candidates.length > 1) ambiguous++;
                    else skipped++;
                    continue;
                }
                const already = (candidates[0].barcode || '').trim();
                if (already) {
                    skippedAlreadyHasBarcode++;
                    continue;
                }
                const productId = candidates[0].id;
                const { error } = await supabase.from('products').update({ barcode }).eq('id', productId);
                if (error) {
                    skipped++;
                } else {
                    updated++;
                }
            }

            toast.success(`Toplu barkod import bitti. Güncellenen: ${updated}, atlanan: ${skipped}, çoklu eşleşme: ${ambiguous}, barkodu olan atlandı: ${skippedAlreadyHasBarcode}`);
            fetchData();
        } catch (err) {
            console.error(err);
            toast.error('Toplu barkod import sırasında hata oluştu.');
        } finally {
            setBarcodeBulkImporting(false);
            event.target.value = '';
        }
    };

    // --------------- ADD FORMS ---------------
    const handleAddBranch = async (e) => {
        e.preventDefault();
        if (!newBranchName || !newUsername || !newPassword) return;

        setIsLoading(true);
        try {
            const { error } = await supabase.from('branches').insert([{
                branch_name: newBranchName,
                username: newUsername,
                password_hash: newPassword
            }]);

            if (error) {
                toast.error("Hata: " + error.message);
            } else {
                setNewBranchName(''); setNewUsername(''); setNewPassword('');
                fetchData();
            }
        } catch (err) {
            if (err?.name === 'TypeError' && err?.message?.toLowerCase().includes('fetch')) {
                toast.error(
                    "Bağlantı hatası: Supabase ayarlarını kontrol edin. .env.local dosyasında VITE_SUPABASE_URL ve VITE_SUPABASE_ANON_KEY yeni projenize göre dolu mu? Değişiklikten sonra uygulamayı yeniden başlatın."
                );
            } else {
                toast.error("Hata: " + (err?.message || String(err)));
            }
        }
        setIsLoading(false);
    };

    const handleAddProduct = async (e) => {
        e.preventDefault();
        if (!newProductName || !newPurchasePrice) return;

        setIsLoading(true);
        const { error } = await supabase.from('products').insert([{
            product_name: newProductName,
            stok_kodu: newStokKodu.trim() || null,
            barcode: newBarcode || null,
            purchase_price: parseFloat(newPurchasePrice) || 0,
            current_stock: parseFloat(newCurrentStock) || 0,
            category: newCategory || null,
            unit: newUnit
        }]);

        if (error) {
            toast.error("Ürün Ekleme Hatası: " + error.message);
        } else {
            toast.success("Ürün eklendi!");
            setNewProductName(''); setNewStokKodu(''); setNewBarcode(''); setNewPurchasePrice(''); setNewCurrentStock(''); setNewCategory(''); setNewUnit('Adet');
            fetchData();
        }
        setIsLoading(false);
    };

    const openEditModal = (product) => {
        setEditingProduct(product);
        setEditProductName(product.product_name);
        setEditStokKodu(product.stok_kodu || '');
        setEditBarcode(product.barcode || '');
        setEditPurchasePrice(product.purchase_price || 0);
        setEditCurrentStock(product.current_stock || 0);
        setEditCategory(product.category || '');
        setEditUnit(product.unit || 'Adet');
        setEditPiecesPerPackage(product.pieces_per_package != null && product.pieces_per_package !== '' ? String(product.pieces_per_package) : '');
        setEditLitersPerUnit(product.liters_per_unit != null && product.liters_per_unit !== '' ? String(product.liters_per_unit) : '');
    };

    const handleUpdateProduct = async (e) => {
        e.preventDefault();
        setIsLoading(true);
        const ppp = (editPiecesPerPackage || '').trim();
        const lpu = (editLitersPerUnit || '').trim();
        const payload = {
            product_name: editProductName,
            stok_kodu: editStokKodu.trim() || null,
            barcode: editBarcode || null,
            purchase_price: parseFloat(editPurchasePrice) || 0,
            current_stock: parseFloat(editCurrentStock) || 0,
            category: editCategory || null,
            unit: editUnit,
        };
        if (ppp !== '') payload.pieces_per_package = parseFloat(ppp.replace(',', '.'));
        else payload.pieces_per_package = null;
        if (lpu !== '') payload.liters_per_unit = parseFloat(lpu.replace(',', '.'));
        else payload.liters_per_unit = null;

        const { error } = await supabase.from('products').update(payload).eq('id', editingProduct.id);

        if (error) {
            toast.error("Güncelleme Hatası: " + error.message);
        } else {
            toast.success("Ürün başarıyla güncellendi!");
            setShowSavedOnButton(true);
            setTimeout(() => setShowSavedOnButton(false), 1500);
            setEditingProduct(null);
            fetchData();
        }
        setIsLoading(false);
    };

    const handleDeleteProduct = async (product) => {
        if (!confirm(`"${product.product_name || product.stok_kodu || 'Bu ürün'}" stok kartını silmek istediğinize emin misiniz? İlişkili sayım kayıtları da etkilenebilir.`)) return;
        setIsLoading(true);
        const { error } = await supabase.from('products').delete().eq('id', product.id);
        if (error) {
            toast.error('Ürün silinemedi: ' + error.message);
        } else {
            toast.success('Stok kartı silindi.');
            setEditingProduct(null);
            fetchData();
        }
        setIsLoading(false);
    };

    const handleAddCategory = async (e) => {
        e.preventDefault();
        const name = newCategoryName.trim();
        if (!name) return;
        setIsLoading(true);
        const { error } = await supabase.from('categories').insert([{ name }]);
        if (error) {
            toast.error('Kategori eklenemedi: ' + error.message);
        } else {
            toast.success('Kategori eklendi.');
            setNewCategoryName('');
            fetchData();
        }
        setIsLoading(false);
    };

    const handleDeleteCategory = async (id) => {
        if (!confirm('Bu kategoriyi silmek istediğinize emin misiniz? Ürünlerdeki kategori metni değişmez.')) return;
        const { error } = await supabase.from('categories').delete().eq('id', id);
        if (error) toast.error('Silinemedi: ' + error.message);
        else {
            toast.success('Kategori silindi.');
            fetchData();
        }
    };

    // CSV import: A=Stok Kodu, B=Stok Adı, C=Grubu, D=Birimi (ayırıcı ;)
    const handleCsvImport = async (e) => {
        const file = e?.target?.files?.[0];
        if (!file) return;
        setCsvImporting(true);
        try {
            const text = await new Promise((res, rej) => {
                const r = new FileReader();
                r.onload = () => res(r.result);
                r.onerror = rej;
                r.readAsText(file, 'UTF-8');
            });
            const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            const rows = [];
            for (let i = 0; i < lines.length; i++) {
                const parts = lines[i].split(';').map(p => (p || '').trim());
                if (parts[0]?.toUpperCase() === 'STOK KODU' && parts[1]?.toUpperCase() === 'STOK ADI') continue; // header
                const stokKodu = parts[0] || '';
                const stokAdi = parts[1] || '';
                const grubu = (parts[2] || '').trim();
                const birimi = ((parts[3] || 'ADET').toString().trim().toUpperCase()) || 'ADET';
                if (!stokKodu || !stokAdi) continue;
                rows.push({ stokKodu, stokAdi, grubu, birimi });
            }
            if (rows.length === 0) {
                toast.error('CSV\'de geçerli satır yok. Sütunlar: Stok Kodu;Stok Adı;Grubu;Birimi (ayırıcı ;)');
                setCsvImporting(false);
                return;
            }
            const categoryNames = [...new Set(rows.map(r => r.grubu).filter(Boolean))];
            const existingCatNames = (categories.length ? categories.map(c => c.name) : (await supabase.from('categories').select('name')).data?.map(c => c.name)) || [];
            for (const name of categoryNames) {
                if (name && !existingCatNames.includes(name)) {
                    await supabase.from('categories').insert([{ name }]);
                    existingCatNames.push(name);
                }
            }
            const byStokKodu = {};
            products.forEach(p => { if (p.stok_kodu && !byStokKodu[p.stok_kodu]) byStokKodu[p.stok_kodu] = p; });
            let inserted = 0, updated = 0;
            for (const row of rows) {
                const existing = byStokKodu[row.stokKodu];
                if (existing) {
                    const { error } = await supabase.from('products').update({
                        product_name: row.stokAdi,
                        category: row.grubu || null,
                        unit: row.birimi
                    }).eq('id', existing.id);
                    if (!error) updated++;
                } else {
                    const { data: newProd, error } = await supabase.from('products').insert([{
                        stok_kodu: row.stokKodu,
                        product_name: row.stokAdi,
                        category: row.grubu || null,
                        unit: row.birimi,
                        purchase_price: 0,
                        current_stock: 0
                    }]).select('id, stok_kodu').single();
                    if (!error && newProd) {
                        inserted++;
                        byStokKodu[newProd.stok_kodu] = newProd;
                    }
                }
            }
            toast.success(`CSV içe aktarıldı: ${inserted} yeni, ${updated} güncellendi.`);
            fetchData();
        } catch (err) {
            toast.error('CSV okunamadı: ' + (err?.message || String(err)));
        }
        setCsvImporting(false);
        e.target.value = '';
    };

    // Excel/CSV import: şube-ürün eşleşmelerini branch_stocks'a yazar.
    // Desteklenen iki format:
    // 1) Satır bazlı: �?ube | Stok Kodu (veya Ürün) | Miktar
    // 2) Geniş: Stok Kodu | Ürün ... | [�?ube Adı sütunları]
    const handleBranchProductMapImport = async (e) => {
        const file = e?.target?.files?.[0];
        if (!file) return;
        setBranchMapImporting(true);
        try {
            const buf = await file.arrayBuffer();
            const wb = XLSX.read(buf, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
            if (!rows.length) {
                toast.error('Dosya boş görünüyor.');
                return;
            }

            const header = (rows[0] || []).map(h => String(h || '').trim());
            const normHeader = header.map(h => normalizeText(h));
            const dataRows = rows.slice(1);

            const branchByNorm = new Map(branches.map(b => [normalizeText(b.branch_name), b]));
            const branchColByIdx = new Map();
            for (let i = 0; i < normHeader.length; i++) {
                const matched = branches.find(b => normalizeText(b.branch_name) === normHeader[i]);
                if (matched) branchColByIdx.set(i, matched.id);
            }

            const findCol = (aliases) => normHeader.findIndex(h => aliases.includes(h));
            const branchCol = findCol(['sube', 'şube', 'sube adi', 'şube adı', 'magaza', 'mağaza']);
            const stokKoduCol = findCol(['stok kodu', 'stokkodu', 'stok']);
            const urunCol = findCol(['stok adi', 'stok adı', 'urun', 'ürün', 'urun adi', 'ürün adı']);
            const miktarCol = findCol([
                'miktar',
                'adet',
                'qty',
                'quantity',
                'stok miktari',
                'stok miktarı',
                'sayilan stok',
                'sayılan stok',
                'sube sistemi stok',
                'şube sistemi stok',
            ]);

            const productByStokKodu = new Map();
            const productByName = new Map();
            products.forEach(p => {
                if (p.stok_kodu) productByStokKodu.set(String(p.stok_kodu).trim().toUpperCase(), p);
                if (p.product_name) productByName.set(normalizeText(p.product_name), p);
            });

            const upsertMap = new Map();
            let skippedMissingProduct = 0;
            let skippedMissingBranch = 0;

            const mergeBsRow = (bid, pid, qty) => {
                const ex = branchStocks.find(r => r.branch_id === bid && r.product_id === pid);
                return { branch_id: bid, product_id: pid, quantity: qty, unit_cost: ex?.unit_cost ?? null };
            };

            const resolveProduct = (r) => {
                const rawSk = stokKoduCol >= 0 ? String(r[stokKoduCol] || '').trim() : '';
                const rawName = urunCol >= 0 ? String(r[urunCol] || '').trim() : '';
                if (rawSk) return productByStokKodu.get(rawSk.toUpperCase()) || null;
                if (rawName) return productByName.get(normalizeText(rawName)) || null;
                return null;
            };

            const parseQty = (v) => {
                const n = parseFlexibleNumber(v);
                return n == null ? 0 : n;
            };

            const hasWideBranchCols = branchColByIdx.size > 0;

            for (const r of dataRows) {
                const product = resolveProduct(r);
                if (!product) {
                    skippedMissingProduct++;
                    continue;
                }

                if (hasWideBranchCols) {
                    for (const [colIdx, bid] of branchColByIdx.entries()) {
                        const cell = r[colIdx];
                        const hasValue = String(cell ?? '').trim() !== '';
                        if (!hasValue) continue;
                        const qty = parseQty(cell);
                        upsertMap.set(`${bid}|${product.id}`, mergeBsRow(bid, product.id, qty));
                    }
                    continue;
                }

                let bid = stockEntryBranchId || '';
                if (branchCol >= 0) {
                    const branchRaw = String(r[branchCol] || '').trim();
                    const exact = branchByNorm.get(normalizeText(branchRaw));
                    bid = exact?.id || '';
                }
                if (!bid) {
                    skippedMissingBranch++;
                    continue;
                }

                const qty = miktarCol >= 0 ? parseQty(r[miktarCol]) : 0;
                upsertMap.set(`${bid}|${product.id}`, mergeBsRow(bid, product.id, qty));
            }

            const payload = [...upsertMap.values()];
            if (!payload.length) {
                toast.error('İçe aktarılacak eşleşme bulunamadı.');
                return;
            }

            for (let i = 0; i < payload.length; i += 500) {
                const chunk = payload.slice(i, i + 500);
                const { error } = await supabase
                    .from('branch_stocks')
                    .upsert(chunk, { onConflict: 'branch_id,product_id' });
                if (error) {
                    toast.error('�?ube ürün eşleştirmesi yazılamadı: ' + error.message);
                    return;
                }
            }

            toast.success(`�?ube-ürün eşleşmesi tamamlandı. Yazılan: ${payload.length}, ürün bulunamayan: ${skippedMissingProduct}, şube bulunamayan: ${skippedMissingBranch}`);
            fetchData();
        } catch (err) {
            toast.error('Excel/CSV import sırasında hata oluştu: ' + (err?.message || String(err)));
        } finally {
            setBranchMapImporting(false);
            e.target.value = '';
        }
    };

    /**
     * URUNISMISUBEMALIYET.csv — şube + maliyet; ürün satırı Supabase’deki products ile eşlenir (bellekteki liste).
     * Eşleşme sırası: Stok Kodu (tam) → Barkod (tam) → Ürün Adı (mevcut mantık).
     * Supabase’den export (stok_kodu, barcode, product_name) içeren CSV önerilir; sayımda barkod aynı product_id’ye gider.
     */
    const handleUrunIsmSubeMaliyetCsvImport = async (e) => {
        const file = e?.target?.files?.[0];
        if (!file) return;
        setUrunSubeMaliyetImporting(true);
        try {
            const text = await file.text();
            const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            if (lines.length < 2) {
                toast.error('CSV boş veya yetersiz.');
                return;
            }
            const headerParts = lines[0].split(';').map(p => (p || '').trim());
            const hFold = headerParts.map(h => asciiFoldKey(h));
            const hasSube = hFold.some(h => h === 'sube' || h.startsWith('sube '));
            const hasMaliyet = hFold.some(h => h.includes('maliyet') || (h.includes('birim') && (h.includes('tl') || h.includes('maliyet'))));
            const hasUrunAd = hFold.some(h => h.includes('urun') && h.includes('ad'));
            const hasStokKod = hFold.some(h => (h.includes('stok') && h.includes('kod')) || h === 'stokkodu');
            const hasBarkodCol = hFold.some(h => h.includes('barkod') || h === 'barcode' || h.includes('ean') || h.includes('gtin'));
            const isUrunSubeMaliyet = headerParts.length >= 3 && hasSube && hasMaliyet && (hasUrunAd || hasStokKod || hasBarkodCol);
            if (!isUrunSubeMaliyet) {
                toast.error('En az: �?ube + Birim Maliyet + (Ürün Adı veya Stok Kodu veya Barkod). Ayırıcı ;');
                return;
            }
            const colUrun = hFold.findIndex(h => h.includes('urun') && h.includes('ad'));
            const colSube = hFold.findIndex(h => h === 'sube' || /^sube\b/.test(h));
            const colStok = hFold.findIndex(h => (h.includes('stok') && h.includes('kod')) || h === 'stokkodu');
            const colBarkod = hFold.findIndex(h => h.includes('barkod') || h === 'barcode' || h.includes('ean') || h.includes('gtin'));
            if (colSube < 0) {
                toast.error('�?ube sütunu bulunamadı.');
                return;
            }
            if (colUrun < 0 && colStok < 0 && colBarkod < 0) {
                toast.error('Ürün için en az bir sütun gerekli: Ürün Adı, Stok Kodu veya Barkod.');
                return;
            }
            const colMaliyet = hFold.findIndex(h => h.includes('maliyet') || (h.includes('birim') && (h.includes('tl') || h.includes('maliyet'))));

            const normalizeBarcodeCsv = (raw) => {
                const s = String(raw ?? '').trim();
                if (!s) return '';
                return s.replace(/\s+/g, '');
            };

            const parseMoney = (v) => {
                return parseFlexibleNumber(v);
            };

            const matchBranchCsv = (csvName) => {
                const raw = String(csvName || '').trim();
                if (!raw) return null;
                const n = normalizeText(raw);
                const a = asciiFoldKey(raw);
                const byNorm = branches.find(b => normalizeText(b.branch_name) === n);
                if (byNorm) return byNorm;
                const byFold = branches.find(b => asciiFoldKey(b.branch_name) === a);
                if (byFold) return byFold;
                return branches.find(b => {
                    const bn = normalizeText(b.branch_name);
                    const bf = asciiFoldKey(b.branch_name);
                    return bn.includes(n) || n.includes(bn) || bf.includes(a) || a.includes(bf);
                }) || null;
            };

            const productsByNorm = new Map();
            products.forEach(p => {
                const k = normalizeText(p.product_name);
                if (!k) return;
                if (!productsByNorm.has(k)) productsByNorm.set(k, []);
                productsByNorm.get(k).push(p);
            });

            const productByStokUpper = new Map();
            const stokKoduDuplicate = new Set();
            products.forEach((p) => {
                const sk = String(p.stok_kodu || '').trim().toUpperCase();
                if (!sk) return;
                if (productByStokUpper.has(sk)) stokKoduDuplicate.add(sk);
                else productByStokUpper.set(sk, p);
            });

            const barcodeToProductList = new Map();
            products.forEach((p) => {
                const b = normalizeBarcodeCsv(p.barcode);
                if (!b) return;
                if (!barcodeToProductList.has(b)) barcodeToProductList.set(b, []);
                barcodeToProductList.get(b).push(p);
            });

            const resolveProductFromCsvName = (csvName) => {
                const raw = String(csvName || '').trim();
                if (!raw) return { product: null, reason: 'empty' };
                const k = normalizeText(raw);
                const exactList = productsByNorm.get(k);
                if (exactList?.length === 1) return { product: exactList[0], reason: null };
                if (exactList?.length > 1) return { product: null, reason: 'ambiguous_name' };
                const candidates = products.filter(p => {
                    const pn = normalizeText(p.product_name);
                    return pn.includes(k) || k.includes(pn);
                });
                if (candidates.length === 1) return { product: candidates[0], reason: null };
                if (candidates.length > 1) return { product: null, reason: 'ambiguous_partial' };
                return { product: null, reason: 'not_found' };
            };

            const resolveProductFromCsvRow = (parts) => {
                const skRaw = colStok >= 0 ? String(parts[colStok] ?? '').trim() : '';
                const bcRaw = colBarkod >= 0 ? String(parts[colBarkod] ?? '').trim() : '';
                const nameRaw = colUrun >= 0 ? String(parts[colUrun] ?? '').trim() : '';

                if (skRaw) {
                    const sk = skRaw.toUpperCase();
                    if (stokKoduDuplicate.has(sk)) return { product: null, reason: 'ambiguous_stok' };
                    const byStok = productByStokUpper.get(sk);
                    if (byStok) return { product: byStok, reason: null };
                    return { product: null, reason: 'stok_not_found' };
                }

                const bc = normalizeBarcodeCsv(bcRaw);
                if (bc) {
                    const list = barcodeToProductList.get(bc);
                    if (list?.length === 1) return { product: list[0], reason: null };
                    if (list && list.length > 1) return { product: null, reason: 'ambiguous_barcode' };
                }

                if (nameRaw) return resolveProductFromCsvName(nameRaw);
                return { product: null, reason: 'empty' };
            };

            const existingQty = new Map();
            branchStocks.forEach(bs => {
                existingQty.set(`${bs.branch_id}|${bs.product_id}`, Number(bs.quantity) || 0);
            });

            const upsertMap = new Map();
            let skippedMissingProduct = 0;
            let skippedMissingBranch = 0;
            let skippedAmbiguous = 0;
            let skippedStokNotFound = 0;

            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split(';').map(p => (p || '').trim());
                const subeRaw = parts[colSube] ?? '';
                const branch = matchBranchCsv(subeRaw);
                if (!branch) {
                    skippedMissingBranch++;
                    continue;
                }
                const { product, reason } = resolveProductFromCsvRow(parts);
                if (!product) {
                    if (reason === 'ambiguous_name' || reason === 'ambiguous_partial' || reason === 'ambiguous_stok' || reason === 'ambiguous_barcode') skippedAmbiguous++;
                    else if (reason === 'stok_not_found') skippedStokNotFound++;
                    else skippedMissingProduct++;
                    continue;
                }
                const key = `${branch.id}|${product.id}`;
                const qty = existingQty.has(key) ? existingQty.get(key) : 0;
                const maliyetRaw = colMaliyet >= 0 ? parts[colMaliyet] : '';
                const existingRow = branchStocks.find(bs => bs.branch_id === branch.id && bs.product_id === product.id);
                let unit_cost = null;
                const parsedCost = parseMoney(maliyetRaw);
                if (parsedCost != null) unit_cost = parsedCost;
                else if (existingRow?.unit_cost != null && existingRow.unit_cost !== '' && Number.isFinite(Number(existingRow.unit_cost))) {
                    unit_cost = Number(existingRow.unit_cost);
                }
                upsertMap.set(key, { branch_id: branch.id, product_id: product.id, quantity: qty, unit_cost });
            }

            const payload = [...upsertMap.values()];
            if (!payload.length) {
                toast.error(
                    'Eşleşen satır yok. �?ube adlarını kontrol edin; ürünler için Supabase’deki stok kodu / barkod / ad ile CSV sütunlarını eşleştirin (tercihen DB export).',
                );
                return;
            }

            for (let i = 0; i < payload.length; i += 500) {
                const chunk = payload.slice(i, i + 500);
                const { error } = await supabase
                    .from('branch_stocks')
                    .upsert(chunk, { onConflict: 'branch_id,product_id' });
                if (error) {
                    toast.error('branch_stocks yazılamadı: ' + error.message);
                    return;
                }
            }

            const stokPart = skippedStokNotFound > 0 ? `, stok kodu DB’de yok: ${skippedStokNotFound}` : '';
            toast.success(
                `URUNISMISUBEMALIYET: ${payload.length} şube-ürün satırı yazıldı (stok + birim maliyet). ` +
                `Ürün bulunamayan: ${skippedMissingProduct}, şube bulunamayan: ${skippedMissingBranch}, çoklu/çakışan: ${skippedAmbiguous}${stokPart}. ` +
                `Eşleşen kayıtlar products.id ile bağlanır; barkod okutunca aynı ürün gelir.`
            );
            fetchData();
        } catch (err) {
            toast.error('CSV okunamadı: ' + (err?.message || String(err)));
        } finally {
            setUrunSubeMaliyetImporting(false);
            e.target.value = '';
        }
    };

    const approvalFullscreenModal = (() => {
        if (!showApprovalFullscreen) return null;
        const appliedCounts = filteredCounts.filter(c => {
            if (!productSearch) return true;
            return c.products?.product_name?.toLowerCase().includes(productSearch.toLowerCase());
        }).filter(c => {
            if (!onlyMissingBarcode) return true;
            const brk = (c.products?.barcode || '').trim();
            return !brk;
        });
        return (
            <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-izbel-card w-full max-w-6xl max-h-[90vh] rounded-[2rem] border border-white/10 shadow-2xl flex flex-col overflow-hidden">
                    <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
                        <div>
                            <h2 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
                                <CheckCircle2 className="text-green-500" /> Ürün Sayım Onay Listesi
                            </h2>
                            <p className="text-xs text-gray-400 mt-1">
                                {selectedBranchId === 'ALL' ? 'Tüm şubeler' : branches.find(b => b.id === selectedBranchId)?.branch_name} ·{' '}
                                {selectedPeriodId === 'ALL' ? 'Tüm dönemler' : periods.find(p => p.id === selectedPeriodId)?.period_name}
                            </p>
                        </div>
                        <div className="flex items-center gap-3">
                            <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-gray-400 bg-white/5 border border-white/10 px-3 py-2 rounded-xl">
                                <input
                                    type="checkbox"
                                    checked={onlyMissingBarcode}
                                    onChange={(e) => setOnlyMissingBarcode(e.target.checked)}
                                    className="rounded accent-amber-500"
                                />
                                Sadece barkodsuzlar
                            </label>
                            {selectedRecords.length > 0 && (
                                <>
                                    <button
                                        onClick={handleBulkSetDraft}
                                        disabled={isLoading}
                                        className="bg-amber-500 hover:bg-amber-400 text-black font-bold py-2 px-4 rounded-xl text-xs uppercase tracking-widest"
                                    >
                                        Taslak Yap ({selectedRecords.length})
                                    </button>
                                    <button
                                        onClick={handleDeleteSelected}
                                        disabled={isLoading}
                                        className="bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-4 rounded-xl text-xs uppercase tracking-widest"
                                    >
                                        Sil ({selectedRecords.length})
                                    </button>
                                </>
                            )}
                            <button
                                type="button"
                                onClick={() => setShowApprovalFullscreen(false)}
                                className="bg-white/5 hover:bg-white/10 text-gray-300 px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-widest"
                            >
                                Kapat
                            </button>
                        </div>
                    </div>
                    <div className="flex-1 overflow-auto">
                        <table className="w-full text-left border-collapse">
                            <thead className="sticky top-0 bg-izbel-dark/95 border-b border-white/10 z-10">
                                <tr>
                                    <th className="p-3 w-10 text-center">
                                        <input
                                            type="checkbox"
                                            className="w-4 h-4 rounded cursor-pointer accent-blue-500"
                                            checked={appliedCounts.length > 0 && selectedRecords.length === appliedCounts.length}
                                            onChange={(e) => {
                                                if (e.target.checked) {
                                                    setSelectedRecords(appliedCounts.map(c => c.id));
                                                } else {
                                                    setSelectedRecords([]);
                                                }
                                            }}
                                        />
                                    </th>
                                    <th className="p-3 text-xs font-bold text-gray-500 uppercase tracking-widest">Ürün</th>
                                    <th className="p-3 text-xs font-bold text-gray-500 uppercase tracking-widest">�?ube & Dönem</th>
                                    <th className="p-3 text-xs font-bold text-gray-500 uppercase tracking-widest min-w-[140px]">İlk / Son (İstanbul)</th>
                                    <th className="p-3 text-xs font-bold text-gray-500 uppercase tracking-widest text-center">�?ube sistemi stok</th>
                                    <th className="p-3 text-xs font-bold text-blue-400 uppercase tracking-widest text-center">Sayılan</th>
                                    <th className="p-3 text-xs font-bold text-gray-500 uppercase tracking-widest text-right">Fark</th>
                                    <th className="p-3 text-xs font-bold text-gray-500 uppercase tracking-widest text-center">Onay</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {appliedCounts.map(c => {
                                    const bName = branches.find(b => b.id === c.branch_id)?.branch_name || 'Bilinmiyor';
                                    const pName = periods.find(p => p.id === c.period_id)?.period_name || 'Dönemsiz';
                                    const times = formatIstanbulCountTimes(c);
                                    const sys = sysStockForCount(c);
                                    const count = c.counted_stock;
                                    const diff = count - sys;
                                    const price = unitCostForCount(c);
                                    const valDiff = diff * price;
                                    const isApproved = c.status === 'approved';
                                    return (
                                        <tr key={c.id} className={`hover:bg-white/[0.03] transition-colors ${isApproved ? 'opacity-60' : ''}`}>
                                            <td className="p-3 text-center">
                                                <input
                                                    type="checkbox"
                                                    className="w-4 h-4 rounded cursor-pointer accent-blue-500"
                                                    checked={selectedRecords.includes(c.id)}
                                                    onChange={(e) => {
                                                        if (e.target.checked) {
                                                            setSelectedRecords(prev => [...prev, c.id]);
                                                        } else {
                                                            setSelectedRecords(prev => prev.filter(id => id !== c.id));
                                                        }
                                                    }}
                                                />
                                            </td>
                                            <td className="p-3">
                                                <div className="font-bold text-white mb-1">{c.products?.product_name || 'Bilinmeyen Ürün'}</div>
                                                <div className="text-xs text-gray-500 flex items-center gap-2">
                                                    <span className="font-mono bg-white/5 px-2 py-0.5 rounded border border-white/10">
                                                        BRK: {c.products?.barcode || 'YOK'}
                                                    </span>
                                                    <span className="font-mono bg-white/5 px-2 py-0.5 rounded border border-white/10">
                                                        B.Fiyat: {price} ₺
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="p-3 text-xs text-gray-300">
                                                <div className="font-bold">{bName}</div>
                                                <div className="text-[10px] text-gray-500 uppercase tracking-widest">{pName}</div>
                                            </td>
                                            <td className="p-3 text-[10px] text-cyan-200/90 font-mono leading-snug">
                                                <div>İlk: {times.first}</div>
                                                <div>Son: {times.last}</div>
                                            </td>
                                            <td className="p-3 text-center font-mono text-sm text-gray-400">
                                                {sys} <span className="text-xs text-gray-600 ml-1 font-sans">{c.products?.unit || 'Adet'}</span>
                                            </td>
                                            <td className="p-3 text-center font-mono text-sm text-blue-400 bg-blue-500/5">
                                                {count} <span className="text-xs text-blue-500/70 ml-1 font-sans">{c.products?.unit || 'Adet'}</span>
                                            </td>
                                            <td className="p-3 text-right font-mono text-sm">
                                                <div className={`font-black ${diff < 0 ? 'text-red-500' : diff > 0 ? 'text-green-500' : 'text-gray-500'}`}>
                                                    {diff > 0 ? '+' : ''}{diff}{' '}
                                                    <span className="text-[10px] font-sans font-bold opacity-60 ml-1">{c.products?.unit || 'Adet'}</span>
                                                </div>
                                                <div className={`text-[11px] font-bold mt-1 ${valDiff < 0 ? 'text-red-400/90' : valDiff > 0 ? 'text-green-400/90' : 'text-gray-500'}`}>
                                                    {valDiff > 0 ? '+' : ''}{valDiff.toLocaleString('tr-TR')} ₺
                                                </div>
                                            </td>
                                            <td className="p-3 text-center">
                                                {isApproved ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRevertApproval(c.id)}
                                                        className="text-xs font-bold text-green-400 bg-green-500/10 border border-green-500/40 px-3 py-1 rounded-xl uppercase tracking-widest"
                                                    >
                                                        Onaylı (Geri Al)
                                                    </button>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleApproveCount(c.id, c.product_id, count, c.branch_id)}
                                                        className="text-xs font-bold text-blue-100 bg-blue-600 border border-blue-500/60 px-3 py-1 rounded-xl uppercase tracking-widest"
                                                    >
                                                        Onayla
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {appliedCounts.length === 0 && (
                                    <tr>
                                        <td colSpan={7} className="p-6 text-center text-gray-500 text-sm font-bold uppercase tracking-widest">
                                            Bu filtrelerle kayıt bulunamadı.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        );
    })();

    return (
        <div className="min-h-screen bg-izbel-dark text-white font-sans selection:bg-blue-900 selection:text-white pb-20">
            <Toaster position="top-right" />
            {approvalFullscreenModal}
            {salesPreviewOpen && salesPreview && (() => {
                const rows = salesPreview.rows || [];
                const decisions = salesPreview.decisions || {};
                const activeTab = salesPreview.activeTab || 'missing';
                const searchText = (salesPreview.searchText || '').trim().toLowerCase();

                const setDecision = (idx, patch) => {
                    setSalesPreview((prev) => {
                        if (!prev) return prev;
                        const cur = prev.decisions[idx] || {};
                        return { ...prev, decisions: { ...prev.decisions, [idx]: { ...cur, ...patch } } };
                    });
                };
                const bulkSetDecisions = (filterFn, patch) => {
                    setSalesPreview((prev) => {
                        if (!prev) return prev;
                        const next = { ...prev.decisions };
                        prev.rows.forEach((r) => {
                            if (filterFn(r)) {
                                next[r.idx] = { ...(next[r.idx] || {}), ...patch };
                            }
                        });
                        return { ...prev, decisions: next };
                    });
                };

                // Sekmelere göre satırları ayır
                const matchedRows = rows.filter((r) => r.product && r.confidence >= 90);
                const reviewRows = rows.filter((r) => r.product && r.confidence < 90);
                const missingRows = rows.filter((r) => !r.product);

                const tabRows = activeTab === 'matched' ? matchedRows
                    : activeTab === 'review' ? reviewRows
                    : missingRows;

                const visibleRows = !searchText ? tabRows : tabRows.filter((r) => {
                    const s = searchText;
                    return (
                        (r.name || '').toLowerCase().includes(s)
                        || (r.stok_kodu || '').toLowerCase().includes(s)
                        || (r.product?.product_name || '').toLowerCase().includes(s)
                    );
                });

                // Özet rakamlar
                const counts = {
                    keep: Object.values(decisions).filter((d) => d?.action === 'keep' || d?.action === 'review-keep').length,
                    create: Object.values(decisions).filter((d) => d?.action === 'create').length,
                    mapTo: Object.values(decisions).filter((d) => d?.action === 'map-to').length,
                    skip: Object.values(decisions).filter((d) => d?.action === 'skip').length,
                };
                const totalQty = rows.reduce((s, r) => {
                    const d = decisions[r.idx];
                    if (!d || d.action === 'skip') return s;
                    return s + (Number(r.qty) || 0);
                }, 0);

                const confBadge = (c) => {
                    if (c >= 100) return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
                    if (c >= 90) return 'bg-green-500/20 text-green-300 border-green-500/40';
                    if (c >= 70) return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
                    return 'bg-red-500/20 text-red-300 border-red-500/40';
                };

                return (
                    <div className="fixed inset-0 z-[260] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                        <div className="bg-izbel-card w-full max-w-[1200px] max-h-[94vh] rounded-[1.5rem] border border-blue-500/30 shadow-2xl overflow-hidden flex flex-col">
                            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-4">
                                <div>
                                    <h3 className="text-lg font-black text-white">Satış İçe Aktarma - Önizleme & Onay</h3>
                                    <p className="text-xs text-gray-400 mt-1">
                                        Dosya: <span className="font-mono text-blue-300">{salesPreview.fileName}</span> |
                                        Şube: <span className="text-blue-300 font-bold">{salesPreview.branchName}</span> |
                                        Toplam <span className="text-white font-bold">{rows.length}</span> satır
                                    </p>
                                </div>
                                <button
                                    onClick={() => { setSalesPreviewOpen(false); setSalesPreview(null); }}
                                    className="text-gray-400 hover:text-white text-2xl leading-none"
                                >×</button>
                            </div>

                            {/* Özet Kartları */}
                            <div className="px-5 py-3 border-b border-white/10 grid grid-cols-2 md:grid-cols-5 gap-2 bg-black/20">
                                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-2">
                                    <div className="text-[10px] uppercase tracking-wider text-emerald-300">✅ Tam Eşleşen</div>
                                    <div className="text-xl font-black text-emerald-200">{matchedRows.length}</div>
                                </div>
                                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-2">
                                    <div className="text-[10px] uppercase tracking-wider text-amber-300">⚠ Gözden Geçir</div>
                                    <div className="text-xl font-black text-amber-200">{reviewRows.length}</div>
                                </div>
                                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2">
                                    <div className="text-[10px] uppercase tracking-wider text-red-300">🔴 Eksik</div>
                                    <div className="text-xl font-black text-red-200">{missingRows.length}</div>
                                </div>
                                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-2">
                                    <div className="text-[10px] uppercase tracking-wider text-blue-300">Yeni Oluştur</div>
                                    <div className="text-xl font-black text-blue-200">{counts.create}</div>
                                </div>
                                <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-2">
                                    <div className="text-[10px] uppercase tracking-wider text-purple-300">Toplam Miktar</div>
                                    <div className="text-xl font-black text-purple-200">{totalQty.toLocaleString('tr-TR')}</div>
                                </div>
                            </div>

                            {/* Sekmeler */}
                            <div className="px-5 pt-3 border-b border-white/10 flex items-end gap-1 bg-black/10">
                                {[
                                    { key: 'missing', label: `🔴 Eksik (${missingRows.length})`, cls: 'border-red-500/60 text-red-200' },
                                    { key: 'review', label: `⚠ Gözden Geçir (${reviewRows.length})`, cls: 'border-amber-500/60 text-amber-200' },
                                    { key: 'matched', label: `✅ Tam Eşleşen (${matchedRows.length})`, cls: 'border-emerald-500/60 text-emerald-200' },
                                ].map((t) => (
                                    <button
                                        key={t.key}
                                        onClick={() => setSalesPreview((prev) => ({ ...prev, activeTab: t.key }))}
                                        className={`px-4 py-2 rounded-t-lg text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${activeTab === t.key ? t.cls + ' bg-white/5' : 'border-transparent text-gray-400 hover:text-white'}`}
                                    >
                                        {t.label}
                                    </button>
                                ))}
                                <div className="ml-auto flex items-center gap-2 pb-2">
                                    <input
                                        type="text"
                                        placeholder="Ara: isim / stok kodu..."
                                        value={salesPreview.searchText || ''}
                                        onChange={(e) => setSalesPreview((prev) => ({ ...prev, searchText: e.target.value }))}
                                        className="text-xs bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-white placeholder-gray-500 w-56"
                                    />
                                </div>
                            </div>

                            {/* Toplu Eylemler */}
                            <div className="px-5 py-2 border-b border-white/10 bg-black/10 flex flex-wrap items-center gap-2">
                                {activeTab === 'missing' && (
                                    <>
                                        <button
                                            onClick={() => bulkSetDecisions(
                                                (r) => !r.product && r.suggestion,
                                                { action: 'create' },
                                            )}
                                            className="text-[11px] font-bold uppercase tracking-wider text-blue-200 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/40 rounded-md px-3 py-1"
                                        >
                                            Reçetede Önerisi Olanları Oluştur ({missingRows.filter((r) => r.suggestion).length})
                                        </button>
                                        <button
                                            onClick={() => bulkSetDecisions(
                                                (r) => !r.product && !r.suggestion,
                                                { action: 'create', stok_kodu: '', name: '' },
                                            )}
                                            className="text-[11px] font-bold uppercase tracking-wider text-emerald-200 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 rounded-md px-3 py-1"
                                        >
                                            Önerisi Olmayanları da Oluştur (CSV adı ile)
                                        </button>
                                        <button
                                            onClick={() => bulkSetDecisions((r) => !r.product, { action: 'skip' })}
                                            className="text-[11px] font-bold uppercase tracking-wider text-gray-300 bg-gray-500/20 hover:bg-gray-500/30 border border-gray-500/40 rounded-md px-3 py-1"
                                        >
                                            Tümünü Atla
                                        </button>
                                    </>
                                )}
                                {activeTab === 'review' && (
                                    <>
                                        <button
                                            onClick={() => bulkSetDecisions((r) => r.product && r.confidence < 90, { action: 'keep' })}
                                            className="text-[11px] font-bold uppercase tracking-wider text-emerald-200 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 rounded-md px-3 py-1"
                                        >
                                            Tümünü Onayla (Mevcut Eşleşmeyi Koru)
                                        </button>
                                        <button
                                            onClick={() => bulkSetDecisions((r) => r.product && r.confidence < 90, { action: 'skip' })}
                                            className="text-[11px] font-bold uppercase tracking-wider text-gray-300 bg-gray-500/20 hover:bg-gray-500/30 border border-gray-500/40 rounded-md px-3 py-1"
                                        >
                                            Tümünü Atla
                                        </button>
                                    </>
                                )}
                                <div className="ml-auto text-[11px] text-gray-400">
                                    {visibleRows.length} satır görüntüleniyor
                                </div>
                            </div>

                            {/* Liste */}
                            <div className="flex-1 overflow-y-auto px-5 py-3">
                                {visibleRows.length === 0 ? (
                                    <div className="text-center text-gray-500 py-10">Bu sekmede satır yok.</div>
                                ) : (
                                    <div className="space-y-2">
                                        {visibleRows.slice(0, 500).map((r) => {
                                            const dec = decisions[r.idx] || {};
                                            const action = dec.action || 'skip';
                                            return (
                                                <div key={r.idx} className="bg-black/30 border border-white/10 rounded-xl p-3">
                                                    <div className="flex items-start gap-3 flex-wrap">
                                                        {/* CSV Tarafı */}
                                                        <div className="flex-1 min-w-[260px]">
                                                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                                                                <span className="text-[10px] uppercase tracking-wider text-gray-500">Satır {r.rowNum}</span>
                                                                {r.stok_kodu && (
                                                                    <span className="text-xs font-mono bg-white/10 px-1.5 py-0.5 rounded text-blue-200">{r.stok_kodu}</span>
                                                                )}
                                                                <span className="text-xs text-gray-400">×</span>
                                                                <span className="text-sm font-bold text-white">{Number(r.qty).toLocaleString('tr-TR')} adet</span>
                                                                {r.duplicateCount > 1 && (
                                                                    <span className="text-[10px] bg-orange-500/20 text-orange-300 border border-orange-500/40 rounded px-1.5">
                                                                        CSV'de {r.duplicateCount}× tekrar
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="text-sm text-white truncate">{r.name || '(İsimsiz)'}</div>
                                                            {r.barcode && (
                                                                <div className="text-[10px] text-gray-500 font-mono">Barkod: {r.barcode}</div>
                                                            )}
                                                        </div>

                                                        {/* Güven / Durum */}
                                                        {r.product && (
                                                            <div className="flex items-center gap-2">
                                                                <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded-md border ${confBadge(r.confidence)}`}>
                                                                    %{r.confidence} {r.matchMethod}
                                                                </span>
                                                            </div>
                                                        )}

                                                        {/* Karar Alanı */}
                                                        <div className="w-full md:w-[420px] bg-black/40 border border-white/10 rounded-lg p-2">
                                                            {/* Action Segmented */}
                                                            <div className="flex gap-1 mb-2">
                                                                {r.product && (
                                                                    <button
                                                                        onClick={() => setDecision(r.idx, { action: 'keep', mapProductId: r.product.id })}
                                                                        className={`flex-1 text-[10px] font-bold uppercase px-2 py-1 rounded ${action === 'keep' || action === 'review-keep' ? 'bg-emerald-500/30 text-emerald-200 border border-emerald-500/50' : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'}`}
                                                                    >Onayla</button>
                                                                )}
                                                                <button
                                                                    onClick={() => setDecision(r.idx, { action: 'create', stok_kodu: dec.stok_kodu || r.suggestion?.code || r.stok_kodu || '', name: dec.name || r.suggestion?.name || r.name || '' })}
                                                                    className={`flex-1 text-[10px] font-bold uppercase px-2 py-1 rounded ${action === 'create' ? 'bg-blue-500/30 text-blue-200 border border-blue-500/50' : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'}`}
                                                                >➕ Yeni Ekle</button>
                                                                <button
                                                                    onClick={() => setDecision(r.idx, { action: 'map-to', mapProductId: dec.mapProductId || r.product?.id || null })}
                                                                    className={`flex-1 text-[10px] font-bold uppercase px-2 py-1 rounded ${action === 'map-to' ? 'bg-purple-500/30 text-purple-200 border border-purple-500/50' : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'}`}
                                                                >🔗 Eşle</button>
                                                                <button
                                                                    onClick={() => setDecision(r.idx, { action: 'skip' })}
                                                                    className={`flex-1 text-[10px] font-bold uppercase px-2 py-1 rounded ${action === 'skip' ? 'bg-gray-500/30 text-gray-200 border border-gray-500/50' : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'}`}
                                                                >⏭ Atla</button>
                                                            </div>

                                                            {/* Action Detayları */}
                                                            {(action === 'keep' || action === 'review-keep') && r.product && (
                                                                <div className="text-xs">
                                                                    <div className="text-gray-400">Eşlendi:</div>
                                                                    <div className="text-emerald-300 font-bold truncate">{r.product.product_name}</div>
                                                                    <div className="text-[10px] font-mono text-gray-500">{r.product.stok_kodu || '—'}</div>
                                                                </div>
                                                            )}
                                                            {action === 'create' && (
                                                                <div className="space-y-1">
                                                                    {r.suggestion && (
                                                                        <div className="text-[10px] text-blue-300 bg-blue-500/10 border border-blue-500/30 rounded px-2 py-1">
                                                                            💡 Reçeteden öneri: <span className="font-mono">{r.suggestion.code}</span> — {r.suggestion.name} <span className="uppercase text-blue-400">({r.suggestion.kind})</span>
                                                                        </div>
                                                                    )}
                                                                    <div className="flex gap-1">
                                                                        <input
                                                                            type="text"
                                                                            placeholder="Stok kodu"
                                                                            value={dec.stok_kodu || ''}
                                                                            onChange={(e) => setDecision(r.idx, { stok_kodu: e.target.value })}
                                                                            className="flex-1 text-[11px] font-mono bg-black/40 border border-white/10 rounded px-2 py-1 text-blue-200"
                                                                        />
                                                                        <input
                                                                            type="text"
                                                                            placeholder="Ürün adı"
                                                                            value={dec.name || ''}
                                                                            onChange={(e) => setDecision(r.idx, { name: e.target.value })}
                                                                            className="flex-[2] text-[11px] bg-black/40 border border-white/10 rounded px-2 py-1 text-white"
                                                                        />
                                                                    </div>
                                                                    <div className="text-[10px] text-gray-500">Yeni ürün varsayılan: Birim=Adet, Maliyet=0 TL. Sonra güncellenebilir.</div>
                                                                </div>
                                                            )}
                                                            {action === 'map-to' && (
                                                                <div className="space-y-1">
                                                                    <select
                                                                        value={dec.mapProductId || ''}
                                                                        onChange={(e) => setDecision(r.idx, { mapProductId: e.target.value || null })}
                                                                        className="w-full text-xs bg-black/40 border border-white/10 rounded px-2 py-1 text-white"
                                                                    >
                                                                        <option value="">-- Mevcut ürün seç --</option>
                                                                        {products.slice(0, 2000).map((p) => (
                                                                            <option key={p.id} value={p.id}>
                                                                                {p.stok_kodu ? `[${p.stok_kodu}] ` : ''}{p.product_name}
                                                                            </option>
                                                                        ))}
                                                                    </select>
                                                                    <div className="text-[10px] text-purple-300">
                                                                        🧠 Bu eşleme kaydedilir; bir sonraki satışta "{r.name}" otomatik bu ürüne bağlanır.
                                                                    </div>
                                                                </div>
                                                            )}
                                                            {action === 'skip' && (
                                                                <div className="text-[10px] text-gray-400">Bu satır satış toplamına dahil edilmez.</div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                        {visibleRows.length > 500 && (
                                            <div className="text-center text-[11px] text-gray-500 py-2">
                                                İlk 500 satır gösteriliyor. Daha fazlası için arama kullanın ({visibleRows.length} toplam).
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Alt Bar */}
                            <div className="px-5 py-3 border-t border-white/10 bg-black/30 flex items-center gap-3 flex-wrap">
                                <div className="text-xs text-gray-400 flex-1 flex flex-wrap gap-x-4 gap-y-1">
                                    <span>✓ <b className="text-emerald-300">{counts.keep}</b> onay</span>
                                    <span>➕ <b className="text-blue-300">{counts.create}</b> yeni</span>
                                    <span>🔗 <b className="text-purple-300">{counts.mapTo}</b> eşleme</span>
                                    <span>⏭ <b className="text-gray-300">{counts.skip}</b> atla</span>
                                    <span className="text-gray-500">|</span>
                                    <span>Toplam miktar: <b className="text-white">{totalQty.toLocaleString('tr-TR')}</b></span>
                                </div>
                                <button
                                    onClick={() => { setSalesPreviewOpen(false); setSalesPreview(null); }}
                                    disabled={salesPreviewApplying}
                                    className="text-xs font-bold uppercase text-gray-300 border border-white/20 hover:bg-white/10 rounded-lg px-4 py-2 disabled:opacity-50"
                                >Vazgeç</button>
                                <button
                                    onClick={applySalesPreview}
                                    disabled={salesPreviewApplying}
                                    className="text-xs font-black uppercase tracking-widest text-white bg-gradient-to-r from-blue-600 to-emerald-600 hover:from-blue-500 hover:to-emerald-500 rounded-lg px-6 py-2 disabled:opacity-50"
                                >{salesPreviewApplying ? 'Kaydediliyor...' : 'Onayla & Satışı Kaydet'}</button>
                            </div>
                        </div>
                    </div>
                );
            })()}
            {showExportCategoriesModal && (
                <div className="fixed inset-0 z-[240] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-izbel-card w-full max-w-5xl max-h-[92vh] rounded-[1.5rem] border border-emerald-500/30 shadow-2xl overflow-hidden flex flex-col">
                        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-4">
                            <div>
                                <h3 className="text-lg font-black text-white">Excel Kategorilere Bölme</h3>
                                <p className="text-xs text-gray-400 mt-1">
                                    Her kategori ayrı Excel sayfasında görünecektir. Kategorilere eklemediğiniz ürünler "Diğer (Kategorisiz)" sayfasında toplanır.
                                    Formüller (reçete tüketimi, satış, sayım) aynı kalır — sadece görsel gruplama yapılır.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowExportCategoriesModal(false)}
                                className="text-gray-400 hover:text-white text-2xl leading-none px-2"
                                title="Kapat"
                            >
                                ×
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-5 space-y-4">
                            {missingRecipeStokKodlari.length > 0 && (
                                <div className="bg-red-500/15 border border-red-500/40 rounded-xl p-4">
                                    <div className="flex items-start gap-3">
                                        <div className="flex-1">
                                            <div className="font-black text-sm text-red-200 mb-1">
                                                ⚠ Reçetede geçip sistemde olmayan {missingRecipeStokKodlari.length} stok kodu
                                            </div>
                                            <div className="text-xs text-red-100/80 leading-relaxed mb-2">
                                                Bu kodlar sistemde yok. <b>"Tek Tıkla Sisteme Ekle"</b> ile hepsini otomatik açabilirsiniz
                                                (stok kodu + isim ile; varsayılan birim: Adet, maliyet: 0).
                                            </div>
                                            <div className="flex items-center gap-2 flex-wrap mb-2">
                                                <button
                                                    type="button"
                                                    disabled={recipeImporting}
                                                    onClick={async () => {
                                                        const confirm = window.confirm(
                                                            `${missingRecipeStokKodlari.length} yeni ürün sisteme eklenecek.\n\n` +
                                                            'Bu ürünlerin maliyetleri 0 TL olarak açılır, daha sonra güncellenebilir.\n\n' +
                                                            'Devam etmek ister misiniz?',
                                                        );
                                                        if (!confirm) return;
                                                        setRecipeImporting(true);
                                                        try {
                                                            const res = await syncMissingRecipeProducts();
                                                            toast.success(
                                                                `Reçete senkronizasyonu tamamlandı: ${res.created} ürün eklendi/güncellendi` +
                                                                (res.failed > 0 ? `, ${res.failed} hatalı` : '') + '.',
                                                            );
                                                        } catch (err) {
                                                            toast.error('Senkronizasyon hatası: ' + (err?.message || String(err)));
                                                        } finally {
                                                            setRecipeImporting(false);
                                                        }
                                                    }}
                                                    className="text-xs font-bold uppercase tracking-widest text-white bg-red-600 hover:bg-red-500 rounded-lg px-4 py-2 disabled:opacity-50"
                                                >
                                                    {recipeImporting ? 'İşleniyor...' : `Tek Tıkla Sisteme Ekle (${missingRecipeStokKodlari.length})`}
                                                </button>
                                            </div>
                                            <details className="text-xs">
                                                <summary className="cursor-pointer text-red-200 hover:text-red-100 font-bold">İlk {Math.min(missingRecipeStokKodlari.length, 30)} eksik ürünü göster</summary>
                                                <div className="mt-2 max-h-40 overflow-y-auto bg-black/30 rounded-lg p-2 space-y-0.5">
                                                    {missingRecipeStokKodlari.slice(0, 30).map((m) => (
                                                        <div key={m.stok_kodu} className="flex items-center gap-2 text-[11px]">
                                                            <span className="font-mono text-red-300 w-20 shrink-0">{m.stok_kodu}</span>
                                                            <span className="text-red-100 truncate flex-1">{m.name || '(isimsiz)'}</span>
                                                            <span className="text-red-400/70 text-[9px] uppercase">{m.kind}</span>
                                                        </div>
                                                    ))}
                                                    {missingRecipeStokKodlari.length > 30 && (
                                                        <div className="text-[10px] text-red-300/70 pt-1">... ve {missingRecipeStokKodlari.length - 30} ürün daha</div>
                                                    )}
                                                </div>
                                            </details>
                                        </div>
                                    </div>
                                </div>
                            )}
                            <label className={`flex items-start gap-3 rounded-xl p-4 cursor-pointer transition-all ${firstPeriodMode ? 'bg-amber-500/15 border border-amber-500/50' : 'bg-white/[0.03] border border-white/10 hover:border-amber-500/30'}`}>
                                <input
                                    type="checkbox"
                                    checked={firstPeriodMode}
                                    onChange={(e) => setFirstPeriodMode(e.target.checked)}
                                    className="mt-1 accent-amber-500 w-4 h-4"
                                />
                                <div className="flex-1">
                                    <div className="font-black text-sm text-amber-200 mb-1">
                                        İlk Sayım Modu
                                        {firstPeriodMode && (
                                            <span className="ml-2 px-2 py-0.5 bg-amber-500 text-amber-950 rounded-full text-[10px] font-bold tracking-wider">AÇIK</span>
                                        )}
                                    </div>
                                    <div className="text-xs text-amber-100/70 leading-relaxed">
                                        İşaretli ise <b>varyans / fark hesabı yapılmaz</b>. Onun yerine <b>"İmpliye Açılış = Sayılan + Reçete Tüketimi − Tedarik"</b> hesaplanır
                                        ve ek bir <b>"Anomali Tespit"</b> sayfası oluşturulur.
                                        İlk dönem sayımında reçete/tedarik/sayım tutarlılığını kontrol etmek için kullanın.
                                    </div>
                                </div>
                            </label>

                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                <div className="text-sm text-gray-300">
                                    <span className="font-bold text-white">{exportCategories.length}</span> kategori tanımlı
                                    {exportCategories.length > 0 && (
                                        <span className="ml-2 text-gray-500">
                                            ({exportCategories.reduce((a, c) => a + (c.productIds?.length || 0), 0)} ürün seçili)
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 flex-wrap">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const name = window.prompt('Yeni kategori (Excel sayfa) adı:', '');
                                            if (!name || !name.trim()) return;
                                            const id = 'cat_' + Date.now();
                                            setExportCategories((prev) => [...prev, { id, name: name.trim().slice(0, 31), productIds: [] }]);
                                            setExpandedCategoryId(id);
                                        }}
                                        className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 px-4 rounded-lg text-sm"
                                    >
                                        + Yeni Kategori Ekle
                                    </button>
                                    {exportCategories.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (window.confirm('Tüm kategorileri temizlemek istediğinize emin misiniz?')) {
                                                    setExportCategories([]);
                                                    setExpandedCategoryId(null);
                                                }
                                            }}
                                            className="text-xs text-red-300 hover:text-red-200 border border-red-500/30 rounded-lg px-3 py-2"
                                        >
                                            Hepsini Temizle
                                        </button>
                                    )}
                                </div>
                            </div>

                            {exportCategories.length === 0 ? (
                                <div className="border-2 border-dashed border-white/10 rounded-xl p-8 text-center text-gray-500">
                                    <p className="text-sm">Henüz kategori yok. İsterseniz "+ Yeni Kategori Ekle" ile başlayabilir,</p>
                                    <p className="text-sm">ya da "Kategorisiz İndir" ile eski davranışla tek Mutabakat sayfası olarak dışa aktarabilirsiniz.</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {exportCategories.map((cat) => {
                                        const isOpen = expandedCategoryId === cat.id;
                                        const selectedSet = new Set((cat.productIds || []).map(String));
                                        const term = exportCategoryProductSearch.trim().toLowerCase();
                                        const filteredProducts = products
                                            .filter((p) => p.is_active !== false)
                                            .filter((p) => !onlyRecipeProducts || recipeProductIdSet.has(String(p.id)))
                                            .filter((p) => {
                                                if (!term) return true;
                                                return (
                                                    (p.product_name || '').toLowerCase().includes(term) ||
                                                    (p.stok_kodu || '').toLowerCase().includes(term)
                                                );
                                            })
                                            .sort((a, b) => (a.product_name || '').localeCompare(b.product_name || '', 'tr'));
                                        return (
                                            <div key={cat.id} className="border border-white/10 rounded-xl bg-white/[0.02] overflow-hidden">
                                                <div className="flex items-center justify-between gap-3 px-4 py-3">
                                                    <div className="flex items-center gap-3 flex-1 min-w-0">
                                                        <input
                                                            type="text"
                                                            value={cat.name}
                                                            onChange={(e) => {
                                                                const newName = e.target.value.slice(0, 31);
                                                                setExportCategories((prev) =>
                                                                    prev.map((c) => (c.id === cat.id ? { ...c, name: newName } : c)),
                                                                );
                                                            }}
                                                            className="bg-izbel-dark/70 border border-white/10 rounded-lg px-3 py-1.5 text-sm font-bold text-white w-64"
                                                            placeholder="Kategori adı"
                                                        />
                                                        <span className="text-xs text-gray-400">
                                                            {cat.productIds?.length || 0} ürün
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => setExpandedCategoryId(isOpen ? null : cat.id)}
                                                            className="text-xs font-bold uppercase tracking-widest text-emerald-300 hover:text-emerald-200 border border-emerald-500/30 rounded-lg px-3 py-1.5"
                                                        >
                                                            {isOpen ? 'Kapat' : 'Ürünleri Seç'}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                if (window.confirm(`"${cat.name}" kategorisini silmek istediğinize emin misiniz?`)) {
                                                                    setExportCategories((prev) => prev.filter((c) => c.id !== cat.id));
                                                                    if (expandedCategoryId === cat.id) setExpandedCategoryId(null);
                                                                }
                                                            }}
                                                            className="text-xs text-red-300 hover:text-red-200 border border-red-500/30 rounded-lg px-2.5 py-1.5"
                                                            title="Kategoriyi sil"
                                                        >
                                                            Sil
                                                        </button>
                                                    </div>
                                                </div>
                                                {isOpen && (
                                                    <div className="border-t border-white/10 p-3 bg-black/20">
                                                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                                                            <input
                                                                type="text"
                                                                value={exportCategoryProductSearch}
                                                                onChange={(e) => setExportCategoryProductSearch(e.target.value)}
                                                                placeholder="Ürün ara (ad veya stok kodu)"
                                                                className="bg-izbel-dark/70 border border-white/10 rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[200px]"
                                                            />
                                                            <label className={`flex items-center gap-1.5 text-xs font-bold rounded-lg px-3 py-1.5 cursor-pointer border ${onlyRecipeProducts ? 'bg-blue-500/20 border-blue-500/50 text-blue-100' : 'border-white/10 text-gray-300 hover:border-blue-500/30'}`}>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={onlyRecipeProducts}
                                                                    onChange={(e) => setOnlyRecipeProducts(e.target.checked)}
                                                                    className="accent-blue-500"
                                                                />
                                                                Sadece reçetede geçenler ({recipeProductIdSet.size})
                                                            </label>
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    const ids = filteredProducts.map((p) => String(p.id));
                                                                    setExportCategories((prev) =>
                                                                        prev.map((c) => {
                                                                            if (c.id !== cat.id) return c;
                                                                            const merged = new Set([...(c.productIds || []).map(String), ...ids]);
                                                                            return { ...c, productIds: Array.from(merged) };
                                                                        }),
                                                                    );
                                                                }}
                                                                className="text-xs font-bold text-emerald-300 border border-emerald-500/30 rounded-lg px-3 py-1.5"
                                                            >
                                                                Filtredekileri Ekle ({filteredProducts.length})
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    const ids = Array.from(recipeProductIdSet);
                                                                    setExportCategories((prev) =>
                                                                        prev.map((c) => {
                                                                            if (c.id !== cat.id) return c;
                                                                            const merged = new Set([...(c.productIds || []).map(String), ...ids]);
                                                                            return { ...c, productIds: Array.from(merged) };
                                                                        }),
                                                                    );
                                                                    toast.success(`${ids.length} reçete ürünü eklendi.`);
                                                                }}
                                                                className="text-xs font-bold text-blue-300 border border-blue-500/30 rounded-lg px-3 py-1.5"
                                                                title="Reçetede geçen tüm ürünleri tek tıkla ekler"
                                                                disabled={recipeProductIdSet.size === 0}
                                                            >
                                                                Reçetedekileri Ekle ({recipeProductIdSet.size})
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setExportCategories((prev) =>
                                                                        prev.map((c) => (c.id === cat.id ? { ...c, productIds: [] } : c)),
                                                                    );
                                                                }}
                                                                className="text-xs text-gray-400 border border-white/10 rounded-lg px-3 py-1.5"
                                                            >
                                                                Seçimi Temizle
                                                            </button>
                                                        </div>
                                                        <div className="max-h-72 overflow-y-auto border border-white/5 rounded-lg bg-izbel-dark/40">
                                                            {filteredProducts.length === 0 ? (
                                                                <div className="p-4 text-center text-xs text-gray-500">Ürün bulunamadı.</div>
                                                            ) : (
                                                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-0.5 p-1">
                                                                    {filteredProducts.slice(0, 2000).map((p) => {
                                                                        const checked = selectedSet.has(String(p.id));
                                                                        return (
                                                                            <label
                                                                                key={p.id}
                                                                                className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-xs ${checked ? 'bg-emerald-500/15 text-emerald-100' : 'hover:bg-white/5 text-gray-300'}`}
                                                                            >
                                                                                <input
                                                                                    type="checkbox"
                                                                                    checked={checked}
                                                                                    onChange={(e) => {
                                                                                        const add = e.target.checked;
                                                                                        setExportCategories((prev) =>
                                                                                            prev.map((c) => {
                                                                                                if (c.id !== cat.id) return c;
                                                                                                const s = new Set((c.productIds || []).map(String));
                                                                                                if (add) s.add(String(p.id));
                                                                                                else s.delete(String(p.id));
                                                                                                return { ...c, productIds: Array.from(s) };
                                                                                            }),
                                                                                        );
                                                                                    }}
                                                                                    className="accent-emerald-500"
                                                                                />
                                                                                <span className="truncate flex-1" title={p.product_name}>{p.product_name}</span>
                                                                                {p.stok_kodu && (
                                                                                    <span className="text-[10px] text-gray-500 shrink-0">{p.stok_kodu}</span>
                                                                                )}
                                                                            </label>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}
                                                            {filteredProducts.length > 2000 && (
                                                                <div className="p-2 text-center text-[10px] text-gray-500 border-t border-white/5">
                                                                    İlk 2000 ürün gösteriliyor ({filteredProducts.length} toplam). Daha fazlası için arama yapın.
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="px-5 py-4 border-t border-white/10 bg-black/30 flex items-center justify-between gap-3 flex-wrap">
                            <div className="text-[11px] text-gray-500">
                                Tanımladığınız kategoriler bu tarayıcıda saklanır, sonraki dışa aktarımda da kullanılabilir.
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <button
                                    type="button"
                                    onClick={() => setShowExportCategoriesModal(false)}
                                    className="text-xs font-bold uppercase tracking-widest text-gray-300 border border-white/10 rounded-lg px-4 py-2.5"
                                >
                                    İptal
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        try { localStorage.setItem('exportCategories_v1', JSON.stringify(exportCategories)); } catch {}
                                        setShowExportCategoriesModal(false);
                                        exportProductCSV(null, firstPeriodMode);
                                    }}
                                    className="text-xs font-bold uppercase tracking-widest text-gray-200 border border-white/10 hover:bg-white/5 rounded-lg px-4 py-2.5"
                                >
                                    {firstPeriodMode ? 'Kategorisiz İndir (Tek Başlangıç)' : 'Kategorisiz İndir (Tek Mutabakat)'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        const valid = exportCategories.filter((c) => c.name && c.name.trim() && (c.productIds?.length || 0) > 0);
                                        if (valid.length === 0) {
                                            toast.info('Hiç kategori veya seçili ürün yok. "Kategorisiz İndir" ile devam edebilirsiniz.');
                                            return;
                                        }
                                        try { localStorage.setItem('exportCategories_v1', JSON.stringify(exportCategories)); } catch {}
                                        setShowExportCategoriesModal(false);
                                        exportProductCSV(valid, firstPeriodMode);
                                    }}
                                    className={`text-xs font-bold uppercase tracking-widest text-white rounded-lg px-4 py-2.5 flex items-center gap-2 ${firstPeriodMode ? 'bg-amber-600 hover:bg-amber-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}
                                >
                                    {firstPeriodMode ? 'İlk Sayım İndir' : 'Bitir & İndir'} ({exportCategories.filter((c) => (c.productIds?.length || 0) > 0).length} sayfa)
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {showSupplyModal && (
                <div className="fixed inset-0 z-[220] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-izbel-card w-full max-w-6xl max-h-[88vh] rounded-[1.5rem] border border-fuchsia-500/30 shadow-2xl overflow-hidden flex flex-col">
                        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
                            <div>
                                <h3 className="text-lg font-black text-white">Tedarik Girişi</h3>
                                <p className="text-xs text-gray-500">Seçili şube için ürün seçip miktar girin. Kaydetten sonra reçete düşümünde otomatik kullanılır.</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setShowSupplyModal(false)}
                                    className="bg-white/10 hover:bg-white/20 text-gray-200 text-xs font-bold py-2 px-3 rounded-lg border border-white/10"
                                >
                                    Kapat
                                </button>
                                <button
                                    type="button"
                                    onClick={applySupplyDrafts}
                                    className="bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-bold py-2 px-3 rounded-lg"
                                >
                                    Kaydet / Uygula
                                </button>
                            </div>
                        </div>
                        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[220px,1fr]">
                            <div className="border-r border-white/10 p-3 overflow-auto">
                                <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-2">Kategoriler</div>
                                <div className="space-y-1">
                                    {supplyCategories.map((c) => (
                                        <button
                                            key={c}
                                            type="button"
                                            onClick={() => setSupplyCategory(c)}
                                            className={`w-full text-left px-3 py-2 rounded-lg text-xs font-bold border ${
                                                supplyCategory === c
                                                    ? 'bg-fuchsia-600/30 text-fuchsia-100 border-fuchsia-500/40'
                                                    : 'bg-white/5 text-gray-300 border-white/10 hover:bg-white/10'
                                            }`}
                                        >
                                            {c === 'ALL' ? 'Tümü' : c}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="p-4 min-h-0 flex flex-col">
                                {/* Giriş format rehberi */}
                                <div className="mb-3 px-3 py-2 bg-amber-500/10 border border-amber-500/25 rounded-xl text-xs text-amber-200 leading-relaxed">
                                    <span className="font-black text-amber-400 uppercase tracking-widest mr-1">g��� Nasıl girilir?</span>
                                    <span className="font-bold text-amber-300">KİLOGRAM</span> → ondalık nokta ile: <code className="bg-black/30 px-1 rounded">1.5</code> (1,5 kg anlamında) &nbsp;·&nbsp;
                                    <span className="font-bold text-amber-300">LİTRE</span> → aynı şekilde: <code className="bg-black/30 px-1 rounded">0.75</code> &nbsp;·&nbsp;
                                    <span className="font-bold text-amber-300">ADET / KOLİ / PAKET</span> → tam sayı: <code className="bg-black/30 px-1 rounded">3</code> &nbsp;·&nbsp;
                                    <span className="font-bold text-amber-300">GRAM</span> → gram cinsinden tam sayı: <code className="bg-black/30 px-1 rounded">500</code>
                                </div>
                                <div className="flex items-center gap-2 mb-3">
                                    <input
                                        value={supplySearch}
                                        onChange={(e) => setSupplySearch(e.target.value)}
                                        placeholder="Stok kodu, ürün adı, barkod..."
                                        className="w-full bg-izbel-dark border border-white/10 rounded-lg py-2.5 px-3 text-sm text-white outline-none focus:border-fuchsia-500"
                                    />
                                    <span className="text-xs text-gray-500 font-bold">{supplyProducts.length} ürün</span>
                                </div>
                                <div className="flex-1 min-h-0 overflow-auto border border-white/10 rounded-xl">
                                    <table className="w-full text-left text-xs">
                                        <thead className="sticky top-0 bg-izbel-dark z-10 border-b border-white/10">
                                            <tr className="text-gray-500 uppercase tracking-widest">
                                                <th className="p-2 pl-3">Stok Kodu</th>
                                                <th className="p-2">Ürün</th>
                                                <th className="p-2">Birim</th>
                                                <th className="p-2 pr-3 text-right">Tedarik</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {supplyProducts.map((p) => {
                                                const val = supplyDrafts[p.id] ?? '';
                                                const u = (p.unit || 'ADET').toUpperCase();
                                                // Birime göre placeholder ve title metni
                                                const unitHint = u === 'KİLOGRAM'
                                                    ? { ph: 'ör: 1.5', title: 'Kilogram — ondalık nokta kullan. 1,5 kg için 1.5 yaz. 500 gram için 0.5 yaz.' }
                                                    : u === 'LİTRE'
                                                    ? { ph: 'ör: 0.75', title: 'Litre — ondalık nokta kullan. 750 ml için 0.75 yaz.' }
                                                    : u === 'GRAM'
                                                    ? { ph: 'ör: 500', title: 'Gram — doğrudan gram olarak tam sayı yaz. 500 gram için 500 yaz.' }
                                                    : u === 'KOLİ'
                                                    ? { ph: 'ör: 2', title: 'Koli — kaç koli aldıysan tam sayı yaz.' }
                                                    : u === 'PAKET'
                                                    ? { ph: 'ör: 3', title: 'Paket — kaç paket aldıysan tam sayı yaz.' }
                                                    : { ph: 'ör: 1', title: 'Adet — kaç adet aldıysan tam sayı yaz.' };
                                                return (
                                                    <tr key={p.id} className="border-b border-white/5">
                                                        <td className="p-2 pl-3 font-mono text-blue-300/90">{p.stok_kodu || '—'}</td>
                                                        <td className="p-2 text-white">{p.product_name}</td>
                                                        <td className="p-2">
                                                            <span
                                                                title={unitHint.title}
                                                                className="cursor-help inline-flex items-center gap-1 text-gray-300 font-semibold border-b border-dashed border-gray-600"
                                                            >
                                                                {p.unit || 'ADET'}
                                                                <span className="text-[10px] text-gray-500">ⓘ</span>
                                                            </span>
                                                        </td>
                                                        <td className="p-2 pr-3 text-right">
                                                            <input
                                                                type="text"
                                                                inputMode="decimal"
                                                                value={val}
                                                                title={unitHint.title}
                                                                onChange={(e) => setSupplyDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                                                                className="w-28 bg-izbel-dark border border-white/10 rounded-lg py-1.5 px-2 text-right text-fuchsia-200 font-mono outline-none focus:border-fuchsia-500"
                                                                placeholder={unitHint.ph}
                                                            />
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                            {supplyProducts.length === 0 && (
                                                <tr><td colSpan={4} className="p-8 text-center text-gray-500 font-bold">Eşleşen ürün yok.</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {/* GLOWING BACKGROUND EFFECT */}
            <div className="fixed top-[-20%] right-[-20%] w-[50%] h-[50%] bg-blue-900 rounded-full mix-blend-screen filter blur-[150px] opacity-20 pointer-events-none z-0"></div>

            {/* TOP NAVIGATION / HEADER */}
            <div className="border-b border-white/10 bg-izbel-card/60 backdrop-blur-xl sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-800 flex items-center justify-center shadow-glow">
                            <span className="font-black text-white text-xl">İ</span>
                        </div>
                        <div>
                            <h1 className="text-2xl font-black tracking-tight text-white leading-tight">YÖNETİM PANELİ</h1>
                            <p className="text-xs font-bold text-gray-400 uppercase tracking-[0.2em]">İzbel Kurumsal ERP</p>
                        </div>
                    </div>

                    {/* TABS COMPONENT */}
                    <div className="flex bg-white/5 p-1 rounded-2xl border border-white/5 w-full md:w-auto">
                        <button onClick={() => setActiveTab('finans')} className={`flex-1 md:px-6 py-3 rounded-xl text-sm font-bold uppercase tracking-wider transition-all ${activeTab === 'finans' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>Özet & Analitik</button>
                        <button onClick={() => setActiveTab('subeler')} className={`flex-1 md:px-6 py-3 rounded-xl text-sm font-bold uppercase tracking-wider transition-all ${activeTab === 'subeler' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>�?ubeler</button>
                        <button onClick={() => setActiveTab('urunler')} className={`flex-1 md:px-6 py-3 rounded-xl text-sm font-bold uppercase tracking-wider transition-all ${activeTab === 'urunler' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>Ürün Onay Departmanı</button>
                        <button onClick={() => setActiveTab('suberapor')} className={`flex-1 md:px-4 py-3 rounded-xl text-xs md:text-sm font-bold uppercase tracking-wider transition-all ${activeTab === 'suberapor' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>�?ube Karşılaştırma</button>
                        <button onClick={() => setActiveTab('kategoriler')} className={`flex-1 md:px-6 py-3 rounded-xl text-sm font-bold uppercase tracking-wider transition-all ${activeTab === 'kategoriler' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>Kategoriler</button>
                        <button onClick={() => setActiveTab('tedarikcv')} className={`flex-1 md:px-4 py-3 rounded-xl text-xs md:text-sm font-bold uppercase tracking-wider transition-all ${activeTab === 'tedarikcv' ? 'bg-fuchsia-600 text-white shadow-lg shadow-fuchsia-500/20' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>Tedarik CSV</button>
                    </div>

                    <div className="hidden md:flex items-center gap-3">
                        <button onClick={fetchData} className="p-3 bg-white/5 rounded-xl border border-white/5 text-gray-300 hover:text-white hover:bg-white/10 transition-colors">
                            <RefreshCw size={20} className={isLoading ? "animate-spin" : ""} />
                        </button>
                        <button onClick={onLogout} className="p-3 bg-red-500/10 rounded-xl border border-red-500/20 text-red-400 hover:bg-red-500 hover:text-white transition-colors">
                            <LogOut size={20} />
                        </button>
                    </div>
                </div>
            </div>

            {/* MAIN CONTENT AREA */}
            <div className="max-w-7xl mx-auto px-6 pt-10 relative z-10">

                {/* --------- TAB 1: FINANCIAL OVERVIEW & ANALYTICS --------- */}
                {activeTab === 'finans' && (
                    <div className="space-y-10 animate-fade-in">

                        {/* Dönem ve �?ube Filtreleri */}
                        <div className="bg-izbel-card p-6 rounded-[2rem] border border-white/5 shadow-2xl flex flex-col xl:flex-row gap-6 justify-between items-center relative overflow-hidden group">
                            <div className="absolute top-0 right-[-5%] w-64 h-64 bg-blue-600/5 rounded-full blur-[80px] pointer-events-none"></div>

                            <div className="flex flex-col md:flex-row items-center gap-4 w-full xl:w-auto relative z-10">
                                <div className="flex items-center gap-3 bg-izbel-dark p-2 rounded-2xl border border-white/10 w-full md:w-auto">
                                    <div className="p-2 bg-blue-500/20 rounded-xl text-blue-400"><CalendarPlus size={20} /></div>
                                    <select
                                        value={selectedPeriodId}
                                        onChange={(e) => setSelectedPeriodId(e.target.value)}
                                        className="bg-transparent text-white font-bold py-2 pr-4 outline-none appearance-none flex-1 md:w-48 cursor-pointer"
                                    >
                                        <option value="ALL">Tüm Zamanlar / Tüm Sayımlar</option>
                                        {periods.map(p => (
                                            <option key={p.id} value={p.id}>{p.period_name} {p.is_active ? '(Aktif Sayım)' : '(Geçmiş)'}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex items-center gap-3 bg-izbel-dark p-2 rounded-2xl border border-white/10 w-full md:w-auto">
                                    <div className="p-2 bg-purple-500/20 rounded-xl text-purple-400"><Users size={20} /></div>
                                    <select
                                        value={selectedBranchId}
                                        onChange={(e) => setSelectedBranchId(e.target.value)}
                                        className="bg-transparent text-white font-bold py-2 pr-4 outline-none appearance-none flex-1 md:w-48 cursor-pointer"
                                    >
                                        <option value="ALL">Tüm �?ubeler (Sistem Geneli)</option>
                                        {branches.map(b => (
                                            <option key={b.id} value={b.id}>{b.branch_name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="flex w-full xl:w-auto gap-4 relative z-10">
                                <button onClick={handleStartNewPeriod} className="flex-1 bg-white/5 hover:bg-white/10 text-white py-3 px-6 rounded-2xl font-bold transition-all text-xs uppercase tracking-widest border border-white/10">
                                    + Yeni Dönem Başlat
                                </button>
                                {periods.some(p => p.is_active) && (
                                    <button onClick={handleCloseActivePeriod} className="flex-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 py-3 px-6 rounded-2xl font-bold transition-all text-xs uppercase tracking-widest border border-red-500/20">
                                        Aktif Dönemi Kapat
                                    </button>
                                )}
                                <button onClick={exportBranchCSV} className="hidden xl:flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white py-3 px-6 rounded-2xl font-bold transition-all text-xs uppercase tracking-widest border border-blue-500">
                                    <Download size={16} /> İndir
                                </button>
                                <button onClick={exportSubelerStokFormat} className="hidden xl:flex items-center gap-2 bg-green-600/90 hover:bg-green-500 text-white py-3 px-6 rounded-2xl font-bold transition-all text-xs uppercase tracking-widest border border-green-500" title="�?ubeler stok formatında (A: Stok Kodu, B: Stok Adı, C: Grubu, D: Birimi, E: Barkod, F/G/H: 3 şube değeri)">
                                    <Download size={16} /> �?ubeler Stok Excel
                                </button>
                            </div>
                        </div>

                        {/* Financial Big Cards */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            {/* Card 1 */}
                            <div className="bg-gradient-to-br from-izbel-card to-izbel-dark border border-white/5 p-8 rounded-[2rem] shadow-2xl relative overflow-hidden group">
                                <div className="absolute top-0 right-[-10%] w-32 h-32 bg-gray-500/10 rounded-full blur-[40px] pointer-events-none"></div>
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="p-3 bg-gray-800 rounded-xl border border-gray-700">
                                        <DollarSign size={24} className="text-gray-400" />
                                    </div>
                                    <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest leading-tight">Sistemsel Değer<br /><span className="text-[10px] text-gray-500">Mevcut stok bazlı beklenen</span></h3>
                                </div>
                                <div className="font-mono text-4xl lg:text-5xl font-black tracking-tighter text-white">
                                    {sysValue.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} <span className="text-xl text-gray-500 opacity-50 font-sans tracking-tight">TL</span>
                                </div>
                            </div>

                            {/* Card 2 */}
                            <div className="bg-gradient-to-br from-[#1E3A8A] to-[#172554] border border-blue-800/50 p-8 rounded-[2rem] shadow-[0_0_40px_rgba(30,58,138,0.3)] relative overflow-hidden">
                                <div className="absolute top-0 right-[-10%] w-40 h-40 bg-blue-500/20 rounded-full blur-[50px] pointer-events-none"></div>
                                <div className="flex items-center gap-3 mb-6 relative z-10">
                                    <div className="p-3 bg-blue-600 rounded-xl border border-blue-500 shadow-lg">
                                        <Wallet size={24} className="text-white" />
                                    </div>
                                    <h3 className="text-sm font-bold text-blue-200 uppercase tracking-widest leading-tight">Sayılan Değer<br /><span className="text-[10px] text-blue-400">Personel girişlerine göre</span></h3>
                                </div>
                                <div className="font-mono text-4xl lg:text-5xl font-black tracking-tighter text-white relative z-10">
                                    {actualValue.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} <span className="text-xl text-blue-400 opacity-70 font-sans tracking-tight">TL</span>
                                </div>
                            </div>

                            {/* Card 3 (Variance) */}
                            <div className={`p-8 rounded-[2rem] border relative overflow-hidden shadow-2xl
                     ${isLoss ? 'bg-gradient-to-br from-[#7F1D1D] to-[#450A0A] border-red-800/50 shadow-glow-danger' :
                                    'bg-gradient-to-br from-[#064E3B] to-[#022C22] border-green-800/50 shadow-glow-success'}`}>
                                <div className={`absolute top-0 right-[-10%] w-40 h-40 rounded-full blur-[50px] pointer-events-none ${isLoss ? 'bg-red-500/20' : 'bg-green-500/20'}`}></div>
                                <div className="flex items-center gap-3 mb-6 relative z-10">
                                    <div className={`p-3 rounded-xl border shadow-lg ${isLoss ? 'bg-red-600 border-red-500' : 'bg-green-600 border-green-500'}`}>
                                        <TrendingDown size={24} className={`text-white ${!isLoss && 'rotate-180'}`} />
                                    </div>
                                    <h3 className={`text-sm font-bold uppercase tracking-widest leading-tight ${isLoss ? 'text-red-200' : 'text-green-200'}`}>
                                        Eksik & Fazla Farkı<br /><span className={`text-[10px] ${isLoss ? 'text-red-400' : 'text-green-400'}`}>Mali Kayıp / Kazanç</span>
                                    </h3>
                                </div>
                                <div className="font-mono text-4xl lg:text-6xl font-black tracking-tighter text-white relative z-10">
                                    {shrinkageValue > 0 ? '+' : ''}{shrinkageValue.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} <span className="text-xl opacity-70 font-sans tracking-tight">TL</span>
                                </div>
                            </div>
                        </div>

                        {/* Dönem bazlı: Sistem vs Sayılan karşılaştırma grafiği */}
                        <div className="bg-izbel-card border border-white/5 rounded-[2rem] overflow-hidden p-6 md:p-8">
                            <h3 className="font-black text-xl md:text-2xl tracking-tight text-white flex items-center gap-3 mb-6">
                                <BarChart3 className="text-blue-500" /> Sistem Stoğu vs Sayılan Değer
                            </h3>
                            <div className="h-64 w-full min-h-[200px]">
                                <ResponsiveContainer width="100%" height="100%" minHeight={200}>
                                    <BarChart data={[{ name: 'Karşılaştırma', sistem: sysValue, sayilan: actualValue }]} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                                        <XAxis dataKey="name" stroke="#666" tick={{ fill: '#999', fontSize: 12 }} tickLine={false} axisLine={false} />
                                        <YAxis stroke="#666" tick={{ fill: '#999', fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k ₺`} />
                                        <Tooltip cursor={{ fill: '#ffffff10' }} contentStyle={{ backgroundColor: '#151828', borderColor: '#334155', borderRadius: '12px', color: '#fff' }} formatter={(value) => [value.toLocaleString('tr-TR') + ' TL', '']} />
                                        <Legend wrapperStyle={{ fontSize: 12 }} formatter={(value) => <span className="text-gray-300 text-sm">{value}</span>} />
                                        <Bar dataKey="sistem" name="Sistem (Beklenen)" fill="#6b7280" radius={[8, 8, 0, 0]} />
                                        <Bar dataKey="sayilan" name="Sayılan" fill="#3b82f6" radius={[8, 8, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* �?ube bazlı sayım özeti (hangi şube ne kadar saydı) */}
                        <div className="bg-izbel-card border border-white/5 rounded-[2rem] overflow-hidden p-6 md:p-8">
                            <h3 className="font-black text-xl md:text-2xl tracking-tight text-white flex items-center gap-3 mb-6">
                                <Users className="text-purple-500" /> �?ube Bazlı Sayım Özeti (TL)
                            </h3>
                            {branchSummaries.some(b => b.branchActualValue > 0) ? (
                                <div className="h-72 w-full min-h-[220px]">
                                    <ResponsiveContainer width="100%" height="100%" minHeight={220}>
                                        <BarChart data={branchSummaries.filter(b => b.branchActualValue > 0).map(b => ({ name: b.branch_name.length > 12 ? b.branch_name.slice(0, 11) + '…' : b.branch_name, deger: b.branchActualValue, fullName: b.branch_name }))} margin={{ top: 10, right: 10, left: 0, bottom: 60 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                                            <XAxis dataKey="name" stroke="#666" tick={{ fill: '#999', fontSize: 11 }} tickLine={false} axisLine={false} angle={-25} textAnchor="end" height={60} />
                                            <YAxis stroke="#666" tick={{ fill: '#999', fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                                            <Tooltip cursor={{ fill: '#ffffff10' }} contentStyle={{ backgroundColor: '#151828', borderColor: '#334155', borderRadius: '12px', color: '#fff' }} formatter={(value, name, props) => [value.toLocaleString('tr-TR') + ' TL', props.payload?.fullName || props.payload?.name]} />
                                            <Bar dataKey="deger" fill="#8b5cf6" radius={[8, 8, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            ) : (
                                <div className="h-48 flex items-center justify-center border-2 border-dashed border-white/5 rounded-2xl">
                                    <p className="text-gray-500 font-bold tracking-widest uppercase text-sm">Seçili dönemde henüz sayım yok</p>
                                </div>
                            )}
                        </div>

                        {/* Eksik sayım: aktif dönemde sayıma başlamayan şubeler / sayılmayan ürünler */}
                        {activePeriod && (
                            <div className="bg-izbel-card border border-white/5 rounded-[2rem] overflow-hidden p-6 md:p-8">
                                <h3 className="font-black text-xl md:text-2xl tracking-tight text-white flex items-center gap-3 mb-2">
                                    <CalendarPlus className="text-amber-500" /> Eksik Sayım
                                </h3>
                                <p className="text-sm text-gray-500 font-medium mb-6">Aktif dönem: {activePeriod.period_name}</p>
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    <div className="bg-izbel-dark/50 rounded-xl border border-white/5 p-4">
                                        <h4 className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-3">Sayıma başlamayan şubeler</h4>
                                        {branchesWithNoCountInActivePeriod.length === 0 ? (
                                            <p className="text-gray-400 text-sm font-medium">Tüm şubeler sayıma giriş yaptı.</p>
                                        ) : (
                                            <ul className="space-y-2 max-h-48 overflow-y-auto">
                                                {branchesWithNoCountInActivePeriod.map(b => (
                                                    <li key={b.id} className="text-white font-medium text-sm flex items-center gap-2">
                                                        <span className="w-2 h-2 rounded-full bg-amber-500" /> {b.branch_name}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                    <div className="bg-izbel-dark/50 rounded-xl border border-white/5 p-4">
                                        <h4 className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-3">Aktif dönemde hiç sayılmayan ürünler</h4>
                                        {productsNotCountedInActivePeriod.length === 0 ? (
                                            <p className="text-gray-400 text-sm font-medium">Tüm ürünler en az bir şubede sayıldı.</p>
                                        ) : (
                                            <ul className="space-y-2 max-h-48 overflow-y-auto">
                                                {productsNotCountedInActivePeriod.slice(0, 50).map(p => (
                                                    <li key={p.id} className="text-gray-200 text-sm truncate" title={p.product_name}>
                                                        <span className="w-2 h-2 rounded-full bg-amber-500 inline-block mr-2 align-middle" /> {p.product_name}
                                                    </li>
                                                ))}
                                                {productsNotCountedInActivePeriod.length > 50 && (
                                                    <li className="text-gray-500 text-xs font-bold">+{productsNotCountedInActivePeriod.length - 50} ürün daha</li>
                                                )}
                                            </ul>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Top Kayıp Veren Ürünler (Recharts) */}
                        <div className="bg-izbel-card border border-white/5 rounded-[2rem] overflow-hidden p-6 md:p-8">
                            <div className="flex flex-col md:flex-row justify-between md:items-center mb-8 gap-4">
                                <div>
                                    <h3 className="font-black text-xl md:text-2xl tracking-tight text-white flex items-center gap-3">
                                        <BarChart3 className="text-red-500" /> En Çok Fire & Kayıp Veren 10 Ürün
                                    </h3>
                                    <p className="text-sm text-gray-500 font-medium">Finansal açıdan şirkete en çok maliyeti olan ürünlerin görselleşimi</p>
                                </div>
                            </div>

                            {top10LossProducts.length > 0 ? (
                                <div className="h-80 w-full min-h-[260px]">
                                    <ResponsiveContainer width="100%" height="100%" minHeight={260}>
                                        <BarChart data={top10LossProducts} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                                            <XAxis dataKey="name" stroke="#666" tick={{ fill: '#999', fontSize: 12 }} tickLine={false} axisLine={false} />
                                            <YAxis stroke="#666" tick={{ fill: '#999', fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v.toLocaleString()}₺`} />
                                            <Tooltip
                                                cursor={{ fill: '#ffffff10' }}
                                                contentStyle={{ backgroundColor: '#151828', borderColor: '#ef4444', borderRadius: '16px', color: '#fff' }}
                                                itemStyle={{ color: '#fff', fontWeight: 'bold' }}
                                                formatter={(value, name) => [`${value.toLocaleString('tr-TR')} TL`, 'Mali Kayıp']}
                                            />
                                            <Bar dataKey="kayipDeger" radius={[8, 8, 0, 0]}>
                                                {top10LossProducts.map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={'#EF4444'} />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            ) : (
                                <div className="h-64 flex items-center justify-center border-2 border-dashed border-white/5 rounded-2xl">
                                    <p className="text-gray-500 font-bold tracking-widest uppercase">HARİKA! HİÇ FİRE/KAYIP YOK.</p>
                                </div>
                            )}
                        </div>

                        {/* Branch Overviews Table */}
                        <div className="bg-izbel-card border border-white/5 rounded-[2rem] overflow-hidden">
                            <div className="p-6 border-b border-white/5 bg-white/[0.02]">
                                <h3 className="font-black text-xl tracking-tight text-white uppercase">�?ube Performans Tablosu</h3>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="border-b border-white/5 bg-white/[0.01]">
                                            <th className="p-6 text-xs font-bold text-gray-500 uppercase tracking-widest whitespace-nowrap">�?ube Kodu / Adresi</th>
                                            <th className="p-6 text-xs font-bold text-gray-500 uppercase tracking-widest whitespace-nowrap">Durum</th>
                                            <th className="p-6 text-xs font-bold text-gray-500 uppercase tracking-widest whitespace-nowrap">Okutulan Çeşit</th>
                                            <th className="p-6 text-xs font-black text-red-500 uppercase tracking-widest whitespace-nowrap">Kayıp Adet</th>
                                            <th className="p-6 text-xs font-black text-green-500 uppercase tracking-widest whitespace-nowrap">Fazla Adet</th>
                                            <th className="p-6 text-xs font-bold text-blue-400 uppercase tracking-widest whitespace-nowrap text-right">Variyans (TL)</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {branchSummaries.length === 0 ? (
                                            <tr><td colSpan="6" className="p-10 text-center font-bold text-gray-600">Henüz şube bulunmuyor.</td></tr>
                                        ) : branchSummaries.map((b) => (
                                            <tr key={b.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors group">
                                                <td className="p-6">
                                                    <div className="font-bold text-lg text-gray-200 group-hover:text-white transition-colors">{b.branch_name}</div>
                                                </td>
                                                <td className="p-6">
                                                    <span className={`px-4 py-2 inline-flex text-xs font-bold uppercase tracking-widest rounded-xl border 
                                       ${b.status === 'Onaylandı' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                                                            b.status === 'Onay Bekliyor' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                                                                b.status === 'Devam Ediyor' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20 animate-pulse' :
                                                                    'bg-white/5 text-gray-500 border-white/10'}`}>
                                                        {b.status}
                                                    </span>
                                                </td>
                                                <td className="p-6 font-mono text-xl font-bold text-gray-400">{b.totalCounted}</td>
                                                <td className="p-6 font-mono text-xl font-black text-red-500">{b.mis > 0 ? `-${b.mis}` : '0'}</td>
                                                <td className="p-6 font-mono text-xl font-black text-green-500">{b.exc > 0 ? `+${b.exc}` : '0'}</td>
                                                <td className="p-6 text-right font-mono text-xl font-black">
                                                    <span className={b.diffValue < 0 ? 'text-red-500' : b.diffValue > 0 ? 'text-green-500' : 'text-gray-600'}>
                                                        {b.diffValue > 0 ? '+' : ''}{b.diffValue.toLocaleString('tr-TR')}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* DETAILED PRODUCTS LIST FOR SELECTED BRANCH */}
                        {selectedBranchId !== 'ALL' && (
                            <div className="bg-izbel-card border border-white/5 rounded-[2rem] overflow-hidden print:bg-white print:border-none print:shadow-none print:p-0 print:m-0">

                                {/* PRINT HEADER - ONLY VISIBLE WHEN PRINTING */}
                                <div className="hidden print:block text-black text-center mb-6 border-b-2 border-black pb-4">
                                    <h2 className="text-2xl font-black uppercase tracking-tight">�?UBE SAYIM ÇIKTISI</h2>
                                    <p className="text-lg font-bold mt-1">{branches.find(b => b.id === selectedBranchId)?.branch_name}</p>
                                    <div className="flex justify-between items-center text-sm font-medium mt-4 px-4">
                                        <span>Sayım Dönemi: {periods.find(p => p.id === selectedPeriodId)?.period_name || 'Tüm Zamanlar'}</span>
                                        <span>Yazdırılma Tarihi: {new Date().toLocaleString('tr-TR')}</span>
                                    </div>
                                </div>

                                <div className="p-6 border-b border-white/5 bg-white/[0.02] flex justify-between items-center print:hidden">
                                    <div>
                                        <h3 className="font-black text-xl tracking-tight text-white uppercase flex items-center gap-3">
                                            <Package className="text-blue-500" /> �?ubeye Ait Sayılmış Ürünler Listesi
                                        </h3>
                                        <p className="text-sm text-gray-500 font-medium">Bu şubenin saydığı tüm ürün kalemleri ve fark detayları</p>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={() => {
                                                const originalTitle = document.title;
                                                document.title = `Sayim_Ciktisi_${branches.find(b => b.id === selectedBranchId)?.branch_name}_${new Date().toISOString().split('T')[0]}`;
                                                window.print();
                                                setTimeout(() => { document.title = originalTitle; }, 500);
                                            }}
                                            className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-6 rounded-xl transition-all shadow-lg flex items-center gap-2"
                                        >
                                            <Printer size={18} /> YAZDIR
                                        </button>
                                        {selectedRecords.length > 0 && (
                                            <button
                                                onClick={handleDeleteSelected}
                                                disabled={isLoading}
                                                className="bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-6 rounded-xl transition-all shadow-[0_0_15px_rgba(220,38,38,0.5)] flex items-center gap-2"
                                            >
                                                <Trash2 size={18} /> SEÇİLENLERİ SİL ({selectedRecords.length})
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <div className="overflow-x-auto max-h-[600px] overflow-y-auto print:max-h-none print:overflow-visible">
                                    <table className="w-full text-left border-collapse">
                                        <thead className="sticky top-0 bg-izbel-dark/95 backdrop-blur z-10 print:static print:bg-white">
                                            <tr className="border-b border-white/5 bg-white/[0.01]">
                                                <th className="p-6 w-10 text-center print:hidden">
                                                    <input
                                                        type="checkbox"
                                                        className="w-5 h-5 rounded cursor-pointer accent-blue-500"
                                                        checked={filteredCounts.length > 0 && selectedRecords.length === filteredCounts.length}
                                                        onChange={(e) => {
                                                            if (e.target.checked) {
                                                                setSelectedRecords(filteredCounts.map(c => c.id));
                                                            } else {
                                                                setSelectedRecords([]);
                                                            }
                                                        }}
                                                    />
                                                </th>
                                                <th className="p-6 text-xs font-bold text-gray-500 uppercase tracking-widest">Sistem Ürün Bilgisi</th>
                                                <th className="p-6 text-xs font-bold text-gray-500 uppercase tracking-widest">Kategori</th>
                                                <th className="p-6 text-xs font-bold text-gray-500 uppercase tracking-widest min-w-[140px]">İlk / Son (İstanbul)</th>
                                                <th className="p-6 text-xs font-bold text-gray-500 uppercase tracking-widest text-center">�?ube sistemi stok</th>
                                                <th className="p-6 text-xs font-bold text-blue-400 uppercase tracking-widest text-center">Sayım Bulunan</th>
                                                <th className="p-6 text-xs font-bold text-gray-500 uppercase tracking-widest text-right">Fark</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/5">
                                            {filteredCounts
                                                .filter(c => {
                                                    if (!onlyMissingBarcode) return true;
                                                    const brk = (c.products?.barcode || '').trim();
                                                    return !brk;
                                                })
                                                .map(c => {
                                                const times = formatIstanbulCountTimes(c);
                                                const sys = sysStockForCount(c);
                                                const count = c.counted_stock;
                                                const diff = count - sys;
                                                const price = unitCostForCount(c);
                                                const valDiff = diff * price;

                                                return (
                                                    <tr key={c.id} className="hover:bg-white/[0.02] transition-colors">
                                                        <td className="p-6 text-center border-r border-white/5 print:hidden">
                                                            <input
                                                                type="checkbox"
                                                                className="w-5 h-5 rounded cursor-pointer accent-blue-500"
                                                                checked={selectedRecords.includes(c.id)}
                                                                onChange={(e) => {
                                                                    if (e.target.checked) {
                                                                        setSelectedRecords(prev => [...prev, c.id]);
                                                                    } else {
                                                                        setSelectedRecords(prev => prev.filter(id => id !== c.id));
                                                                    }
                                                                }}
                                                            />
                                                        </td>
                                                        <td className="p-6">
                                                            <div className="font-bold text-white mb-1">{c.products?.product_name}</div>
                                                            <div className="text-xs font-mono text-gray-500 flex items-center gap-2">
                                                                {(c.products?.barcode && String(c.products.barcode).trim()) ? (
                                                                    <span className="bg-emerald-500/10 text-emerald-300 px-2 py-1 rounded border border-emerald-500/20">BRK: {c.products.barcode}</span>
                                                                ) : (
                                                                    <span className="bg-amber-500/10 text-amber-300 px-2 py-1 rounded border border-amber-500/20">BRK: YOK</span>
                                                                )}
                                                                <span className="font-sans font-bold text-gray-400">B.Fiyat: {price} ₺</span>
                                                            </div>
                                                        </td>
                                                        <td className="p-6">
                                                            <span className="bg-white/5 px-3 py-1 rounded-lg border border-white/5 text-[10px] uppercase font-bold text-gray-400 tracking-widest">
                                                                {c.products?.category || 'KATEGORİSİZ'}
                                                            </span>
                                                        </td>
                                                        <td className="p-6 text-[10px] text-cyan-200/85 font-mono leading-snug align-top">
                                                            <div>İlk: {times.first}</div>
                                                            <div>Son: {times.last}</div>
                                                        </td>
                                                        <td className="p-6 font-mono text-xl text-gray-500 font-bold text-center">
                                                            {sys} <span className="text-xs text-gray-600 ml-1 font-sans">{c.products?.unit || 'Adet'}</span>
                                                        </td>
                                                        <td className="p-6 font-mono text-xl text-blue-400 font-bold bg-blue-500/5 text-center">
                                                            {count} <span className="text-xs text-blue-500/50 ml-1 font-sans">{c.products?.unit || 'Adet'}</span>
                                                        </td>
                                                        <td className="p-6 font-mono text-right">
                                                            <div className={`text-xl font-black ${diff < 0 ? 'text-red-500' : diff > 0 ? 'text-green-500' : 'text-gray-600'}`}>
                                                                {diff > 0 ? '+' : ''}{diff} <span className="text-xs font-sans font-bold opacity-50 ml-1">{c.products?.unit || 'Adet'}</span>
                                                            </div>
                                                            <div className={`text-xs font-bold mt-1 ${valDiff < 0 ? 'text-red-500/80' : valDiff > 0 ? 'text-green-500/80' : 'text-gray-600'}`}>
                                                                {valDiff > 0 ? '+' : ''}{valDiff.toLocaleString('tr-TR')} ₺
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )
                                            })}
                                            {filteredCounts.length === 0 && (
                                                <tr><td colSpan="8" className="p-10 text-center font-bold text-gray-600">Bu şubede şu an kayıtlı sayım yok.</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>
                )}


                {/* --------- TAB 2: BRANCH MANAGEMENT --------- */}
                {activeTab === 'subeler' && (
                    <div className="space-y-10 animate-fade-in">
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                            {/* Create New Branch Form */}
                            <div className="bg-izbel-card border border-white/5 rounded-[2rem] p-8 lg:col-span-1 border-t-4 border-t-blue-500">
                                <h2 className="text-2xl font-black mb-6 tracking-tight flex items-center gap-3">
                                    <Users className="text-blue-500" /> Yeni �?ube Aç
                                </h2>
                                <form onSubmit={handleAddBranch} className="space-y-5">
                                    <div>
                                        <label className="text-xs uppercase font-bold tracking-widest text-gray-500 mb-2 block pl-2">�?ube Tam Adı</label>
                                        <input required value={newBranchName} onChange={e => setNewBranchName(e.target.value)} placeholder="Örn: Kadıköy �?ubesi" className="w-full bg-izbel-dark border border-white/10 p-4 rounded-xl focus:border-blue-500 outline-none font-medium" />
                                    </div>
                                    <div>
                                        <label className="text-xs uppercase font-bold tracking-widest text-gray-500 mb-2 block pl-2">Sistem Giriş Adı</label>
                                        <input required value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder="Örn: kadikoy01" className="w-full bg-izbel-dark border border-white/10 p-4 rounded-xl focus:border-blue-500 outline-none font-medium" />
                                    </div>
                                    <div>
                                        <label className="text-xs uppercase font-bold tracking-widest text-gray-500 mb-2 block pl-2">Belirlenen �?ifre</label>
                                        <input required value={newPassword} onChange={e => setNewPassword(e.target.value)} type="text" placeholder="Giriş şifresi belirle" className="w-full bg-izbel-dark border border-white/10 p-4 rounded-xl focus:border-blue-500 outline-none font-medium" />
                                    </div>
                                    <button type="submit" disabled={isLoading} className="w-full bg-blue-600 hover:bg-blue-500 transition-colors text-white font-black py-4 rounded-xl tracking-widest mt-4">
                                        {isLoading ? '...' : '�?UBEYİ KAYDET'}
                                    </button>
                                </form>
                            </div>

                            {/* Existing Branches List */}
                            <div className="bg-izbel-card border border-white/5 rounded-[2rem] overflow-hidden lg:col-span-2">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-white/[0.02] border-b border-white/5">
                                            <th className="p-6 text-xs font-bold text-gray-500 uppercase tracking-widest">�?ube Adı</th>
                                            <th className="p-6 text-xs font-bold text-gray-500 uppercase tracking-widest">Kullanıcı Adı</th>
                                            <th className="p-6 text-xs font-bold text-gray-500 uppercase tracking-widest">Atanan �?ifre</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {branches.map(b => (
                                            <tr key={b.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                                                <td className="p-6 font-bold text-lg">{b.branch_name}</td>
                                                <td className="p-6 font-mono text-blue-400 bg-white/[0.02] border-x border-white/5">{b.username}</td>
                                                <td className="p-6 font-mono text-gray-400 tracking-widest">{b.password_hash}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                        </div>

                        <div className="bg-rose-950/40 border border-rose-500/30 rounded-[2rem] p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                            <div>
                                <h3 className="text-lg font-black text-rose-200 flex items-center gap-2">
                                    <RotateCcw size={20} /> Sayım kayıtlarını sıfırla
                                </h3>
                                <p className="text-sm text-rose-200/70 mt-1 font-medium max-w-xl">
                                    Tüm <code className="text-xs bg-black/20 px-1 rounded">counts</code> satırları silinir. Ürün kartları, maliyetler ve şube stok tablosu korunur. Onay için SIFIRLA yazmanız istenir.
                                </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-3 justify-end mt-4 md:mt-0">
                                <button
                                    type="button"
                                    disabled={isLoading}
                                    onClick={() => void handleResetAllCounts()}
                                    className="shrink-0 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white font-black py-4 px-8 rounded-xl uppercase tracking-widest text-xs shadow-lg border border-rose-400/40"
                                >
                                    Tüm sayımları sil
                                </button>
                                <button
                                    type="button"
                                    disabled={isLoading}
                                    onClick={() => void handleResetDatabaseStocks()}
                                    className="shrink-0 bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white font-black py-4 px-8 rounded-xl uppercase tracking-widest text-xs shadow-lg border border-red-400/40"
                                >
                                    Ana Sistem Stoklarını Sıfırla
                                </button>
                            </div>
                        </div>

                        <div className="bg-izbel-card border border-white/5 rounded-[2rem] overflow-hidden border-t-4 border-t-emerald-500/80">
                            <div className="p-6 border-b border-white/10 bg-white/[0.02] flex flex-col lg:flex-row lg:items-end gap-4 flex-wrap">
                                <div className="flex-1">
                                    <h2 className="text-2xl font-black tracking-tight flex items-center gap-3">
                                        <Warehouse className="text-emerald-400" /> �?ube bazlı sistem stoku
                                    </h2>
                                    <p className="text-sm text-gray-500 font-medium mt-2 max-w-2xl">
                                        <code className="text-[10px] bg-black/30 px-1 rounded">branch_stocks</code>
                                        {' '}tablosunda hem beklenen stok hem isteğe bağlı <strong className="text-gray-400 font-bold">şube birim maliyeti</strong> tutulur; maliyet boşsa ürün kartı alım fiyatı kullanılır. Sayım ekranında personel bu stoku “Beklenen stok” olarak görür. Sayım kayıtları{' '}
                                        <code className="text-[10px] bg-black/30 px-1 rounded">branch_id</code>
                                        {' '}ile ayrılır (aynı ürün farklı şubelerde karışmaz).
                                    </p>
                                </div>
                                <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
                                    <label className="flex flex-col gap-1 text-xs font-bold text-gray-500 uppercase tracking-widest">
                                        �?ube
                                        <select
                                            value={stockEntryBranchId}
                                            onChange={e => setStockEntryBranchId(e.target.value)}
                                            className="bg-izbel-dark border border-white/10 rounded-xl py-3 px-4 text-white font-bold min-w-[200px] outline-none focus:border-emerald-500"
                                        >
                                            {branches.map(b => (
                                                <option key={b.id} value={b.id}>{b.branch_name}</option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="flex flex-col gap-1 text-xs font-bold text-gray-500 uppercase tracking-widest flex-1 min-w-[180px]">
                                        Ürün ara
                                        <div className="relative">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                                            <input
                                                value={stockEntrySearch}
                                                onChange={e => setStockEntrySearch(e.target.value)}
                                                placeholder="Stok kodu, ad, barkod..."
                                                className="w-full bg-izbel-dark border border-white/10 rounded-xl py-3 pl-10 pr-4 text-white font-medium outline-none focus:border-emerald-500"
                                            />
                                        </div>
                                    </label>
                                    <label className="flex items-end gap-2 pb-1 cursor-pointer select-none">
                                        <input
                                            type="checkbox"
                                            checked={stockEntryShowFullCatalog}
                                            onChange={e => setStockEntryShowFullCatalog(e.target.checked)}
                                            className="w-4 h-4 rounded border-white/20 bg-izbel-dark text-emerald-500 focus:ring-emerald-500"
                                        />
                                        <span className="text-xs text-gray-400 font-medium max-w-[200px] leading-snug">
                                            Tüm katalog (şubeye yeni ürün eklemek için)
                                        </span>
                                    </label>
                                    <label className="flex flex-col gap-1 text-xs font-bold text-gray-500 uppercase tracking-widest">
                                        Excel/CSV ile şube ürünü ata
                                        <span className="flex items-center gap-2 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 rounded-xl px-4 py-3 cursor-pointer transition-all">
                                            <Download size={14} className="text-emerald-300" />
                                            <span className="text-white normal-case text-sm font-bold">
                                                {branchMapImporting ? 'İçe aktarılıyor...' : 'Dosya seç'}
                                            </span>
                                            <input
                                                type="file"
                                                accept=".xlsx,.xls,.csv"
                                                className="sr-only"
                                                onChange={handleBranchProductMapImport}
                                                disabled={branchMapImporting}
                                            />
                                        </span>
                                    </label>
                                    <label className="flex flex-col gap-1 text-xs font-bold text-gray-500 uppercase tracking-widest">
                                        URUNISMISUBEMALIYET.csv
                                        <span className="flex items-center gap-2 bg-sky-600/20 hover:bg-sky-600/30 border border-sky-500/30 rounded-xl px-4 py-3 cursor-pointer transition-all">
                                            <Package size={14} className="text-sky-300" />
                                            <span className="text-white normal-case text-sm font-bold">
                                                {urunSubeMaliyetImporting ? 'İçe aktarılıyor...' : 'Ürün;�?ube;Maliyet CSV'}
                                            </span>
                                            <input
                                                type="file"
                                                accept=".csv,.txt"
                                                className="sr-only"
                                                onChange={handleUrunIsmSubeMaliyetCsvImport}
                                                disabled={urunSubeMaliyetImporting}
                                            />
                                        </span>
                                    </label>
                                </div>
                            </div>
                            {stockEntryBranchId && !stockEntryShowFullCatalog && stockEntryBranchProductIds != null && (
                                <div className="px-6 pb-2 text-xs font-bold text-emerald-400/90">
                                    Bu şubede {stockEntryBranchProductIds.size} ürün tanımlı (yalnız bunlar listelenir).
                                </div>
                            )}
                            <div className="overflow-x-auto max-h-[min(70vh,560px)] overflow-y-auto">
                                <table className="w-full text-left text-sm min-w-[760px]">
                                    <thead className="sticky top-0 bg-izbel-dark z-10 border-b border-white/10">
                                        <tr className="text-gray-500 uppercase text-[10px] tracking-widest font-black">
                                            <th className="p-3 pl-6">Stok kodu</th>
                                            <th className="p-3 min-w-[200px]">Ürün</th>
                                            <th className="p-3">Birim</th>
                                            <th className="p-3 text-right">Birim maliyet (₺)</th>
                                            <th className="p-3 text-right pr-6">�?ube stok</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {stockEntryBranchId && stockEntryProducts.map(p => {
                                            const draftVal = stockEntryDrafts[p.id];
                                            const costDraft = stockEntryCostDrafts[p.id];
                                            const mapKey = `${stockEntryBranchId}|${p.id}`;
                                            const saved = branchStockMap.has(mapKey) ? branchStockMap.get(mapKey) : null;
                                            const display = draftVal !== undefined ? draftVal : (saved !== null && saved !== undefined ? String(saved) : '');
                                            const savedCostRaw = branchStockByKey.get(mapKey)?.unit_cost;
                                            const savedCost = savedCostRaw != null && savedCostRaw !== '' && Number.isFinite(Number(savedCostRaw))
                                                ? String(savedCostRaw)
                                                : '';
                                            const costDisplay = costDraft !== undefined ? costDraft : savedCost;
                                            return (
                                                <tr key={p.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                                                    <td className="p-3 pl-6 font-mono text-blue-300/90 text-xs">{p.stok_kodu || '—'}</td>
                                                    <td className="p-3 font-medium text-white">{p.product_name}</td>
                                                    <td className="p-3 text-gray-400 text-xs">{p.unit || 'Adet'}</td>
                                                    <td className="p-3 text-right">
                                                        <input
                                                            type="text"
                                                            inputMode="decimal"
                                                            value={costDisplay}
                                                            onChange={e => setStockEntryCostDrafts(prev => ({ ...prev, [p.id]: e.target.value }))}
                                                            onBlur={(e) => {
                                                                void saveBranchProductUnitCost(stockEntryBranchId, p.id, e.target.value);
                                                            }}
                                                            onKeyDown={e => {
                                                                if (e.key === 'Enter') {
                                                                    e.target.blur();
                                                                }
                                                            }}
                                                            disabled={stockEntrySaving}
                                                            className="w-24 md:w-28 bg-izbel-dark border border-white/10 rounded-lg py-2 px-2 text-right font-mono text-amber-300/90 text-sm outline-none focus:border-amber-500 disabled:opacity-50"
                                                            placeholder="—"
                                                            title="Boş bırakılırsa ürün kartı alım fiyatı kullanılır"
                                                        />
                                                    </td>
                                                    <td className="p-3 pr-6 text-right">
                                                        <input
                                                            type="text"
                                                            inputMode="decimal"
                                                            value={display}
                                                            onChange={e => setStockEntryDrafts(prev => ({ ...prev, [p.id]: e.target.value }))}
                                                            onBlur={(e) => {
                                                                void saveBranchProductStock(stockEntryBranchId, p.id, e.target.value);
                                                            }}
                                                            onKeyDown={e => {
                                                                if (e.key === 'Enter') {
                                                                    e.target.blur();
                                                                }
                                                            }}
                                                            disabled={stockEntrySaving}
                                                            className="w-28 md:w-36 bg-izbel-dark border border-white/10 rounded-lg py-2 px-3 text-right font-mono text-emerald-300 font-bold outline-none focus:border-emerald-500 disabled:opacity-50"
                                                            placeholder="0"
                                                        />
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        {stockEntryBranchId && stockEntryProducts.length === 0 && (
                                            <tr>
                                                <td colSpan={5} className="p-10 text-center text-gray-500 font-bold space-y-2">
                                                    <p>
                                                        {stockEntryShowFullCatalog
                                                            ? 'Eşleşen ürün yok; aramayı değiştirin.'
                                                            : (stockEntryBranchProductIds?.size === 0
                                                                ? 'Bu şubede henüz atanmış ürün yok. CSV ile içe aktarın veya «Tüm katalog» ile ürün seçip stok girin.'
                                                                : 'Aramanız bu şubedeki ürünlerle eşleşmedi.')}
                                                    </p>
                                                </td>
                                            </tr>
                                        )}
                                        {!stockEntryBranchId && (
                                            <tr><td colSpan={5} className="p-10 text-center text-gray-500 font-bold">Önce şube ekleyin.</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                            <div className="p-4 border-t border-white/5 text-[10px] text-gray-500 font-medium">
                                Varsayılan: seçili şubede{' '}
                                <code className="bg-black/30 px-1 rounded">branch_stocks</code>
                                {' '}kayıtlı ürünler listelenir; stok ve birim maliyet buradan düzenlenir. «Tüm katalog» ile o şubeye henüz atanmamış ürünlere de satır açabilirsiniz. En fazla 600 satır; arama ile daraltın.
                                <br />
                                Import: Genel Excel/CSV (mevcut şube birim maliyeti korunur). URUNISMISUBEMALIYET: önce stok kodu, barkod, sonra ad. Stok sıfırlanmaz; maliyet boşsa eski değer kalır.
                            </div>
                        </div>
                    </div>
                )}


                {/* --------- TAB 3: PRODUCT DETAILS & APPROVALS --------- */}
                {activeTab === 'urunler' && (
                    <div className="bg-izbel-card border border-white/5 rounded-[2rem] animate-fade-in overflow-hidden shadow-2xl">
                        <div className="p-6 border-b border-white/5 flex flex-col gap-4 bg-white/[0.01]">
                            <div>
                                <h2 className="text-2xl font-black tracking-tight flex items-center gap-3">
                                    <CheckCircle2 className="text-green-500" /> Ürün Sayım Onay Departmanı
                                </h2>
                                <p className="text-sm text-gray-500 font-medium mt-1">Personelin girdiği sayımları inceleyin ve kesin stok olarak onaylayın</p>
                            </div>

                            <div className="flex flex-col items-stretch md:items-center gap-3 w-full md:w-auto">
                                <div className="flex bg-izbel-dark p-1 rounded-xl border border-white/10 text-xs font-bold shrink-0 self-start">
                                    <button onClick={() => setSelectedPeriodId('ALL')} className={`px-4 py-2 rounded-lg transition-colors ${selectedPeriodId === 'ALL' ? 'bg-blue-600 text-white' : 'text-gray-400'}`}>Genel Liste</button>
                                    <button onClick={() => { const a = periods.find(p => p.is_active); if (a) setSelectedPeriodId(a.id); }} className={`px-4 py-2 rounded-lg transition-colors overflow-hidden ${selectedPeriodId !== 'ALL' ? 'bg-blue-600 text-white' : 'text-gray-400'}`}>Aktif Sayım</button>
                                </div>
                                <div className="flex bg-izbel-dark p-1 rounded-xl border border-white/10 text-xs font-bold shrink-0 items-center self-start">
                                    <select
                                        value={selectedBranchId}
                                        onChange={(e) => setSelectedBranchId(e.target.value)}
                                        className="bg-transparent text-gray-300 font-bold py-1 px-3 outline-none appearance-none cursor-pointer"
                                    >
                                        <option value="ALL">Tüm �?ubeler</option>
                                        {branches.map(b => (
                                            <option key={b.id} value={b.id}>{b.branch_name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="relative w-full md:w-auto">
                                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                                    <input
                                        type="text"
                                        placeholder="Ara..."
                                        value={productSearch}
                                        onChange={e => setProductSearch(e.target.value)}
                                        className="bg-izbel-dark border border-white/10 rounded-xl py-3 pl-11 pr-4 text-sm font-bold text-white outline-none focus:border-blue-500 w-full md:w-48"
                                    />
                                </div>
                                <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-gray-400 bg-izbel-dark border border-white/10 px-3 py-3 rounded-xl self-start">
                                    <input
                                        type="checkbox"
                                        checked={onlyMissingBarcode}
                                        onChange={(e) => setOnlyMissingBarcode(e.target.checked)}
                                        className="rounded accent-amber-500"
                                    />
                                    Barkodsuzlar
                                </label>
                                <button onClick={() => {
                                    const originalTitle = document.title;
                                    document.title = `Urun_Onay_Listesi_${new Date().toISOString().split('T')[0]}`;
                                    window.print();
                                    setTimeout(() => { document.title = originalTitle; }, 500);
                                }} className="flex items-center gap-2 bg-purple-600/30 hover:bg-purple-600/50 text-purple-400 hover:text-white font-bold py-2.5 px-4 rounded-xl transition-all border border-purple-500/30 print:hidden self-start">
                                    <Printer size={18} /> Yazdır
                                </button>
                                <label className="flex flex-col gap-0.5 cursor-pointer self-start">
                                    <span className="text-[9px] font-bold uppercase tracking-widest text-gray-500">�?ube satışı (xlsx / csv / txt)</span>
                                    <span className="flex items-center gap-2 bg-amber-600/25 hover:bg-amber-600/40 text-amber-100 font-bold py-2.5 px-4 rounded-xl border border-amber-500/30 print:hidden">
                                        <Download size={16} />
                                        {salesImporting ? 'Yükleniyor...' : 'Satış içe aktar'}
                                        <input
                                            type="file"
                                            accept=".xlsx,.xls,.csv,.txt"
                                            className="sr-only"
                                            onChange={handleBranchSalesImport}
                                            disabled={salesImporting}
                                        />
                                    </span>
                                </label>

                                <label className="flex flex-col gap-0.5 cursor-pointer self-start">
                                    <span className="text-[9px] font-bold uppercase tracking-widest text-gray-500">Reçete (Receteler.csv)</span>
                                    <span className="flex items-center gap-2 bg-cyan-600/25 hover:bg-cyan-600/40 text-cyan-100 font-bold py-2.5 px-4 rounded-xl border border-cyan-500/30 print:hidden">
                                        <Download size={16} />
                                        {recipeImporting ? 'Yükleniyor...' : 'Reçete içe aktar'}
                                        <input
                                            type="file"
                                            accept=".csv,.txt"
                                            className="sr-only"
                                            onChange={handleRecipeCsvImport}
                                            disabled={recipeImporting}
                                        />
                                    </span>
                                </label>
                                <button
                                    type="button"
                                    onClick={undoLastSalesChange}
                                    disabled={salesUndoStack.length === 0}
                                    className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-sky-300 border border-white/10 rounded-lg px-2 py-2 print:hidden disabled:opacity-35 disabled:pointer-events-none self-start"
                                    title="Son satış içe aktarma veya satış temizleme işlemini geri alır (en fazla 15 adım)"
                                >
                                    <RotateCcw size={14} /> Geri al ({salesUndoStack.length})
                                </button>
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
                                    onClick={() => void clearAllMasterData()}
                                    className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-white hover:text-red-300 border border-red-500/30 rounded-lg px-2 py-2 bg-red-600/20 print:hidden self-start"
                                    title="Bu ekrandaki geçici (RAM'deki) Satışları, Eşleştirmeleri, Tedarikleri vs. temizler."
                                >
                                    Geçici Verileri Sıfırla
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void applyRecipeConsumptionToBranchStocks()}
                                    className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-emerald-300 hover:text-white border border-emerald-500/30 rounded-lg px-2 py-2 bg-emerald-600/20 print:hidden self-start"
                                    title="Seçili şubenin satış verisi + reçeteye göre malzeme stokunu branch_stocks tablosundan düşer"
                                >
                                    Reçeteye göre düş
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void undoLastRecipeStockApply()}
                                    disabled={stockApplyUndoStack.length === 0}
                                    className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-emerald-200 border border-white/10 rounded-lg px-2 py-2 print:hidden disabled:opacity-35 disabled:pointer-events-none self-start"
                                    title="Son reçete stok düşümünü geri alır"
                                >
                                    <RotateCcw size={14} /> Stok geri al ({stockApplyUndoStack.length})
                                </button>
                                <button onClick={() => setShowExportCategoriesModal(true)} className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white font-bold py-2.5 px-4 rounded-xl transition-all border border-white/5 print:hidden self-start">
                                    <Download size={18} /> Excel'e Dök
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowApprovalFullscreen(true)}
                                    className="flex items-center gap-2 bg-izbel-dark border border-white/10 hover:bg-white/10 text-gray-200 font-bold py-3 px-4 rounded-xl transition-all text-xs uppercase tracking-widest"
                                >
                                    Tam Ekran Liste
                                </button>
                            </div>
                            <details className="mt-4 rounded-xl border border-amber-500/25 bg-amber-950/15 px-4 py-3 print:hidden">
                                <summary className="text-xs font-bold text-amber-200/90 cursor-pointer select-none">
                                    SCLogger — PDF’ten kopyalanan satış metni
                                </summary>
                                <p className="text-[10px] text-gray-500 mt-2 leading-relaxed">
                                    Önce şubeyi seçin. «Başarılı Satış Ürün Toplamları» tablosunu PDF’ten seçip kopyalayın; her satır: ürün adı, adet, tutar (örn.{' '}
                                    <span className="font-mono text-gray-400">98.160,00</span>
                                    ).                                     Başlık / tarih / sayfa altı satırları otomatik atlanır. Yanlış aktarımda üstteki «Geri al» ile önceki satış haritasına dönebilirsiniz (en fazla 15 adım).
                                </p>
                                <textarea
                                    value={scLoggerPaste}
                                    onChange={(e) => setScLoggerPaste(e.target.value)}
                                    rows={7}
                                    className="w-full mt-2 bg-izbel-dark border border-white/10 rounded-lg p-3 text-xs text-white font-mono placeholder-gray-600 outline-none focus:border-amber-500/50"
                                    placeholder={'KARI�?IK SICAK TABAK 818 98.160,00\nKA�?ARLI TOST 1056 63.360,00\n...'}
                                    spellCheck={false}
                                />
                                <button
                                    type="button"
                                    disabled={salesImporting}
                                    onClick={() => importScLoggerPlainText(scLoggerPaste)}
                                    className="mt-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-bold py-2.5 px-4 rounded-lg"
                                >
                                    Metinden satış aktar
                                </button>
                            </details>
                            <div className="mt-3 rounded-xl border border-fuchsia-500/25 bg-fuchsia-950/10 px-4 py-3 print:hidden">
                                <div className="flex flex-wrap items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={openSupplyModal}
                                        className="bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-bold py-2 px-3 rounded-lg"
                                    >
                                        Tedarik gir (kategori + arama) {selectedBranchManualPurchaseCount > 0 ? `(${selectedBranchManualPurchaseCount})` : ''}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={clearManualPurchasesForSelectedBranch}
                                        className="bg-white/10 hover:bg-white/20 text-gray-200 text-xs font-bold py-2 px-3 rounded-lg border border-white/10"
                                    >
                                        Bu şubenin alımını temizle
                                    </button>
                                </div>
                                <p className="text-[10px] text-gray-500 mt-2">
                                    Tedarikler seçili şube için kaydedilir ve reçete düşümünde <span className="font-mono">stok + tedarik - tüketim</span> formülü kullanılır.
                                </p>
                            </div>
                            {recipeUnmatched.length > 0 && (
                                <details className="mt-3 rounded-xl border border-cyan-500/25 bg-cyan-950/10 px-4 py-3 print:hidden" open>
                                    <summary className="text-xs font-bold text-cyan-200/90 cursor-pointer select-none">
                                        Reçete eşleşmeyen ürünler ({recipeUnmatched.length})
                                    </summary>
                                    <p className="text-[10px] text-gray-500 mt-2">Eşleşmeyen satırlarda sistemdeki doğru ürünü seçin, sonra «Seçimleri uygula» deyin.</p>
                                    <div className="mt-2 max-h-56 overflow-auto space-y-2 pr-1">
                                        {recipeUnmatched.slice(0, 120).map((u) => (
                                            <div key={u.mapKey} className="grid grid-cols-[auto,1fr] gap-2 items-center text-xs">
                                                <div className="text-gray-400 font-mono">{u.kind === 'recipe' ? 'Reçete' : 'Bileşen'} · {u.stok_kodu || '—'} · {u.product_name}</div>
                                                <select
                                                    value={recipeManualMap[u.mapKey] || ''}
                                                    onChange={(ev) => setRecipeManualMap((m) => ({ ...m, [u.mapKey]: ev.target.value }))}
                                                    className="bg-izbel-dark border border-white/10 rounded-md py-1.5 px-2 text-white"
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
                                        onClick={() => void applyManualRecipeMatches()}
                                        disabled={recipeImporting}
                                        className="mt-3 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-bold py-2 px-3 rounded-lg"
                                    >
                                        Seçimleri uygula
                                    </button>
                                </details>
                            )}
                            {selectedBranchId !== 'ALL' && salesRecipeAllForBranch.length > 0 && (
                                <details className="mt-3 rounded-xl border border-emerald-500/25 bg-emerald-950/10 px-4 py-3 print:hidden" open>
                                    <summary className="text-xs font-bold text-emerald-200/90 cursor-pointer select-none">
                                        Satış -{'>'} Reçete / ürün eşleştirme ({salesRecipeNeedsMapping.length} eşleşmeyen / {salesRecipeAllForBranch.length} toplam)
                                    </summary>
                                    <p className="text-[10px] text-gray-500 mt-2">
                                        Buradan eşleşmeyenleri veya istersen eşleşmiş kayıtları tekrar düzenleyebilirsiniz. Seçilen ürünün reçetesi varsa reçeteye göre düşülür; reçetesi yoksa ürün kendisinden 1'e 1 düşülür.
                                    </p>
                                    <div className="mt-3 flex flex-wrap items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setSalesRecipeShowResolved((v) => !v)}
                                            className="bg-white/10 hover:bg-white/20 text-white text-xs font-bold py-2.5 px-4 rounded-lg border border-white/10"
                                        >
                                            {salesRecipeShowResolved ? 'Sadece eşleşmeyenleri göster' : 'Eşleşmişleri de göster'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setShowSalesRecipeMapModal(true)}
                                            className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold py-2.5 px-4 rounded-lg"
                                        >
                                            Popup ile eşleştir
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => openRecipeBuilder('')}
                                            className="bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold py-2.5 px-4 rounded-lg"
                                        >
                                            Yeni reçete üret
                                        </button>
                                    </div>
                                    <div className="mt-3 max-h-56 overflow-auto space-y-2 pr-1">
                                        {salesRecipeRowsForUi.slice(0, 120).map((r) => (
                                            <div key={r.sale_product_id} className="grid grid-cols-[auto,1fr] gap-2 items-center text-xs">
                                                <div className="text-gray-400 font-mono">
                                                    Satış: {r.sale_stok_kodu || '—'} · {r.sale_product_name} · {r.sold_qty}
                                                </div>
                                                <select
                                                    value={salesRecipeMap[r.sale_product_id] || ''}
                                                    onChange={(ev) => void persistSalesRecipeMatch(r.sale_product_id, ev.target.value)}
                                                    className="bg-izbel-dark border border-white/10 rounded-md py-1.5 px-2 text-white"
                                                    disabled={!!salesRecipeMapSaving[r.sale_product_id]}
                                                >
                                                    <option value="">Ürün seçiniz...</option>
                                                    {salesRecipeCandidateProducts.map((p) => (
                                                        <option key={p.id} value={p.id}>
                                                            {p.stok_kodu || '—'} · {p.product_name}
                                                        </option>
                                                    ))}
                                                </select>
                                                {salesRecipeMapSaving[r.sale_product_id] && (
                                                    <div className="text-[10px] text-emerald-300 mt-1">Kaydediliyor...</div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </details>
                            )}

                        </div>

                        {/* CSV Import: A=Stok Kodu, B=Stok Adı, C=Grubu, D=Birimi */}
                        <div className="p-4 border-b border-white/5 bg-izbel-dark/20 flex flex-wrap items-center gap-3">
                            <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">�?ubeler Stok CSV ile toplu ürün:</span>
                            <label className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl px-4 py-2 cursor-pointer transition-all">
                                <Download size={16} className="text-blue-400" />
                                <span className="text-sm font-bold text-white">{csvImporting ? 'Yükleniyor...' : 'CSV seç (; ile ayrılmış)'}</span>
                                <input type="file" accept=".csv,.txt" className="sr-only" onChange={handleCsvImport} disabled={csvImporting} />
                            </label>
                            <span className="text-[10px] text-gray-500">Sütunlar: Stok Kodu;Stok Adı;Grubu;Birimi</span>
                            <div className="h-4 w-px bg-white/10 hidden md:block" />
                            <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Stok kartları CSV/XLSX import:</span>
                            <label className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl px-4 py-2 cursor-pointer transition-all">
                                <Download size={16} className="text-emerald-400" />
                                <span className="text-sm font-bold text-white">{stokListImporting ? 'İçe aktarılıyor...' : 'Dosya seç (CSV veya Excel)'}</span>
                                <input
                                    type="file"
                                    accept=".csv,.xlsx,.xls"
                                    className="sr-only"
                                    onChange={handleStokKartlariImport}
                                    disabled={stokListImporting}
                                />
                            </label>
                            <span className="text-[10px] text-gray-500">Başlıklar: Stok Kodu, Stok Adı, Grubu, Maliyet, Birimi, Barkod</span>
                        </div>

                        {/* Stok Kodu – Stok Adı – Grubu eşleşme listesi */}
                        <div className="p-6 border-b border-white/5 bg-izbel-dark/20">
                            <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                                <div className="flex flex-col gap-2">
                                    <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest">Stok kartları: Stok Kodu · Stok Adı · Grubu eşleşme listesi</h3>
                                    <div className="flex flex-wrap items-center gap-3">
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input type="checkbox" checked={stokListOnlyMissing} onChange={e => setStokListOnlyMissing(e.target.checked)} className="rounded accent-amber-500" />
                                            <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Sadece eksik olanlar (kodu veya grubu yok)</span>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input type="checkbox" checked={stokListShowPassive} onChange={e => setStokListShowPassive(e.target.checked)} className="rounded accent-purple-500" />
                                            <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Pasifleri gör</span>
                                        </label>
                                    </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    {stokListSelectedIds.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={handleBulkSetProductPassive}
                                            className="flex items-center gap-2 bg-amber-500/20 hover:bg-amber-500/30 text-xs font-bold uppercase tracking-widest text-amber-200 px-3 py-2 rounded-xl border border-amber-500/30"
                                        >
                                            Seçilenleri pasife al ({stokListSelectedIds.length})
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={exportStokKartlariCsv}
                                        className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-xs font-bold uppercase tracking-widest text-white px-3 py-2 rounded-xl border border-white/10"
                                    >
                                        <Download size={14} /> CSV (UTF-8)
                                    </button>
                                    <button
                                        type="button"
                                        onClick={exportStokKartlariXlsx}
                                        className="flex items-center gap-2 bg-emerald-600/20 hover:bg-emerald-600/40 text-xs font-bold uppercase tracking-widest text-emerald-300 px-3 py-2 rounded-xl border border-emerald-500/30"
                                    >
                                        <Download size={14} /> Excel (xlsx)
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setShowStokListFullscreen(true)}
                                        className="flex items-center gap-2 bg-izbel-dark border border-white/10 hover:bg-white/10 text-xs font-bold uppercase tracking-widest text-gray-200 px-3 py-2 rounded-xl"
                                    >
                                        Tam ekran stok kartları
                                    </button>
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-3 mb-4">
                                <input
                                    type="text"
                                    placeholder="Ürün adı veya stok kodu ara..."
                                    value={stokListSearchName}
                                    onChange={e => setStokListSearchName(e.target.value)}
                                    className="flex-1 min-w-[180px] bg-izbel-dark border border-white/10 p-2.5 rounded-xl text-white placeholder-gray-500 outline-none focus:border-blue-500 font-medium text-sm"
                                />
                                <input
                                    type="text"
                                    placeholder="Grubu ara..."
                                    value={stokListSearchGroup}
                                    onChange={e => setStokListSearchGroup(e.target.value)}
                                    className="flex-1 min-w-[160px] bg-izbel-dark border border-white/10 p-2.5 rounded-xl text-white placeholder-gray-500 outline-none focus:border-blue-500 font-medium text-sm"
                                />
                            </div>
                            {(() => {
                                const { sorted, fullMatch, total, nameQ, groupQ, sortKey, asc } = getStokListComputed();
                                const toggleSort = (key) => {
                                    setStokListSortBy(key);
                                    setStokListSortAsc(prev => (stokListSortBy === key ? !prev : true));
                                };
                                return (
                                    <>
                                        <p className="text-xs text-gray-500 mb-3">
                                            Tam eşleşen: <span className="font-bold text-green-400">{fullMatch}</span> / {total} ürün (Stok Kodu + Grubu dolu)
                                            {(nameQ || groupQ) && <span className="ml-2 text-blue-400">· Gösterilen: <span className="font-bold">{sorted.length}</span> sonuç</span>}
                                        </p>
                                        <div className="overflow-x-auto max-h-[420px] md:max-h-[640px] overflow-y-auto border border-white/10 rounded-xl">
                                            <table className="w-full text-left border-collapse">
                                                <thead className="sticky top-0 bg-izbel-dark z-10 border-b border-white/10">
                                                    <tr>
                                                        <th className="p-3 w-10 text-center">
                                                            <input
                                                                type="checkbox"
                                                                className="w-4 h-4 rounded cursor-pointer accent-blue-500"
                                                                checked={sorted.length > 0 && stokListSelectedIds.length === sorted.length}
                                                                onChange={(e) => {
                                                                    if (e.target.checked) setStokListSelectedIds(sorted.map(p => p.id));
                                                                    else setStokListSelectedIds([]);
                                                                }}
                                                            />
                                                        </th>
                                                        <th className="p-3 text-xs font-bold text-gray-500 uppercase tracking-widest">
                                                            <button type="button" onClick={() => toggleSort('stok_kodu')} className="flex items-center gap-1 hover:text-blue-400 transition-colors text-left">
                                                                Stok Kodu {sortKey === 'stok_kodu' && (asc ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                                                            </button>
                                                        </th>
                                                        <th className="p-3 text-xs font-bold text-gray-500 uppercase tracking-widest">
                                                            <button type="button" onClick={() => toggleSort('product_name')} className="flex items-center gap-1 hover:text-blue-400 transition-colors text-left">
                                                                Stok Adı {sortKey === 'product_name' && (asc ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                                                            </button>
                                                        </th>
                                                        <th className="p-3 text-xs font-bold text-gray-500 uppercase tracking-widest">
                                                            <button type="button" onClick={() => toggleSort('category')} className="flex items-center gap-1 hover:text-blue-400 transition-colors text-left">
                                                                Grubu {sortKey === 'category' && (asc ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                                                            </button>
                                                        </th>
                                                        <th className="p-3 text-xs font-bold text-gray-500 uppercase tracking-widest">Maliyet</th>
                                                        <th className="p-3 text-xs font-bold text-gray-500 uppercase tracking-widest">Birimi</th>
                                                        <th className="p-3 text-xs font-bold text-gray-500 uppercase tracking-widest">Barkod</th>
                                                        <th className="p-3 text-xs font-bold text-gray-500 uppercase tracking-widest">Durum</th>
                                                        <th className="p-3 text-xs font-bold text-gray-500 uppercase tracking-widest text-right w-24">İşlem</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-white/5">
                                                    {sorted.length === 0 ? (
                                                        <tr><td colSpan={8} className="p-6 text-center text-gray-500 font-bold uppercase tracking-widest text-sm">Kayıt yok</td></tr>
                                                    ) : (
                                                        sorted.map(p => {
                                                            const hasCode = !!(p.stok_kodu && p.stok_kodu.trim());
                                                            const hasGroup = !!(p.category && p.category.trim());
                                                            const ok = hasCode && hasGroup;
                                                            return (
                                                                <tr key={p.id} className="hover:bg-white/[0.03] group">
                                                                    <td className="p-3 text-center">
                                                                        <input
                                                                            type="checkbox"
                                                                            className="w-4 h-4 rounded cursor-pointer accent-blue-500"
                                                                            checked={stokListSelectedIds.includes(p.id)}
                                                                            onChange={(e) => {
                                                                                if (e.target.checked) setStokListSelectedIds(prev => [...prev, p.id]);
                                                                                else setStokListSelectedIds(prev => prev.filter(id => id !== p.id));
                                                                            }}
                                                                        />
                                                                    </td>
                                                                    <td className="p-3 font-mono text-sm text-blue-300">{p.stok_kodu || '—'}</td>
                                                                    <td className="p-3 font-medium text-white">{p.product_name || '—'}</td>
                                                                    <td className="p-3 text-gray-400">{p.category || '—'}</td>
                                                                    <td className="p-3 font-mono text-sm text-amber-400/90">{p.purchase_price != null ? Number(p.purchase_price).toLocaleString('tr-TR') : '—'} ₺</td>
                                                                    <td className="p-3 text-gray-500 text-sm">{p.unit || 'Adet'}</td>
                                                                    <td className="p-3 font-mono text-xs text-gray-500">{p.barcode || '—'}</td>
                                                                    <td className="p-3">
                                                                        <div className="flex flex-wrap gap-2">
                                                                            {p.is_active === false ? (
                                                                                <span className="inline-flex items-center gap-1 bg-purple-500/20 text-purple-300 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest">Pasif</span>
                                                                            ) : (
                                                                                <span className="inline-flex items-center gap-1 bg-blue-500/10 text-blue-300 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest">Aktif</span>
                                                                            )}
                                                                            {ok ? (
                                                                                <span className="inline-flex items-center gap-1 bg-green-500/20 text-green-400 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest">Eşleşti</span>
                                                                            ) : (
                                                                                <span className="inline-flex items-center gap-1 bg-amber-500/20 text-amber-400 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest">Eksik</span>
                                                                            )}
                                                                        </div>
                                                                    </td>
                                                                    <td className="p-3 text-right">
                                                                        <div className="flex items-center justify-end gap-1">
                                                                            <button type="button" onClick={() => openEditModal(p)} className="p-2 rounded-lg text-blue-400 hover:bg-blue-500/20 hover:text-blue-300 transition-colors" title="Düzenle">
                                                                                <Edit3 size={16} />
                                                                            </button>
                                                                            <button type="button" onClick={() => handleDeleteProduct(p)} className="p-2 rounded-lg text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors" title="Sil">
                                                                                <Trash2 size={16} />
                                                                            </button>
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    </>
                                );
                            })()}
                        </div>

                        {/* Nutrition CSV fiyat import önizleme */}
                        <div className="p-6 border-b border-white/5 bg-izbel-dark/30 space-y-4">
                            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest">Nutrition CSV Fiyat Import (Önizleme)</h3>
                            <div className="flex flex-wrap items-center gap-3">
                                <label className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl px-4 py-2 cursor-pointer transition-all">
                                    <Download size={16} className="text-emerald-400" />
                                    <span className="text-sm font-bold text-white">ingredients_rows.csv yükle</span>
                                    <input
                                        type="file"
                                        accept=".csv"
                                        className="sr-only"
                                        onChange={handleNutritionPriceImport}
                                    />
                                </label>
                                {priceImportRows.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={applyNutritionPriceImport}
                                        disabled={priceImportApplying}
                                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-2 px-4 rounded-xl text-xs uppercase tracking-widest"
                                    >
                                        {priceImportApplying ? 'Uygulanıyor...' : 'Seçilenleri Fiyatla Güncelle'}
                                    </button>
                                )}
                                {priceImportRows.length > 0 && (
                                    <span className="text-[11px] text-gray-400">
                                        Toplam satır: <span className="font-bold text-white">{priceImportRows.length}</span> ·
                                        Otomatik eşleşen: <span className="font-bold text-emerald-400">{priceImportRows.filter(r => r.matchedProductId).length}</span>
                                    </span>
                                )}
                            </div>

                            {priceImportRows.length > 0 && (
                                <div className="mt-3 border border-white/10 rounded-2xl overflow-hidden max-h-[420px] overflow-y-auto">
                                    <table className="w-full text-left text-xs">
                                        <thead className="bg-white/5 text-[10px] uppercase text-gray-400">
                                            <tr>
                                                <th className="p-2">Onay</th>
                                                <th className="p-2">CSV Ürün Adı</th>
                                                <th className="p-2">CSV Fiyat</th>
                                                <th className="p-2">Bizdeki Ürün</th>
                                                <th className="p-2">Mevcut Fiyat</th>
                                                <th className="p-2">Durum</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/5">
                                            {priceImportRows.map((row, idx) => (
                                                <tr key={idx} className="hover:bg-white/5">
                                                    <td className="p-2 align-top">
                                                        <input
                                                            type="checkbox"
                                                            checked={row.decision === 'accept'}
                                                            onChange={e =>
                                                                updatePriceImportRow(idx, { decision: e.target.checked ? 'accept' : 'skip' })
                                                            }
                                                            className="w-4 h-4 rounded accent-blue-500"
                                                        />
                                                    </td>
                                                    <td className="p-2 align-top">
                                                        <input
                                                            type="text"
                                                            value={row.externalName}
                                                            onChange={e => updatePriceImportRow(idx, { externalName: e.target.value })}
                                                            className="w-full bg-izbel-dark border border-white/10 rounded px-2 py-1 text-white text-[11px]"
                                                        />
                                                        {row.externalUnit && (
                                                            <div className="mt-1 text-[10px] text-gray-500">
                                                                Birim: <span className="font-mono">{row.externalUnit}</span>
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="p-2 align-top">
                                                        <input
                                                            type="text"
                                                            value={row.externalPriceRaw}
                                                            onChange={e => {
                                                                const raw = e.target.value;
                                                                const cleaned = raw.replace(/\./g, '').replace(',', '.');
                                                                const num = cleaned ? Number(cleaned) : null;
                                                                updatePriceImportRow(idx, {
                                                                    externalPriceRaw: raw,
                                                                    externalPrice: Number.isFinite(num) ? num : null,
                                                                });
                                                            }}
                                                            className="w-full bg-izbel-dark border border-white/10 rounded px-2 py-1 text-white text-[11px]"
                                                        />
                                                        <div className="mt-1 text-[10px] text-gray-500">
                                                            Parse: <span className="font-mono text-amber-300">{row.externalPrice ?? '—'}</span> ₺
                                                        </div>
                                                    </td>
                                                    <td className="p-2 align-top">
                                                        {row.matchedProductId ? (
                                                            <div className="text-[11px] text-blue-300 font-bold">
                                                                {row.currentProductName}
                                                            </div>
                                                        ) : (
                                                            <div className="text-[11px] text-amber-400 font-bold">
                                                                Eşleşmedi (manuel eşleştirme eklenecek)
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="p-2 align-top">
                                                        {row.currentPrice != null ? (
                                                            <div className="text-[11px] text-gray-300">
                                                                Eski: <span className="font-mono">{row.currentPrice}</span> ₺
                                                                <br />
                                                                Yeni: <span className="font-mono text-emerald-300">{row.externalPrice ?? '—'}</span> ₺
                                                            </div>
                                                        ) : (
                                                            <span className="text-[11px] text-gray-500">—</span>
                                                        )}
                                                    </td>
                                                    <td className="p-2 align-top">
                                                        {row.matchedProductId ? (
                                                            <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">
                                                                İsimden eşleşti
                                                            </span>
                                                        ) : (
                                                            <span className="text-[10px] font-bold text-amber-400 uppercase tracking-widest">
                                                                Eşleşme yok
                                                            </span>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                        {/* Barkod işlemleri (Admin panel içi) */}
                        <div className="p-6 border-b border-white/5 bg-izbel-dark/20 space-y-4">
                            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest">Barkod İşlemleri</h3>

                            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                                {/* 1) Barkod sorgula */}
                                <div className="bg-izbel-dark/40 border border-white/10 rounded-2xl p-4 space-y-3">
                                    <div className="text-xs font-bold text-gray-500 uppercase tracking-widest">Barkod Sorgula</div>
                                    <div className="flex gap-2">
                                        <input
                                            value={barcodeQuery}
                                            onChange={(e) => setBarcodeQuery(e.target.value)}
                                            placeholder="Barkod yaz..."
                                            className="flex-1 bg-izbel-dark border border-white/10 rounded-xl py-3 px-4 text-sm font-bold text-white outline-none focus:border-blue-500"
                                        />
                                        <button
                                            type="button"
                                            onClick={handleBarcodeLookup}
                                            disabled={barcodeLookupLoading}
                                            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-black px-4 rounded-xl text-xs uppercase tracking-widest"
                                        >
                                            {barcodeLookupLoading ? '...' : 'Sorgula'}
                                        </button>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={handleExternalBarcodeLookup}
                                        disabled={externalLookupLoading}
                                        className="w-full bg-purple-600/30 hover:bg-purple-600/50 disabled:opacity-50 text-purple-200 font-black py-3 rounded-xl text-xs uppercase tracking-widest border border-purple-500/30"
                                    >
                                        {externalLookupLoading ? '...' : 'Dış API’den Ürün Adı Getir (Sadece Barkodsuzlar için)'}
                                    </button>

                                    {barcodeLookupResult && (
                                        <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-xs">
                                            <div className="font-bold text-white">{barcodeLookupResult.product_name}</div>
                                            <div className="mt-1 flex flex-wrap gap-2 text-gray-400 font-mono">
                                                {barcodeLookupResult.stok_kodu && <span className="bg-blue-500/10 text-blue-300 px-2 py-1 rounded border border-blue-500/20">Kod: {barcodeLookupResult.stok_kodu}</span>}
                                                {(barcodeLookupResult.barcode && String(barcodeLookupResult.barcode).trim()) ? (
                                                    <span className="bg-emerald-500/10 text-emerald-300 px-2 py-1 rounded border border-emerald-500/20">BRK: {barcodeLookupResult.barcode}</span>
                                                ) : (
                                                    <span className="bg-amber-500/10 text-amber-300 px-2 py-1 rounded border border-amber-500/20">BRK: YOK</span>
                                                )}
                                                <span className="bg-white/5 px-2 py-1 rounded border border-white/10">B.Fiyat: {barcodeLookupResult.purchase_price ?? 0} ₺</span>
                                            </div>
                                        </div>
                                    )}

                                    {externalLookupResult && (
                                        <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-3 text-xs">
                                            <div className="text-[10px] font-bold uppercase tracking-widest text-purple-200 mb-1">Dış API sonucu</div>
                                            <div className="font-bold text-white">{externalLookupResult.name}</div>
                                            <p className="text-[11px] text-gray-400 mt-2">İpucu: Sağdaki “Barkodu Ürüne Bağla” bölümünde barkod ve arama otomatik dolduruldu.</p>
                                        </div>
                                    )}
                                </div>

                                {/* 2) Barkodu ürüne bağla */}
                                <div className="bg-izbel-dark/40 border border-white/10 rounded-2xl p-4 space-y-3">
                                    <div className="text-xs font-bold text-gray-500 uppercase tracking-widest">Barkodu Ürüne Bağla / Güncelle</div>
                                    <input
                                        value={barcodeBindBarcode}
                                        onChange={(e) => setBarcodeBindBarcode(e.target.value)}
                                        placeholder="Barkod..."
                                        className="w-full bg-izbel-dark border border-white/10 rounded-xl py-3 px-4 text-sm font-bold text-white outline-none focus:border-blue-500"
                                    />
                                    <input
                                        value={barcodeBindProductSearch}
                                        onChange={(e) => setBarcodeBindProductSearch(e.target.value)}
                                        placeholder="Ürün ara (bizdeki stok kartları)..."
                                        className="w-full bg-izbel-dark border border-white/10 rounded-xl py-3 px-4 text-sm font-bold text-white outline-none focus:border-blue-500"
                                    />
                                    <select
                                        value={barcodeBindSelectedProductId}
                                        onChange={(e) => setBarcodeBindSelectedProductId(e.target.value)}
                                        className="w-full bg-izbel-dark border border-white/10 rounded-xl py-3 px-4 text-sm font-bold text-white outline-none focus:border-blue-500"
                                    >
                                        <option value="">Ürün seç...</option>
                                        {products
                                            .filter(p => {
                                                // SADECE barkodsuz ürünler
                                                const existing = (p.barcode || '').trim();
                                                if (existing) return false;
                                                const q = normalizeText(barcodeBindProductSearch);
                                                if (!q) return true;
                                                const hay = normalizeText(`${p.product_name} ${p.stok_kodu || ''} ${p.barcode || ''}`);
                                                return q.split(' ').filter(Boolean).every(w => hay.includes(w));
                                            })
                                            .slice(0, 50)
                                            .map(p => (
                                                <option key={p.id} value={p.id}>
                                                    {(p.stok_kodu ? `${p.stok_kodu} - ` : '')}{p.product_name}
                                                </option>
                                            ))}
                                    </select>
                                    <button
                                        type="button"
                                        onClick={handleBindBarcodeToProduct}
                                        disabled={barcodeBulkImporting}
                                        className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-black py-3 rounded-xl text-xs uppercase tracking-widest"
                                    >
                                        {barcodeBulkImporting ? '...' : 'Barkodu Kaydet'}
                                    </button>
                                    <p className="text-[11px] text-gray-500">Not: Barkod alanı unique ise aynı barkodu başka ürüne yazmaya çalışınca hata verir.</p>
                                </div>

                                {/* 3) Toplu barkod import */}
                                <div className="bg-izbel-dark/40 border border-white/10 rounded-2xl p-4 space-y-3">
                                    <div className="text-xs font-bold text-gray-500 uppercase tracking-widest">Toplu Barkod Import</div>
                                    <p className="text-[11px] text-gray-500">
                                        CSV başlıkları: <span className="font-mono">Ürün Adı</span> ve <span className="font-mono">Barkod</span>. Ayraç <span className="font-mono">;</span> veya <span className="font-mono">,</span> olabilir.
                                        Eşleşme, bizdeki ürün adıyla <strong>tam normalize eşleşme</strong> ile yapılır (ambiguous satırlar atlanır).
                                    </p>
                                    <label className="flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl px-4 py-3 cursor-pointer transition-all">
                                        <Download size={16} className="text-amber-400" />
                                        <span className="text-sm font-bold text-white">{barcodeBulkImporting ? 'İçe aktarılıyor...' : 'CSV seç (Ürün Adı;Barkod)'}</span>
                                        <input type="file" accept=".csv,.txt" className="sr-only" onChange={handleBarcodeBulkImport} disabled={barcodeBulkImporting} />
                                    </label>
                                </div>
                            </div>
                        </div>

                        {/* Stok kartları tam ekran modal */}
                        {showStokListFullscreen && (
                            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
                                <div className="bg-izbel-card border border-white/10 rounded-[2rem] w-full max-w-6xl max-h-[90vh] flex flex-col shadow-2xl">
                                    <div className="p-4 border-b border-white/10 flex items-center justify-between gap-3">
                                        <div>
                                            <h3 className="text-lg font-black text-white tracking-tight">Stok kartları · Tam ekran</h3>
                                            <p className="text-xs text-gray-500 font-medium">Filtreler ve sıralama bu görünümle ortaktır.</p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setShowStokListFullscreen(false)}
                                            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-bold uppercase tracking-widest text-gray-200 border border-white/20"
                                        >
                                            Kapat
                                        </button>
                                    </div>
                                    <div className="p-4 flex flex-col gap-3 flex-1 min-h-0">
                                        <div className="flex flex-wrap gap-3">
                                            <input
                                                type="text"
                                                placeholder="Ürün adı veya stok kodu ara..."
                                                value={stokListSearchName}
                                                onChange={e => setStokListSearchName(e.target.value)}
                                                className="flex-1 min-w-[180px] bg-izbel-dark border border-white/10 p-2.5 rounded-xl text-white placeholder-gray-500 outline-none focus:border-blue-500 font-medium text-sm"
                                            />
                                            <input
                                                type="text"
                                                placeholder="Grubu ara..."
                                                value={stokListSearchGroup}
                                                onChange={e => setStokListSearchGroup(e.target.value)}
                                                className="flex-1 min-w-[160px] bg-izbel-dark border border-white/10 p-2.5 rounded-xl text-white placeholder-gray-500 outline-none focus:border-blue-500 font-medium text-sm"
                                            />
                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={stokListOnlyMissing}
                                                    onChange={e => setStokListOnlyMissing(e.target.checked)}
                                                    className="rounded accent-amber-500"
                                                />
                                                <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Sadece eksik olanlar</span>
                                            </label>
                                        </div>
                                        {(() => {
                                            const { sorted, fullMatch, total, nameQ, groupQ, sortKey, asc } = getStokListComputed();
                                            const toggleSort = (key) => {
                                                setStokListSortBy(key);
                                                setStokListSortAsc(prev => (stokListSortBy === key ? !prev : true));
                                            };
                                            return (
                                                <>
                                                    <p className="text-xs text-gray-500">
                                                        Tam eşleşen: <span className="font-bold text-green-400">{fullMatch}</span> / {total} ürün
                                                        {(nameQ || groupQ) && <span className="ml-2 text-blue-400">· Gösterilen: <span className="font-bold">{sorted.length}</span> sonuç</span>}
                                                    </p>
                                                    <div className="overflow-x-auto overflow-y-auto border border-white/10 rounded-xl flex-1 min-h-0">
                                                        <table className="w-full text-left border-collapse text-sm">
                                                            <thead className="sticky top-0 bg-izbel-dark z-10 border-b border-white/10">
                                                                <tr>
                                                                    <th className="p-3 text-xs font-bold text-gray-500 uppercase tracking-widest">
                                                                        <button type="button" onClick={() => toggleSort('stok_kodu')} className="flex items-center gap-1 hover:text-blue-400 transition-colors text-left">
                                                                            Stok Kodu {sortKey === 'stok_kodu' && (asc ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                                                                        </button>
                                                                    </th>
                                                                    <th className="p-3 text-xs font-bold text-gray-500 uppercase tracking-widest">
                                                                        <button type="button" onClick={() => toggleSort('product_name')} className="flex items-center gap-1 hover:text-blue-400 transition-colors text-left">
                                                                            Stok Adı {sortKey === 'product_name' && (asc ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                                                                        </button>
                                                                    </th>
                                                                    <th className="p-3 text-xs font-bold text-gray-500 uppercase tracking-widest">
                                                                        <button type="button" onClick={() => toggleSort('category')} className="flex items-center gap-1 hover:text-blue-400 transition-colors text-left">
                                                                            Grubu {sortKey === 'category' && (asc ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                                                                        </button>
                                                                    </th>
                                                                    <th className="p-3 text-xs font-bold text-gray-500 uppercase tracking-widest">Maliyet</th>
                                                                    <th className="p-3 text-xs font-bold text-gray-500 uppercase tracking-widest">Birimi</th>
                                                                    <th className="p-3 text-xs font-bold text-gray-500 uppercase tracking-widest">Barkod</th>
                                                                    <th className="p-3 text-xs font-bold text-gray-500 uppercase tracking-widest">Durum</th>
                                                                    <th className="p-3 text-xs font-bold text-gray-500 uppercase tracking-widest text-right w-24">İşlem</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody className="divide-y divide-white/5">
                                                                {sorted.length === 0 ? (
                                                                    <tr><td colSpan={8} className="p-6 text-center text-gray-500 font-bold uppercase tracking-widest text-sm">Kayıt yok</td></tr>
                                                                ) : (
                                                                    sorted.map(p => {
                                                                        const hasCode = !!(p.stok_kodu && p.stok_kodu.trim());
                                                                        const hasGroup = !!(p.category && p.category.trim());
                                                                        const ok = hasCode && hasGroup;
                                                                        return (
                                                                            <tr key={p.id} className="hover:bg-white/[0.03] group">
                                                                                <td className="p-3 font-mono text-sm text-blue-300">{p.stok_kodu || '—'}</td>
                                                                                <td className="p-3 font-medium text-white">{p.product_name || '—'}</td>
                                                                                <td className="p-3 text-gray-400">{p.category || '—'}</td>
                                                                                <td className="p-3 font-mono text-sm text-amber-400/90">{p.purchase_price != null ? Number(p.purchase_price).toLocaleString('tr-TR') : '—'} ₺</td>
                                                                                <td className="p-3 text-gray-500 text-sm">{p.unit || 'Adet'}</td>
                                                                                <td className="p-3 font-mono text-xs text-gray-500">{p.barcode || '—'}</td>
                                                                                <td className="p-3">
                                                                                    {ok ? (
                                                                                        <span className="inline-flex items-center gap-1 bg-green-500/20 text-green-400 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest">Eşleşti</span>
                                                                                    ) : (
                                                                                        <span className="inline-flex items-center gap-1 bg-amber-500/20 text-amber-400 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest">Eksik</span>
                                                                                    )}
                                                                                </td>
                                                                                <td className="p-3 text-right">
                                                                                    <div className="flex items-center justify-end gap-1">
                                                                                        <button type="button" onClick={() => openEditModal(p)} className="p-2 rounded-lg text-blue-400 hover:bg-blue-500/20 hover:text-blue-300 transition-colors" title="Düzenle">
                                                                                            <Edit3 size={16} />
                                                                                        </button>
                                                                                        <button type="button" onClick={() => handleDeleteProduct(p)} className="p-2 rounded-lg text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors" title="Sil">
                                                                                            <Trash2 size={16} />
                                                                                        </button>
                                                                                    </div>
                                                                                </td>
                                                                            </tr>
                                                                        );
                                                                    })
                                                                )}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </>
                                            );
                                        })()}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ADD PRODUCT FORM */}
                        <div className="p-6 border-b border-white/5 bg-izbel-dark/30">
                            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Yeni Ürün / Stok Kartı Aç</h3>
                            <form onSubmit={handleAddProduct} className="flex flex-col md:flex-row gap-4">
                                <input
                                    required className="flex-1 bg-izbel-dark border border-white/10 p-3 rounded-xl focus:border-blue-500 outline-none font-medium placeholder-gray-600"
                                    placeholder="Ürün Adı (Örn: Çay)" value={newProductName} onChange={e => setNewProductName(e.target.value)}
                                />
                                <input
                                    className="w-full md:w-28 bg-izbel-dark border border-white/10 p-3 rounded-xl focus:border-blue-500 outline-none font-medium placeholder-gray-600"
                                    placeholder="Stok Kodu (ST00168)" value={newStokKodu} onChange={e => setNewStokKodu(e.target.value)}
                                />
                                <input
                                    className="w-full md:w-32 bg-izbel-dark border border-white/10 p-3 rounded-xl focus:border-blue-500 outline-none font-medium placeholder-gray-600"
                                    placeholder="Barkod (Ops)" value={newBarcode} onChange={e => setNewBarcode(e.target.value)}
                                />
                                <input
                                    required type="number" step="0.01" className="w-full md:w-32 bg-izbel-dark border border-white/10 p-3 rounded-xl focus:border-blue-500 outline-none font-medium placeholder-gray-600"
                                    placeholder="Maliyet ₺" value={newPurchasePrice} onChange={e => setNewPurchasePrice(e.target.value)}
                                />
                                <div className="relative w-full md:w-40 flex-shrink-0">
                                    <input
                                        className="w-full bg-izbel-dark border border-white/10 p-3 rounded-xl focus:border-blue-500 outline-none font-medium placeholder-gray-600"
                                        placeholder="Kategori (Ops.)"
                                        value={newCategory}
                                        onChange={e => setNewCategory(e.target.value)}
                                        onFocus={() => setShowNewCatDropdown(true)}
                                        onBlur={() => setTimeout(() => setShowNewCatDropdown(false), 200)}
                                    />
                                    {showNewCatDropdown && (categories.length > 0 || existingCategories.length > 0) && (
                                        <div className="absolute top-full left-0 right-0 mt-2 bg-izbel-dark border border-white/10 rounded-xl shadow-2xl z-50 max-h-40 overflow-y-auto">
                                            {(categories.length > 0 ? categories.map(c => c.name) : existingCategories).map(cat => (
                                                <div
                                                    key={cat}
                                                    className="p-3 hover:bg-white/5 cursor-pointer text-white font-medium border-b border-white/5 last:border-none text-sm"
                                                    onClick={() => {
                                                        setNewCategory(cat);
                                                        setShowNewCatDropdown(false);
                                                    }}
                                                >
                                                    {cat}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <select
                                    value={newUnit}
                                    onChange={e => setNewUnit(e.target.value)}
                                    className="w-full md:w-32 bg-izbel-dark border border-white/10 p-3 rounded-xl focus:border-blue-500 outline-none font-medium text-white appearance-none cursor-pointer"
                                    title="Birim"
                                >
                                    <option value="Adet">Adet</option>
                                    <option value="Kg">Kg</option>
                                    <option value="Lt">Lt</option>
                                    <option value="Gr">Gr</option>
                                    <option value="Ml">Ml</option>
                                    <option value="Metre">Metre</option>
                                    <option value="Paket">Paket</option>
                                    <option value="Kutu">Kutu</option>
                                    <option value="Koli">Koli</option>
                                    <option value="Çuval">Çuval</option>
                                </select>
                                <input
                                    required type="number" className="w-full md:w-32 bg-izbel-dark border border-white/10 p-3 rounded-xl focus:border-blue-500 outline-none font-medium placeholder-gray-600"
                                    placeholder="Sistem Stoku" value={newCurrentStock} onChange={e => setNewCurrentStock(e.target.value)}
                                />
                                <button type="submit" disabled={isLoading} className="bg-white/10 hover:bg-white/20 text-white font-bold py-3 px-6 rounded-xl transition-all whitespace-nowrap">
                                    {isLoading ? '...' : '+ KART AÇ'}
                                </button>
                            </form>
                        </div>

                        {/* MULTI DELETE ACTION BAR */}
                        {selectedRecords.length > 0 && (
                            <div className="bg-red-500/10 border-t border-b border-red-500/30 p-4 flex justify-between items-center sticky top-0 z-10 backdrop-blur-md">
                                <span className="text-red-400 font-bold ml-2">
                                    {selectedRecords.length} adet kayıt seçildi.
                                </span>
                                <button
                                    onClick={handleBulkSetDraft}
                                    disabled={isLoading}
                                    className="bg-amber-500 hover:bg-amber-400 text-black font-bold py-2 px-4 rounded-xl transition-all shadow-[0_0_15px_rgba(245,158,11,0.5)] flex items-center gap-2 text-xs uppercase tracking-widest"
                                >
                                    Taslak Yap
                                </button>
                                <button
                                    onClick={handleDeleteSelected}
                                    disabled={isLoading}
                                    className="bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-4 rounded-xl transition-all shadow-[0_0_15px_rgba(220,38,38,0.5)] flex items-center gap-2 text-xs uppercase tracking-widest"
                                >
                                    <Trash2 size={18} /> Seçilenleri Sil
                                </button>
                            </div>
                        )}

                        <div className="overflow-x-auto print:overflow-visible">
                            <div className="hidden print:block text-black text-center mb-6 pt-6 border-b-2 border-black pb-4">
                                <h2 className="text-2xl font-black uppercase tracking-tight">TÜM SAYIM - ÜRÜN ONAY LİSTESİ</h2>
                                <div className="flex justify-between items-center text-sm font-medium mt-4 px-4">
                                    <span>Filtrelenen �?ube: {selectedBranchId === 'ALL' ? 'Tüm �?ubeler' : branches.find(b => b.id === selectedBranchId)?.branch_name}</span>
                                    <span>Yazdırılma Tarihi: {new Date().toLocaleString('tr-TR')}</span>
                                </div>
                            </div>
                            <table className="w-full text-left border-collapse">
                                <thead className="print:bg-white text-black">
                                    <tr className="border-b border-white/5 bg-white/[0.01]">
                                        <th className="p-6 w-10 text-center print:hidden">
                                            <input
                                                type="checkbox"
                                                className="w-5 h-5 rounded cursor-pointer accent-blue-500"
                                                checked={filteredCounts.length > 0 && selectedRecords.length === filteredCounts.length}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setSelectedRecords(filteredCounts.map(c => c.id));
                                                    } else {
                                                        setSelectedRecords([]);
                                                    }
                                                }}
                                            />
                                        </th>
                                        <th className="p-6 text-xs font-bold text-gray-500 uppercase tracking-widest">Sistem Ürün Bilgisi</th>
                                        <th className="p-6 text-xs font-bold text-gray-500 uppercase tracking-widest">Sayan �?ube & Dönem</th>
                                        <th className="p-6 text-xs font-bold text-gray-500 uppercase tracking-widest min-w-[150px]">İlk / Son (İstanbul)</th>
                                        <th className="p-6 text-xs font-bold text-gray-500 uppercase tracking-widest">�?ube sistemi stok</th>
                                        <th className="p-6 text-xs font-bold text-blue-400 uppercase tracking-widest">Sayım Bulunan</th>
                                        <th className="p-6 text-xs font-bold text-gray-500 uppercase tracking-widest">Fark</th>
                                        <th className="p-6 text-xs font-bold text-gray-500 uppercase tracking-widest text-center print:hidden">Admin Onayı</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {filteredCounts.filter(c => {
                                        if (!productSearch) return true;
                                        return c.products?.product_name.toLowerCase().includes(productSearch.toLowerCase());
                                    }).map(c => {
                                        const bName = branches.find(b => b.id === c.branch_id)?.branch_name || 'Bilinmiyor';
                                        const pName = periods.find(p => p.id === c.period_id)?.period_name || 'Dönemsiz';
                                        const times = formatIstanbulCountTimes(c);
                                        const sys = sysStockForCount(c);
                                        const count = c.counted_stock;
                                        const diff = count - sys;
                                        const price = unitCostForCount(c);
                                        const valDiff = diff * price;
                                        const isApproved = c.status === 'approved';

                                        return (
                                            <tr key={c.id} className={`hover:bg-white/[0.02] transition-colors group ${isApproved ? 'opacity-50 print:opacity-100' : ''}`}>
                                                <td className="p-6 text-center border-r border-white/5 print:hidden">
                                                    <input
                                                        type="checkbox"
                                                        className="w-5 h-5 rounded cursor-pointer accent-blue-500"
                                                        checked={selectedRecords.includes(c.id)}
                                                        onChange={(e) => {
                                                            if (e.target.checked) {
                                                                setSelectedRecords(prev => [...prev, c.id]);
                                                            } else {
                                                                setSelectedRecords(prev => prev.filter(id => id !== c.id));
                                                            }
                                                        }}
                                                    />
                                                </td>
                                                <td className="p-6">
                                                    <div className="font-bold text-white mb-1 group-hover:text-blue-400 transition-colors flex items-center justify-between gap-2">
                                                        <span>{c.products?.product_name}</span>
                                                        <button onClick={() => openEditModal(c.products)} className="text-gray-500 hover:text-blue-400 p-1 rounded-md opacity-0 group-hover:opacity-100 transition-all cursor-pointer border border-transparent hover:border-blue-500/30 bg-white/5">
                                                            <Edit3 size={14} />
                                                        </button>
                                                    </div>
                                                    <div className="text-xs font-mono text-gray-500 flex flex-wrap items-center gap-2">
                                                        {c.products?.stok_kodu && <span className="bg-blue-500/10 text-blue-300 px-2 py-1 rounded border border-blue-500/20">Kod: {c.products.stok_kodu}</span>}
                                                        <span className="bg-white/5 px-2 py-1 rounded border border-white/5 text-[10px] uppercase font-bold text-gray-400">{c.products?.category || 'KATEGORİSİZ'}</span>
                                                    {(c.products?.barcode && String(c.products.barcode).trim()) ? (
                                                        <span className="bg-emerald-500/10 text-emerald-300 px-2 py-1 rounded border border-emerald-500/20">BRK: {c.products.barcode}</span>
                                                    ) : (
                                                        <span className="bg-amber-500/10 text-amber-300 px-2 py-1 rounded border border-amber-500/20">BRK: YOK</span>
                                                    )}
                                                        <span className="font-sans font-bold text-gray-400 border border-white/10 px-2 py-1 rounded">B.Fiyat: {price} ₺</span>
                                                    </div>
                                                </td>
                                                <td className="p-6">
                                                    <div className="flex flex-col gap-1 items-start">
                                                        <span className="bg-white/5 text-gray-300 text-xs font-bold px-3 py-1 rounded-lg border border-white/5">{bName}</span>
                                                        <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold ml-1">{pName}</span>
                                                    </div>
                                                </td>
                                                <td className="p-6 text-[10px] text-cyan-200/85 font-mono leading-snug align-top">
                                                    <div>İlk: {times.first}</div>
                                                    <div>Son: {times.last}</div>
                                                </td>
                                                <td className="p-6 font-mono text-xl text-gray-500 font-bold">
                                                    {sys} <span className="text-xs text-gray-600 ml-1 font-sans">{c.products?.unit || 'Adet'}</span>
                                                </td>
                                                <td className="p-6 font-mono text-xl text-blue-400 font-bold bg-blue-500/5 border-x border-white/5">
                                                    {count} <span className="text-xs text-blue-500/50 ml-1 font-sans">{c.products?.unit || 'Adet'}</span>
                                                </td>

                                                {/* Diff Logic */}
                                                <td className="p-6 font-mono">
                                                    <div className={`text-xl font-black ${diff < 0 ? 'text-red-500' : diff > 0 ? 'text-green-500' : 'text-gray-600'}`}>
                                                        {diff > 0 ? '+' : ''}{diff} <span className="text-xs font-sans font-bold opacity-50 ml-1">{c.products?.unit || 'Adet'}</span>
                                                    </div>
                                                    <div className={`text-xs font-bold mt-1 ${valDiff < 0 ? 'text-red-500/80' : valDiff > 0 ? 'text-green-500/80' : 'text-gray-600'}`}>
                                                        {valDiff > 0 ? '+' : ''}{valDiff.toLocaleString('tr-TR')} ₺
                                                    </div>
                                                </td>
                                                <td className="p-6 text-center print:hidden">
                                                    {isApproved ? (
                                                        <div className="inline-flex flex-col items-center">
                                                            <CheckCircle2 className="text-green-500 mb-1" size={20} />
                                                            <span className="text-[10px] font-bold text-green-400 uppercase tracking-widest mb-2">ONAYLANMI�? STOK</span>
                                                            <button onClick={() => handleRevertApproval(c.id)} className="group flex items-center gap-1 bg-white/5 hover:bg-yellow-500/20 text-gray-500 hover:text-yellow-500 px-3 py-1.5 rounded-lg border border-transparent hover:border-yellow-500/30 transition-all active:scale-95 cursor-pointer">
                                                                <RefreshCw size={12} className="group-hover:-rotate-180 transition-transform duration-500" />
                                                                <span className="text-[10px] font-bold uppercase tracking-widest">İPTAL / GERİ AL</span>
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <div className="flex flex-col items-center gap-2">
                                                            {diff < 0 && <span className="text-[10px] bg-red-500/20 text-red-500 px-2 rounded-full font-bold uppercase animate-pulse w-full text-center">�?üpheli Kayıp</span>}
                                                            <button onClick={() => handleApproveCount(c.id, c.product_id, count, c.branch_id)} className="w-full whitespace-nowrap bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold py-3 px-4 rounded-xl shadow-lg active:scale-95 transition-all">
                                                                DO�?RULA / GÜNCELLE
                                                            </button>
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* --------- TAB: �?UBE KAR�?ILA�?TIRMA (stok_kodu benzersiz anahtar) --------- */}
                {activeTab === 'suberapor' && (() => {
                    const { activePeriod, branchesSorted, withStok, missingStok } = subeKarsilastirma;
                    const q = normalizeText(subeRaporSearch);
                    const rowMatch = (row) => {
                        if (!q) return true;
                        const code = row.displayCode || row.stokKey || '';
                        const hay = normalizeText(`${code} ${row.product_name || ''} ${row.product_id || ''}`);
                        const words = q.split(' ').filter(Boolean);
                        return words.every(w => hay.includes(w));
                    };
                    const visWith = withStok.filter(rowMatch);
                    const visMiss = missingStok.filter(rowMatch);
                    return (
                        <div className="space-y-8 animate-fade-in pb-16">
                            <div className="bg-izbel-card border border-white/5 rounded-[2rem] p-6 shadow-2xl">
                                <h2 className="text-2xl font-black text-white flex items-center gap-3">
                                    <BarChart3 className="text-blue-400" /> �?ube karşılaştırma raporu
                                </h2>
                                <p className="text-sm text-gray-500 mt-2 font-medium">
                                    <strong>Aktif dönem:</strong> {activePeriod ? activePeriod.period_name : 'Yok — önce bir sayım dönemi başlatın.'} · Tüm kayıtlar (draft / submitted / approved) dahil.
                                    Satırlar <strong className="text-blue-300">stok_kodu</strong> ile gruplanır (<code className="text-xs bg-white/10 px-1 rounded">ST00197</code> ile <code className="text-xs bg-white/10 px-1 rounded">st00197</code> aynı satır).
                                    <span className="block mt-1 text-rose-300/90">Excel’de şube sütunları: satır içi medyana göre belirgin sapan değerler açık kırmızı arka planla işaretlenir.</span>
                                </p>
                                <div className="flex flex-col md:flex-row gap-3 mt-4">
                                    <div className="flex-1 flex items-center gap-2 bg-izbel-dark border border-white/10 rounded-xl px-3">
                                        <Search size={18} className="text-gray-500 shrink-0" />
                                        <input
                                            value={subeRaporSearch}
                                            onChange={e => setSubeRaporSearch(e.target.value)}
                                            placeholder="Stok kodu veya ürün adı ara..."
                                            className="w-full bg-transparent py-3 outline-none text-white placeholder-gray-600 font-medium"
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => void exportSubeKarsilastirmaXlsx()}
                                        disabled={!activePeriod}
                                        className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white font-bold py-3 px-6 rounded-xl uppercase tracking-widest text-xs"
                                    >
                                        <Download size={16} /> Excel indir
                                    </button>
                                </div>
                            </div>

                            {!activePeriod ? (
                                <div className="text-center text-gray-500 font-bold py-12">Aktif sayım dönemi olmadan rapor oluşturulamaz.</div>
                            ) : (
                                <>
                                    <div className="bg-izbel-card border border-white/5 rounded-[2rem] overflow-hidden shadow-2xl">
                                        <div className="p-4 border-b border-white/10 flex justify-between items-center flex-wrap gap-2">
                                            <h3 className="font-black text-white uppercase tracking-widest text-sm">Stok kodlu ürünler ({visWith.length} / {withStok.length})</h3>
                                        </div>
                                        <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
                                            <table className="w-full text-left text-sm min-w-[800px]">
                                                <thead className="bg-izbel-dark sticky top-0 z-10">
                                                    <tr className="text-gray-500 uppercase text-[10px] tracking-widest font-black border-b border-white/10">
                                                        <th className="p-3 whitespace-nowrap">Stok kodu</th>
                                                        <th className="p-3 min-w-[160px]">Ürün</th>
                                                        <th className="p-3">Birim</th>
                                                        <th className="p-3 text-right font-mono">Min</th>
                                                        <th className="p-3 text-right font-mono">Max</th>
                                                        <th className="p-3 text-right font-mono">Ort</th>
                                                        <th className="p-3 text-right font-mono">Aralık</th>
                                                        {branchesSorted.map(b => (
                                                            <th key={b.id} className="p-3 text-right font-mono whitespace-nowrap border-l border-white/5">{b.branch_name}</th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {visWith.map(row => (
                                                        <tr key={row.stokKey} className="border-b border-white/5 hover:bg-white/[0.02]">
                                                            <td className="p-3 font-mono text-blue-300 font-bold">{row.displayCode || row.stokKey}</td>
                                                            <td className="p-3 text-white font-medium">{row.product_name}</td>
                                                            <td className="p-3 text-gray-400 text-xs">{row.unit}</td>
                                                            <td className="p-3 text-right font-mono text-gray-300">{row.stats.min ?? '—'}</td>
                                                            <td className="p-3 text-right font-mono text-gray-300">{row.stats.max ?? '—'}</td>
                                                            <td className="p-3 text-right font-mono text-gray-300">{row.stats.avg != null ? row.stats.avg.toFixed(2) : '—'}</td>
                                                            <td className="p-3 text-right font-mono text-amber-400/90">{row.stats.range ?? '—'}</td>
                                                            {branchesSorted.map(b => {
                                                                const v = row.byBranch[b.id];
                                                                return (
                                                                    <td key={b.id} className="p-3 text-right font-mono border-l border-white/5 text-white">{v != null ? v : '—'}</td>
                                                                );
                                                            })}
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>

                                    <div className="bg-izbel-card border border-amber-500/30 rounded-[2rem] overflow-hidden shadow-2xl">
                                        <div className="p-4 border-b border-white/10 bg-amber-500/10">
                                            <h3 className="font-black text-amber-200 uppercase tracking-widest text-sm">Eksik stok kodu ({visMiss.length} / {missingStok.length})</h3>
                                            <p className="text-xs text-amber-200/80 mt-1">Bu ürünlerde <code>stok_kodu</code> boş; karşılaştırmada ürün <code>id</code> ile gruplandı. Kodları tamamlamanız önerilir.</p>
                                        </div>
                                        <div className="overflow-x-auto max-h-[50vh] overflow-y-auto">
                                            <table className="w-full text-left text-sm min-w-[800px]">
                                                <thead className="bg-izbel-dark sticky top-0 z-10">
                                                    <tr className="text-gray-500 uppercase text-[10px] tracking-widest font-black border-b border-white/10">
                                                        <th className="p-3 font-mono">Ürün id</th>
                                                        <th className="p-3 min-w-[160px]">Ürün</th>
                                                        <th className="p-3">Birim</th>
                                                        <th className="p-3 text-right font-mono">Min</th>
                                                        <th className="p-3 text-right font-mono">Max</th>
                                                        <th className="p-3 text-right font-mono">Ort</th>
                                                        <th className="p-3 text-right font-mono">Aralık</th>
                                                        {branchesSorted.map(b => (
                                                            <th key={b.id} className="p-3 text-right font-mono whitespace-nowrap border-l border-white/5">{b.branch_name}</th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {visMiss.map(row => (
                                                        <tr key={row.product_id} className="border-b border-white/5 hover:bg-white/[0.02]">
                                                            <td className="p-3 font-mono text-[10px] text-gray-500 break-all max-w-[120px]">{row.product_id}</td>
                                                            <td className="p-3 text-white font-medium">{row.product_name}</td>
                                                            <td className="p-3 text-gray-400 text-xs">{row.unit}</td>
                                                            <td className="p-3 text-right font-mono text-gray-300">{row.stats.min ?? '—'}</td>
                                                            <td className="p-3 text-right font-mono text-gray-300">{row.stats.max ?? '—'}</td>
                                                            <td className="p-3 text-right font-mono text-gray-300">{row.stats.avg != null ? row.stats.avg.toFixed(2) : '—'}</td>
                                                            <td className="p-3 text-right font-mono text-amber-400/90">{row.stats.range ?? '—'}</td>
                                                            {branchesSorted.map(b => {
                                                                const v = row.byBranch[b.id];
                                                                return (
                                                                    <td key={b.id} className="p-3 text-right font-mono border-l border-white/5 text-white">{v != null ? v : '—'}</td>
                                                                );
                                                            })}
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    );
                })()}

                {showRecipeBuilderModal && (
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[101] flex items-center justify-center p-4">
                        <div className="bg-izbel-card w-full max-w-6xl max-h-[90vh] rounded-[2rem] border border-orange-500/40 shadow-[0_0_50px_rgba(249,115,22,0.2)] flex flex-col overflow-hidden">
                            <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-white/10">
                                <div>
                                    <h2 className="text-xl font-black text-white uppercase tracking-tight">Yeni reçete oluştur</h2>
                                    <p className="text-xs text-gray-400 mt-1">Ne üretimi yapılacak ürünü seç, malzemeleri gir, kaydet.</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowRecipeBuilderModal(false)}
                                    className="p-2 text-gray-500 hover:text-red-400 bg-white/5 rounded-xl transition-colors"
                                >
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="flex-1 overflow-auto p-4 space-y-4">
                                <div className="rounded-xl border border-orange-500/30 bg-orange-950/20 p-3">
                                    <div className="text-xs font-bold text-orange-200 uppercase tracking-widest">Eksik reçete şablonu</div>
                                    <div className="mt-2 flex flex-wrap items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setRecipeBuilderTemplateSelected(Object.fromEntries(salesRecipeRowsForUi.map((r) => [r.sale_product_id, true])))}
                                            className="text-xs font-bold px-3 py-2 rounded-lg border border-white/15 bg-white/10 text-white"
                                        >
                                            Tümünü seç
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setRecipeBuilderTemplateSelected({})}
                                            className="text-xs font-bold px-3 py-2 rounded-lg border border-white/15 bg-white/10 text-white"
                                        >
                                            Seçimi temizle
                                        </button>
                                        <button
                                            type="button"
                                            onClick={downloadRecipeTemplateFromBuilderSelection}
                                            className="text-xs font-bold px-3 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-white"
                                        >
                                            Eksik reçete şablonu indir
                                        </button>
                                    </div>
                                    <div className="mt-2 max-h-32 overflow-auto space-y-1 pr-1">
                                        {salesRecipeRowsForUi.map((r) => (
                                            <label key={`rb-${r.sale_product_id}`} className="flex items-center gap-2 text-xs text-gray-200">
                                                <input
                                                    type="checkbox"
                                                    className="accent-orange-500"
                                                    checked={!!recipeBuilderTemplateSelected[r.sale_product_id]}
                                                    onChange={(ev) => setRecipeBuilderTemplateSelected((prev) => ({ ...prev, [r.sale_product_id]: ev.target.checked }))}
                                                />
                                                <span className="font-mono">{r.sale_stok_kodu || '—'} · {r.sale_product_name} · {r.sold_qty}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3">
                                    <div className="text-xs font-bold text-emerald-200 uppercase tracking-widest mb-2">Reçete giriş</div>
                                    <label className="text-xs text-gray-400 font-bold uppercase tracking-widest">Ne üretimi yapacaksın</label>
                                    <select
                                        value={recipeBuilderRecipeProductId}
                                        onChange={(ev) => {
                                            const pid = ev.target.value;
                                            setRecipeBuilderRecipeProductId(pid);
                                            const existing = (recipeItems || []).filter((ri) => ri.recipe_product_id === pid);
                                            if (existing.length > 0) {
                                                setRecipeBuilderRows(existing.map((ri) => ({
                                                    ingredient_product_id: ri.ingredient_product_id,
                                                    qty: String(ri.quantity_per_recipe ?? ''),
                                                    unit: ri.recipe_unit || 'gr',
                                                })));
                                            } else {
                                                setRecipeBuilderRows([{ ingredient_product_id: '', qty: '', unit: 'gr' }]);
                                            }
                                        }}
                                        className="w-full mt-1 bg-izbel-dark border border-white/10 rounded-xl py-3 px-3 text-white outline-none focus:border-emerald-500"
                                    >
                                        <option value="">Ürün seçiniz...</option>
                                        {products.filter((p) => p.is_active !== false).map((p) => (
                                            <option key={p.id} value={p.id}>{p.stok_kodu || '—'} · {p.product_name}</option>
                                        ))}
                                    </select>

                                    <div className="mt-3 space-y-2">
                                        {recipeBuilderRows.map((row, idx) => (
                                            <div key={`rbi-${idx}`} className="grid grid-cols-1 md:grid-cols-[1fr,140px,120px,auto] gap-2 items-center">
                                                <select
                                                    value={row.ingredient_product_id}
                                                    onChange={(ev) => setRecipeBuilderRows((prev) => prev.map((x, i) => i === idx ? { ...x, ingredient_product_id: ev.target.value } : x))}
                                                    className="bg-izbel-dark border border-white/10 rounded-lg py-2.5 px-2 text-white"
                                                >
                                                    <option value="">Malzeme seçiniz...</option>
                                                    {products.filter((p) => p.is_active !== false).map((p) => (
                                                        <option key={p.id} value={p.id}>{p.stok_kodu || '—'} · {p.product_name}</option>
                                                    ))}
                                                </select>
                                                <input
                                                    value={row.qty}
                                                    onChange={(ev) => setRecipeBuilderRows((prev) => prev.map((x, i) => i === idx ? { ...x, qty: ev.target.value } : x))}
                                                    placeholder="Miktar"
                                                    className="bg-izbel-dark border border-white/10 rounded-lg py-2.5 px-2 text-white"
                                                />
                                                <select
                                                    value={row.unit || 'gr'}
                                                    onChange={(ev) => setRecipeBuilderRows((prev) => prev.map((x, i) => i === idx ? { ...x, unit: ev.target.value } : x))}
                                                    className="bg-izbel-dark border border-white/10 rounded-lg py-2.5 px-2 text-white"
                                                >
                                                    <option value="gr">gr</option>
                                                    <option value="adet">adet</option>
                                                    <option value="ml">ml</option>
                                                    <option value="kg">kg</option>
                                                    <option value="lt">lt</option>
                                                </select>
                                                <button
                                                    type="button"
                                                    onClick={() => setRecipeBuilderRows((prev) => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev)}
                                                    className="bg-red-600/20 hover:bg-red-600/40 text-red-300 border border-red-500/30 rounded-lg px-3 py-2 text-xs font-bold"
                                                >
                                                    Sil
                                                </button>
                                            </div>
                                        ))}
                                    </div>

                                    <div className="mt-3 flex flex-wrap items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setRecipeBuilderRows((prev) => [...prev, { ingredient_product_id: '', qty: '', unit: 'gr' }])}
                                            className="bg-white/10 hover:bg-white/20 text-white text-xs font-bold py-2 px-3 rounded-lg border border-white/10"
                                        >
                                            + Malzeme ekle
                                        </button>
                                        <button
                                            type="button"
                                            onClick={saveRecipeBuilder}
                                            disabled={recipeBuilderSaving}
                                            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold py-2 px-4 rounded-lg"
                                        >
                                            {recipeBuilderSaving ? 'Kaydediliyor...' : 'Kaydet'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {showSalesRecipeMapModal && (
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-4">
                        <div className="bg-izbel-card w-full max-w-5xl max-h-[88vh] rounded-[2rem] border border-emerald-500/40 shadow-[0_0_50px_rgba(16,185,129,0.18)] flex flex-col overflow-hidden">
                            <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-white/10">
                                <div>
                                    <h2 className="text-xl font-black text-white uppercase tracking-tight">Satış -{'>'} Ürün / reçete eşleştirme</h2>
                                    <p className="text-xs text-gray-500 mt-1">
                                        İstersen sadece eşleşmeyenleri, istersen eşleşmiş kayıtları da görüntüleyip yeniden kaydedebilirsin.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowSalesRecipeMapModal(false)}
                                    className="p-2 text-gray-500 hover:text-red-400 bg-white/5 rounded-xl transition-colors"
                                >
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="p-4 border-b border-white/10 space-y-3">
                                <div className="relative">
                                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                                    <input
                                        type="text"
                                        value={salesRecipeSearch}
                                        onChange={(e) => setSalesRecipeSearch(e.target.value)}
                                        placeholder="Ürün adı, stok kodu, barkod veya kategori ara..."
                                        className="w-full bg-izbel-dark border border-white/10 rounded-xl py-3 pl-11 pr-4 text-sm font-bold text-white outline-none focus:border-emerald-500"
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setSalesRecipeShowResolved((v) => !v)}
                                    className="bg-white/10 hover:bg-white/20 text-white text-xs font-bold py-2 px-3 rounded-lg border border-white/10"
                                >
                                    {salesRecipeShowResolved ? 'Sadece eşleşmeyenleri göster' : 'Eşleşmişleri de göster'}
                                </button>
                            </div>

                            <div className="flex-1 overflow-auto p-4 space-y-3">
                                {salesRecipeRowsForUi.map((r) => (
                                    <div key={r.sale_product_id} className="grid grid-cols-1 xl:grid-cols-[minmax(0,300px),1fr] gap-3 items-start bg-white/[0.02] border border-white/5 rounded-2xl p-4">
                                        <div className="min-w-0">
                                            <div className="text-[10px] uppercase tracking-widest text-emerald-300 font-bold mb-2">Satış kaydı</div>
                                            <div className="font-mono text-sm text-white break-words">
                                                {r.sale_stok_kodu || '—'} · {r.sale_product_name}
                                            </div>
                                            <div className="text-xs text-gray-500 mt-1">Miktar: {r.sold_qty}</div>
                                        </div>

                                        <div className="min-w-0">
                                            <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-2">Ürün seç</div>
                                            <select
                                                value={salesRecipeMap[r.sale_product_id] || ''}
                                                onChange={(ev) => void persistSalesRecipeMatch(r.sale_product_id, ev.target.value)}
                                                className="w-full bg-izbel-dark border border-white/10 rounded-xl py-3 px-3 text-white outline-none focus:border-emerald-500"
                                                disabled={!!salesRecipeMapSaving[r.sale_product_id]}
                                            >
                                                <option value="">Ürün seçiniz...</option>
                                                {salesRecipeCandidateProducts.map((p) => (
                                                    <option key={p.id} value={p.id}>
                                                        {p.stok_kodu || '—'} · {p.product_name}
                                                    </option>
                                                ))}
                                            </select>
                                            {salesRecipeMapSaving[r.sale_product_id] && (
                                                <div className="text-[11px] text-emerald-300 mt-2">Kaydediliyor...</div>
                                            )}
                                            {salesRecipeMap[r.sale_product_id] && (
                                                <div className="text-[11px] text-emerald-300 mt-2">
                                                    Seçilen: {products.find((p) => p.id === salesRecipeMap[r.sale_product_id])?.product_name || '—'}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="px-6 py-4 border-t border-white/10 flex justify-between items-center gap-3">
                                <div className="text-xs text-gray-500">
                                    Eşleşmeyen: {salesRecipeNeedsMapping.length} / Toplam satış ürünü: {salesRecipeAllForBranch.length}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowSalesRecipeMapModal(false)}
                                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 px-5 rounded-xl text-xs uppercase tracking-widest"
                                >
                                    Kapat
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* ÜRÜN DÜZENLEME MODALI */}
                {editingProduct && (
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-4">
                        <div className="bg-izbel-card w-full max-w-lg rounded-[2rem] border border-blue-500/50 p-8 shadow-[0_0_50px_rgba(37,99,235,0.2)] animate-slide-up">
                            <div className="flex justify-between items-center mb-6 border-b border-white/10 pb-4">
                                <div>
                                    <h2 className="text-2xl font-black text-white uppercase tracking-tight flex items-center gap-3">
                                        <Edit3 className="text-blue-500" /> Ürün Kartını Düzenle
                                    </h2>
                                    <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mt-1">Personelin Sahada Bulduğu Ürünleri Buradan Fiyatlandırın</p>
                                </div>
                                <button onClick={() => setEditingProduct(null)} className="p-2 text-gray-500 hover:text-red-400 bg-white/5 rounded-xl transition-colors"><X size={20} /></button>
                            </div>

                            <form onSubmit={handleUpdateProduct} className="space-y-5">
                                <div>
                                    <label className="text-xs uppercase font-bold tracking-widest text-gray-500 mb-2 block pl-2">Ürün Tam Adı</label>
                                    <input required value={editProductName} onChange={e => setEditProductName(e.target.value)} className="w-full bg-izbel-dark border border-white/10 p-4 rounded-xl focus:border-blue-500 outline-none font-medium text-white" />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs uppercase font-bold tracking-widest text-gray-500 mb-2 block pl-2">Stok Kodu (�?ubeler stok Excel)</label>
                                        <input value={editStokKodu} onChange={e => setEditStokKodu(e.target.value)} placeholder="ST00168" className="w-full bg-izbel-dark border border-white/10 p-4 rounded-xl focus:border-blue-500 outline-none font-medium text-white" />
                                    </div>
                                    <div>
                                        <label className="text-xs uppercase font-bold tracking-widest text-gray-500 mb-2 block pl-2">Barkod</label>
                                        <input value={editBarcode} onChange={e => setEditBarcode(e.target.value)} className="w-full bg-izbel-dark border border-white/10 p-4 rounded-xl focus:border-blue-500 outline-none font-medium text-white" />
                                    </div>
                                    <div>
                                        <label className="text-xs uppercase font-bold tracking-widest text-gray-500 mb-2 block pl-2">Maliyet Fiyatı (₺)</label>
                                        <input required type="number" step="0.01" value={editPurchasePrice} onChange={e => setEditPurchasePrice(e.target.value)} className="w-full bg-red-900/10 border border-red-500/30 p-4 rounded-xl focus:border-red-500 outline-none font-bold text-white shadow-inner" />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                    <div>
                                        <label className="text-xs uppercase font-bold tracking-widest text-gray-500 mb-2 block pl-2">Beklenen Sistem Stoğu (Sözde Stok)</label>
                                        <input required type="number" value={editCurrentStock} onChange={e => setEditCurrentStock(e.target.value)} className="w-full bg-izbel-dark border border-white/10 p-4 rounded-xl focus:border-blue-500 outline-none font-mono font-bold text-white text-lg" />
                                    </div>
                                    <div className="relative">
                                        <label className="text-xs uppercase font-bold tracking-widest text-gray-500 mb-2 block pl-2">Kategori</label>
                                        <input
                                            value={editCategory}
                                            onChange={e => setEditCategory(e.target.value)}
                                            onFocus={() => setShowEditCatDropdown(true)}
                                            onBlur={() => setTimeout(() => setShowEditCatDropdown(false), 200)}
                                            placeholder="Örn: İçecekler"
                                            className="w-full bg-izbel-dark border border-white/10 p-4 rounded-xl focus:border-blue-500 outline-none font-medium text-white"
                                        />
                                        {showEditCatDropdown && (categories.length > 0 || existingCategories.length > 0) && (
                                            <div className="absolute top-full left-0 right-0 mt-2 bg-izbel-dark border border-white/10 rounded-xl shadow-2xl z-50 max-h-40 overflow-y-auto border border-blue-500/30">
                                                {(categories.length > 0 ? categories.map(c => c.name) : existingCategories).map(cat => (
                                                    <div
                                                        key={cat}
                                                        className="p-3 hover:bg-white/5 cursor-pointer text-white font-medium border-b border-white/5 last:border-none uppercase text-xs"
                                                        onClick={() => {
                                                            setEditCategory(cat);
                                                            setShowEditCatDropdown(false);
                                                        }}
                                                    >
                                                        {cat}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <div>
                                        <label className="text-xs uppercase font-bold tracking-widest text-gray-500 mb-2 block pl-2">Birim Miktarı</label>
                                        <select
                                            value={editUnit}
                                            onChange={e => setEditUnit(e.target.value)}
                                            className="w-full bg-izbel-dark border border-white/10 p-4 rounded-xl focus:border-blue-500 outline-none font-medium text-white appearance-none cursor-pointer"
                                        >
                                            <option value="Adet">Adet (Tane)</option>
                                            <option value="Kg">Kilogram (Kg)</option>
                                            <option value="Lt">Litre (Lt)</option>
                                            <option value="Gr">Gram (Gr)</option>
                                            <option value="Ml">Mililitre (Ml)</option>
                                            <option value="Metre">Metre</option>
                                            <option value="Paket">Paket</option>
                                            <option value="Kutu">Kutu</option>
                                            <option value="Koli">Koli</option>
                                            <option value="Çuval">Çuval</option>
                                        </select>
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-xl bg-white/5 border border-white/10">
                                    <p className="md:col-span-2 text-[10px] font-bold text-gray-500 uppercase tracking-widest">Dönüşüm (rapor — isteğe bağlı)</p>
                                    <div>
                                        <label className="text-xs uppercase font-bold tracking-widest text-gray-500 mb-2 block pl-2">Paket içi adet</label>
                                        <input type="text" inputMode="decimal" value={editPiecesPerPackage} onChange={e => setEditPiecesPerPackage(e.target.value)} placeholder="Örn: 12 (birim PAKET ise)" className="w-full bg-izbel-dark border border-white/10 p-4 rounded-xl focus:border-blue-500 outline-none font-medium text-white placeholder-gray-600" />
                                    </div>
                                    <div>
                                        <label className="text-xs uppercase font-bold tracking-widest text-gray-500 mb-2 block pl-2">Lt / birim</label>
                                        <input type="text" inputMode="decimal" value={editLitersPerUnit} onChange={e => setEditLitersPerUnit(e.target.value)} placeholder="Çoğu Lt üründe 1" className="w-full bg-izbel-dark border border-white/10 p-4 rounded-xl focus:border-blue-500 outline-none font-medium text-white placeholder-gray-600" />
                                    </div>
                                </div>

                                <div className="flex gap-4 pt-4 border-t border-white/10">
                                    <button type="button" onClick={() => setEditingProduct(null)} className="flex-1 bg-white/5 hover:bg-white/10 text-white font-bold py-4 rounded-xl transition-all tracking-widest border border-white/10">İPTAL</button>
                                    <button type="submit" disabled={isLoading} className="flex-2 w-2/3 bg-blue-600 hover:bg-blue-500 text-white font-black py-4 rounded-xl shadow-[0_0_20px_rgba(37,99,235,0.4)] transition-all tracking-widest active:scale-95">
                                        {isLoading ? '...' : (showSavedOnButton ? 'KAYDEDİLDİ' : 'DE�?İ�?İKLİKLERİ KAYDET')}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* --------- TAB 4: KATEGORİ YÖNETİMİ --------- */}
                {activeTab === 'kategoriler' && (
                    <div className="bg-izbel-card border border-white/5 rounded-[2rem] animate-fade-in overflow-hidden shadow-2xl">
                        <div className="p-6 border-b border-white/5 bg-white/[0.01]">
                            <h2 className="text-2xl font-black tracking-tight flex items-center gap-3">
                                <Tag className="text-blue-500" /> Kategori Yönetimi
                            </h2>
                            <p className="text-sm text-gray-500 font-medium mt-1">Barkod veya manuel ürün eklerken kullanılacak kategorileri buradan ekleyin</p>
                        </div>
                        <div className="p-6 border-b border-white/5 bg-izbel-dark/30">
                            <form onSubmit={handleAddCategory} className="flex flex-wrap gap-3 items-end">
                                <div className="flex-1 min-w-[200px]">
                                    <label className="text-xs uppercase font-bold tracking-widest text-gray-500 mb-1 block pl-2">Yeni kategori adı</label>
                                    <input
                                        type="text"
                                        value={newCategoryName}
                                        onChange={e => setNewCategoryName(e.target.value)}
                                        placeholder="Örn: İçecekler, Atıştırmalık"
                                        className="w-full bg-izbel-dark border border-white/10 p-3 rounded-xl focus:border-blue-500 outline-none font-medium text-white placeholder-gray-600"
                                    />
                                </div>
                                <button type="submit" disabled={isLoading || !newCategoryName.trim()} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-xl transition-all uppercase tracking-widest">
                                    <Plus size={18} /> Ekle
                                </button>
                            </form>
                        </div>
                        <div className="p-6">
                            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Mevcut kategoriler</h3>
                            {categories.length === 0 ? (
                                <p className="text-gray-500 font-medium">Henüz kategori yok. Yukarıdan ekleyin.</p>
                            ) : (
                                <ul className="flex flex-col gap-2">
                                    {categories.map(cat => (
                                        <li key={cat.id} className="flex items-center justify-between bg-izbel-dark/50 border border-white/5 rounded-xl px-4 py-3">
                                            <span className="font-medium text-white">{cat.name}</span>
                                            <button type="button" onClick={() => handleDeleteCategory(cat.id)} className="p-2 rounded-lg text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors" title="Kategoriyi sil">
                                                <Trash2 size={18} />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                )}

                {/* --------- TAB 6: TEDARIK CSV IMPORT --------- */}
                {activeTab === 'tedarikcv' && (() => {
                    // --- GEÇERSIZ �?UBE ADLARI ---
                    const INVALID_BRANCHES = new Set([
                        '', '(şube belirtilmemiş)', 'şube / sevk', 'alt toplam',
                    ]);
                    const isInvalidBranch = (name) => {
                        const n = (name || '').trim().toLowerCase();
                        if (INVALID_BRANCHES.has(n)) return true;
                        if (/^yalnız/i.test(n)) return true;
                        if (/^\(hata/i.test(n)) return true;
                        if (/^\d/.test(n) && n.includes('sok')) return true;
                        if (/tedarikçi/i.test(n)) return true;
                        return false;
                    };

                    // --- CSV YÜKLEME ---
                    const handleTcvFileUpload = (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                            const text = ev.target.result;
                            const lines = text.split('\n');
                            const rows = lines.map(l => l.split(';').map(c => c.trim()));
                            if (rows.length < 2) {
                                toast.error('CSV boş veya geçersiz.');
                                return;
                            }
                            // Toplama: (branch, material) -> {totalQty, unit, suppliers}
                            const agg = new Map();
                            for (let i = 1; i < rows.length; i++) {
                                const r = rows[i];
                                if (r.length < 7) continue;
                                const supplier = (r[0] || '').trim();
                                const csvBranch = (r[1] || '').trim();
                                const material = (r[2] || '').trim();
                                const qtyRaw = (r[5] || '').replace(/\./g, '').replace(',', '.');
                                const qty = Number(qtyRaw);
                                const unit = (r[6] || '').trim();
                                if (!material || !Number.isFinite(qty) || qty <= 0) continue;
                                if (isInvalidBranch(csvBranch)) continue;
                                if (/^tedarikçi/i.test(supplier)) continue;
                                if (/^alt toplam/i.test(supplier)) continue;
                                const key = `${csvBranch.toUpperCase()}|||${material.toUpperCase()}`;
                                if (!agg.has(key)) {
                                    agg.set(key, { csvBranch: csvBranch.toUpperCase(), materialName: material.toUpperCase(), totalQty: 0, unit, suppliers: new Set(), key });
                                }
                                const entry = agg.get(key);
                                entry.totalQty += qty;
                                if (supplier) entry.suppliers.add(supplier);
                            }
                            const result = Array.from(agg.values()).map(e => ({
                                ...e,
                                totalQty: Math.round(e.totalQty * 1000) / 1000,
                                suppliers: Array.from(e.suppliers).join(', '),
                            }));
                            result.sort((a, b) => a.csvBranch.localeCompare(b.csvBranch, 'tr') || a.materialName.localeCompare(b.materialName, 'tr'));
                            setTcvAggregated(result);
                            // �?ube otomatik eşleme dene
                            const bMap = {};
                            const uniqBranches = [...new Set(result.map(r => r.csvBranch))];
                            uniqBranches.forEach(cb => {
                                const cbFold = asciiFoldKey(cb);
                                const found = branches.find(b => asciiFoldKey(b.branch_name) === cbFold);
                                if (found) bMap[cb] = found.id;
                            });
                            setTcvBranchMap(bMap);
                            setTcvProductMap({});
                            setTcvProductSearch({});
                            setTcvQtyOverride({});
                            setTcvUnlockedEdits({});
                            setTcvStep('match');
                            toast.success(`CSV yüklendi: ${result.length} satır (birleştirilmiş), ${uniqBranches.length} şube.`);
                        };
                        reader.readAsText(file, 'utf-8');
                        e.target.value = '';
                    };

                    // --- İSTATİSTİKLER ---
                    const tcvUniqBranches = [...new Set(tcvAggregated.map(r => r.csvBranch))];
                    const tcvUniqMaterials = [...new Set(tcvAggregated.map(r => r.materialName))];
                    const tcvMatchedProductCount = tcvUniqMaterials.filter(m => tcvProductMap[m]).length;
                    const tcvMatchedBranchCount = tcvUniqBranches.filter(b => tcvBranchMap[b]).length;
                    // Eşleşmeyen şubeler ve ürünler atlanır — sorun değil
                    const tcvAllProductsMatched = tcvUniqMaterials.length > 0 && tcvMatchedProductCount === tcvUniqMaterials.length;
                    
                    const activePeriodForTcv = periods.find(p => p.is_active);
                    
                    // Uygulanacak geçerli (hazır) satır sayısını bulalım
                    const tcvReadyRows = tcvAggregated.filter(r => {
                        const bid = tcvBranchMap[r.csvBranch];
                        const pid = tcvProductMap[r.materialName];
                        if (!bid || !pid) return false;
                        const ov = tcvQtyOverride[r.key];
                        if (ov !== undefined && ov !== '' && Number.isFinite(Number(ov)) && Number(ov) > 0) return true;
                        const csvQty = Number(r.totalQty);
                        if (Number.isFinite(csvQty) && csvQty > 0) return true;
                        
                        // Önceden kayıtlı mı kontrol et
                        const mapKey = `${bid}|${pid}`;
                        const existingSaved = manualPurchaseByKey[mapKey];
                        if (existingSaved > 0 && !tcvUnlockedEdits[r.key]) return true; // Daha önce kaydedilmiş ve dokunulmuyor
                        
                        return false;
                    });
                    
                    const tcvCanApply = tcvReadyRows.length > 0;

                    // Filtre
                    const tcvFilterNorm = normalizeText(tcvFilter);
                    const tcvFilteredAgg = tcvAggregated.filter(r => {
                        if (tcvFilterNorm) {
                            const hay = normalizeText(`${r.csvBranch} ${r.materialName} ${r.suppliers}`);
                            if (!tcvFilterNorm.split(' ').filter(Boolean).every(w => hay.includes(w))) return false;
                        }
                        const isMatched = !!tcvProductMap[r.materialName];
                        if (!tcvShowMatched && isMatched) return false;
                        if (!tcvShowUnmatched && !isMatched) return false;
                        return true;
                    });

                    // --- TEK TIKLA UYGULA ---
                    const handleTcvApplyAll = async () => {
                        const activePeriod = periods.find(p => p.is_active);
                        if (!activePeriod) {
                            toast.error('Aktif sayım dönemi yok.');
                            return;
                        }
                        // Kontrol — eşleşmeyen şubeler ve ürünler atlanır
                        
                        // {branchId|productId} -> toplam miktar (override veya önceden kayıtlı)
                        const supplyMap = {};
                        let skippedBranch = 0;
                        let skippedProduct = 0;
                        tcvAggregated.forEach(r => {
                            const bid = tcvBranchMap[r.csvBranch];
                            const pid = tcvProductMap[r.materialName];
                            if (!bid) { skippedBranch++; return; }
                            if (!pid) { skippedProduct++; return; }
                            
                            const k = `${bid}|${pid}`;
                            const ov = tcvQtyOverride[r.key];
                            const existingSaved = manualPurchaseByKey[k];
                            
                            let qty = 0;
                            if (ov !== undefined && ov !== '' && Number.isFinite(Number(ov)) && Number(ov) > 0) {
                                qty = Number(ov);
                            } else if (Number.isFinite(Number(r.totalQty)) && Number(r.totalQty) > 0) {
                                qty = Number(r.totalQty);
                            } else if (existingSaved > 0 && !tcvUnlockedEdits[r.key]) {
                                qty = existingSaved;
                            }
                            
                            if (qty <= 0) return;
                            supplyMap[k] = (supplyMap[k] || 0) + qty;
                        });
                        const keys = Object.keys(supplyMap);
                        if (keys.length === 0) {
                            toast.error('Uygulanacak veri yok.');
                            return;
                        }
                        const skippedMsg = (skippedBranch > 0 || skippedProduct > 0) ? `\n(${skippedBranch > 0 ? skippedBranch + ' şube' : ''}${(skippedBranch > 0 && skippedProduct > 0) ? ' ve ' : ''}${skippedProduct > 0 ? skippedProduct + ' ürün' : ''} eşleşmediği için atlanacak)` : '';
                        const ok = window.confirm(`${keys.length} adet şube×ürün satırı manual_supplies tablosuna kaydedilecek (aktif dönem: ${activePeriod.period_name}).${skippedMsg}\nDevam?`);
                        if (!ok) return;

                        setIsLoading(true);
                        // Her şubenin bu dönemdeki eski tedariklerini sil
                        const affectedBranches = [...new Set(keys.map(k => k.split('|')[0]))];
                        for (const bid of affectedBranches) {
                            await supabase.from('manual_supplies').delete().eq('branch_id', bid).eq('period_id', activePeriod.id);
                        }
                        // Yeni satırları upsert
                        const upsertRows = keys.map(k => {
                            const [bid, pid] = k.split('|');
                            return {
                                branch_id: bid,
                                product_id: pid,
                                period_id: activePeriod.id,
                                quantity: supplyMap[k],
                                updated_at: new Date().toISOString(),
                            };
                        });
                        for (let i = 0; i < upsertRows.length; i += 500) {
                            const chunk = upsertRows.slice(i, i + 500);
                            const { error } = await supabase.from('manual_supplies').upsert(chunk, { onConflict: 'branch_id,product_id,period_id' });
                            if (error) {
                                setIsLoading(false);
                                toast.error('Kayıt hatası: ' + error.message);
                                return;
                            }
                        }
                        await fetchData();
                        setIsLoading(false);
                        toast.success(`Tedarik aktarıldı: ${keys.length} satır → ${affectedBranches.length} şube (manual_supplies). Stoklara yansıması için Onay ekranından 'Düş' butonunu kullanın.`);
                        setTcvStep('upload');
                        setTcvAggregated([]);
                    };

                    return (
                        <div className="space-y-8 animate-fade-in">
                            {/* HEADER */}
                            <div className="bg-izbel-card border border-fuchsia-500/20 rounded-[2rem] p-8 shadow-2xl">
                                <h2 className="text-2xl font-black tracking-tight flex items-center gap-3 mb-2">
                                    <Warehouse className="text-fuchsia-400" /> Tedarik CSV Eşleştirme &amp; Yükleme
                                </h2>
                                <p className="text-sm text-gray-400 leading-relaxed max-w-3xl">
                                    <strong>subeduzeltilmis tedarik.csv</strong> dosyasını yükleyin → �?ubeleri ve ürünleri sistem ile eşleştirin → Tek tıkla tüm şubelere stok aktarın.
                                    <br/>Aynı şube + aynı malzeme satırları <span className="text-fuchsia-300 font-bold">otomatik toplanır</span>.
                                </p>
                            </div>

                            {/* ADIM GÖSTERGESI */}
                            <div className="flex items-center gap-2">
                                {['upload', 'match'].map((s, i) => {
                                    const labels = ['1. CSV Yükle', '2. Eşleştir & Uygula'];
                                    const active = tcvStep === s;
                                    const done = (s === 'upload' && tcvStep !== 'upload');
                                    return (
                                        <button key={s} onClick={() => { if (done || active) setTcvStep(s); }}
                                            className={`px-5 py-2.5 rounded-xl text-sm font-bold border transition-all ${
                                                active ? 'bg-fuchsia-600 text-white border-fuchsia-500 shadow-lg shadow-fuchsia-500/20'
                                                : done ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/30'
                                                : 'bg-white/5 text-gray-500 border-white/10'
                                            }`}
                                        >
                                            {done && <Check size={14} className="inline mr-1" />}
                                            {labels[i]}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* STEP 1: CSV UPLOAD */}
                            {tcvStep === 'upload' && (
                                <div className="bg-izbel-card border border-white/10 rounded-[2rem] p-10 flex flex-col items-center gap-6">
                                    <div className="w-20 h-20 rounded-2xl bg-fuchsia-500/10 border-2 border-dashed border-fuchsia-500/40 flex items-center justify-center">
                                        <Download size={36} className="text-fuchsia-400" />
                                    </div>
                                    <div className="text-center">
                                        <h3 className="text-xl font-black text-white mb-1">CSV Dosyası Seçin</h3>
                                        <p className="text-xs text-gray-500">subeduzeltilmis tedarik.csv — noktalı virgül (;) ayraçlı</p>
                                    </div>
                                    <label className="bg-fuchsia-600 hover:bg-fuchsia-500 text-white py-3 px-8 rounded-xl font-bold cursor-pointer transition-all shadow-lg active:scale-95">
                                        Dosya Seç
                                        <input type="file" accept=".csv" onChange={handleTcvFileUpload} className="hidden" />
                                    </label>
                                </div>
                            )}

                            {/* STEP 2: E�?LE�?TİRME */}
                            {tcvStep === 'match' && tcvAggregated.length > 0 && (
                                <div className="space-y-6">
                                    {/* İSTATİSTİK KARTLARI */}
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                        <div className="bg-izbel-card border border-white/10 rounded-2xl p-5 text-center">
                                            <div className="text-3xl font-black text-white">{tcvAggregated.length}</div>
                                            <div className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mt-1">Toplam Satır</div>
                                        </div>
                                        <div className={`bg-izbel-card border rounded-2xl p-5 text-center ${tcvMatchedBranchCount === tcvUniqBranches.length ? 'border-emerald-500/30' : 'border-amber-500/30'}`}>
                                            <div className={`text-3xl font-black ${tcvMatchedBranchCount === tcvUniqBranches.length ? 'text-emerald-400' : 'text-amber-400'}`}>{tcvMatchedBranchCount}/{tcvUniqBranches.length}</div>
                                            <div className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mt-1">�?ube Eşleşme</div>
                                        </div>
                                        <div className={`bg-izbel-card border rounded-2xl p-5 text-center ${tcvAllProductsMatched ? 'border-emerald-500/30' : 'border-amber-500/30'}`}>
                                            <div className={`text-3xl font-black ${tcvAllProductsMatched ? 'text-emerald-400' : 'text-amber-400'}`}>{tcvMatchedProductCount}/{tcvUniqMaterials.length}</div>
                                            <div className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mt-1">Ürün Eşleşme</div>
                                        </div>
                                        <div className="bg-izbel-card border border-white/10 rounded-2xl p-5 flex items-center justify-center">
                                            <button
                                                onClick={handleTcvApplyAll}
                                                disabled={!tcvCanApply || isLoading}
                                                className={`py-3 px-6 rounded-xl text-sm font-black uppercase tracking-widest transition-all active:scale-95 ${
                                                    tcvCanApply
                                                        ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-500/30'
                                                        : 'bg-white/5 text-gray-600 cursor-not-allowed'
                                                }`}
                                            >
                                                {isLoading ? 'Kaydediliyor…' : 'Tümünü Uygula'}
                                            </button>
                                        </div>
                                    </div>

                                    {/* �?UBE E�?LE�?TİRME */}
                                    <div className="bg-izbel-card border border-white/10 rounded-[2rem] p-6">
                                        <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                            <Users size={16} /> �?ube Eşleştirme
                                        </h3>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                            {tcvUniqBranches.map(cb => {
                                                const matched = tcvBranchMap[cb];
                                                return (
                                                    <div key={cb} className={`flex items-center gap-2 p-3 rounded-xl border ${
                                                        matched ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'
                                                    }`}>
                                                        <span className="text-xs font-bold text-white flex-shrink-0 min-w-[80px]">{cb}</span>
                                                        <ChevronRight size={14} className="text-gray-600 flex-shrink-0" />
                                                        <select
                                                            value={matched || ''}
                                                            onChange={(e) => setTcvBranchMap(prev => ({ ...prev, [cb]: e.target.value || undefined }))}
                                                            className="flex-1 bg-izbel-dark border border-white/10 rounded-lg py-1.5 px-2 text-xs text-white outline-none focus:border-fuchsia-500"
                                                        >
                                                            <option value="">— �?ube seçin —</option>
                                                            {branches.map(b => (
                                                                <option key={b.id} value={b.id}>{b.branch_name}</option>
                                                            ))}
                                                        </select>
                                                        {matched && <Check size={16} className="text-emerald-400 flex-shrink-0" />}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* ÜRÜN E�?LE�?TİRME */}
                                    <div className="bg-izbel-card border border-white/10 rounded-[2rem] p-6">
                                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
                                            <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                                <Package size={16} /> Ürün Eşleştirme ({tcvMatchedProductCount}/{tcvUniqMaterials.length})
                                            </h3>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    value={tcvFilter}
                                                    onChange={(e) => setTcvFilter(e.target.value)}
                                                    placeholder="Malzeme / şube ara…"
                                                    className="bg-izbel-dark border border-white/10 rounded-lg py-2 px-3 text-sm text-white outline-none focus:border-fuchsia-500 w-64"
                                                />
                                                <label className="flex items-center gap-1 text-[10px] text-gray-400 font-bold cursor-pointer">
                                                    <input type="checkbox" checked={tcvShowMatched} onChange={e => setTcvShowMatched(e.target.checked)} className="accent-emerald-500" />
                                                    Eşleşen
                                                </label>
                                                <label className="flex items-center gap-1 text-[10px] text-gray-400 font-bold cursor-pointer">
                                                    <input type="checkbox" checked={tcvShowUnmatched} onChange={e => setTcvShowUnmatched(e.target.checked)} className="accent-amber-500" />
                                                    Eşleşmeyen
                                                </label>
                                            </div>
                                        </div>
                                        <div className="overflow-x-auto max-h-[600px] overflow-y-auto border border-white/10 rounded-xl">
                                            <table className="w-full text-left text-xs">
                                                <thead className="sticky top-0 bg-izbel-dark z-10 border-b border-white/10">
                                                    <tr className="text-gray-500 uppercase tracking-widest">
                                                        <th className="p-3 pl-4 w-10">#</th>
                                                        <th className="p-3">CSV �?ube</th>
                                                        <th className="p-3">Malzeme Adı</th>
                                                        <th className="p-3 text-right">CSV Miktar</th>
                                                        <th className="p-3">Tedarikçiler</th>
                                                        <th className="p-3 min-w-[280px]">Sistem Ürünü</th>
                                                        <th className="p-3 min-w-[160px]">Gerçek Miktar</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {tcvFilteredAgg.map((r, idx) => {
                                                        const isProductMatched = !!tcvProductMap[r.materialName];
                                                        const isBranchMatched = !!tcvBranchMap[r.csvBranch];
                                                        const matchedProduct = isProductMatched ? products.find(p => p.id === tcvProductMap[r.materialName]) : null;
                                                        const searchVal = tcvProductSearch[r.materialName] || '';
                                                        // Ürün arama sonuçları
                                                        const searchResults = searchVal.length >= 2 ? (() => {
                                                            const q = normalizeText(searchVal);
                                                            const words = q.split(' ').filter(Boolean);
                                                            return products.filter(p => p.is_active !== false).filter(p => {
                                                                const hay = normalizeText(`${p.stok_kodu || ''} ${p.product_name || ''} ${p.barcode || ''}`);
                                                                return words.every(w => hay.includes(w));
                                                            }).slice(0, 12);
                                                        })() : [];

                                                        return (
                                                            <tr key={r.key} className={`border-b border-white/5 ${
                                                                isProductMatched ? 'bg-emerald-500/[0.03]' : 'bg-amber-500/[0.03]'
                                                            } hover:bg-white/[0.04] transition-colors`}>
                                                                <td className="p-3 pl-4 text-gray-600 font-mono">{idx + 1}</td>
                                                                <td className="p-3">
                                                                    <span className={`text-xs font-bold px-2 py-1 rounded ${isBranchMatched ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20' : 'bg-red-500/10 text-red-300 border border-red-500/20'}`}>
                                                                        {r.csvBranch}
                                                                    </span>
                                                                </td>
                                                                <td className="p-3 text-white font-bold">{r.materialName}</td>
                                                                <td className="p-3 text-right">
                                                                    <span className="font-mono text-fuchsia-300 font-bold">{r.totalQty}</span>
                                                                    <span className="text-gray-500 ml-1 text-[10px]">{r.unit}</span>
                                                                </td>
                                                                <td className="p-3 text-gray-500 text-[10px] max-w-[200px] truncate" title={r.suppliers}>{r.suppliers}</td>
                                                                <td className="p-3">
                                                                    {isProductMatched ? (
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="bg-emerald-500/10 text-emerald-300 px-2 py-1 rounded border border-emerald-500/20 text-xs font-bold">
                                                                                {matchedProduct?.stok_kodu || '—'}
                                                                            </span>
                                                                            <span className="text-white text-xs truncate max-w-[120px]" title={matchedProduct?.product_name}>{matchedProduct?.product_name}</span>
                                                                            <button
                                                                                onClick={() => {
                                                                                    setTcvProductMap(prev => { const n = {...prev}; delete n[r.materialName]; return n; });
                                                                                    setTcvQtyOverride(prev => { const n = {...prev}; delete n[r.key]; return n; });
                                                                                    setTcvUnlockedEdits(prev => { const n = {...prev}; delete n[r.key]; return n; });
                                                                                }}
                                                                                className="text-red-400 hover:text-red-300 p-1 rounded hover:bg-red-500/10 transition-colors"
                                                                                title="Eşleşmeyi kaldır"
                                                                            >
                                                                                <X size={14} />
                                                                            </button>
                                                                        </div>
                                                                    ) : (
                                                                        <div className="relative">
                                                                            <input
                                                                                value={searchVal}
                                                                                onChange={(e) => setTcvProductSearch(prev => ({ ...prev, [r.materialName]: e.target.value }))}
                                                                                placeholder="Stok kodu veya ürün adı…"
                                                                                className="w-full bg-izbel-dark border border-amber-500/30 rounded-lg py-1.5 px-2.5 text-xs text-white outline-none focus:border-fuchsia-500"
                                                                            />
                                                                            {searchResults.length > 0 && (
                                                                                <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-izbel-card border border-fuchsia-500/30 rounded-xl shadow-2xl max-h-48 overflow-auto">
                                                                                    {searchResults.map(p => (
                                                                                        <button
                                                                                            key={p.id}
                                                                                            type="button"
                                                                                            onClick={() => {
                                                                                                setTcvProductMap(prev => ({ ...prev, [r.materialName]: p.id }));
                                                                                                setTcvProductSearch(prev => ({ ...prev, [r.materialName]: '' }));
                                                                                            }}
                                                                                            className="w-full text-left px-3 py-2 hover:bg-fuchsia-500/10 transition-colors border-b border-white/5 last:border-0"
                                                                                        >
                                                                                            <span className="text-fuchsia-300 font-mono font-bold text-xs mr-2">{p.stok_kodu || '—'}</span>
                                                                                            <span className="text-white text-xs">{p.product_name}</span>
                                                                                            <span className="text-gray-600 text-[10px] ml-2">{p.unit}</span>
                                                                                        </button>
                                                                                    ))}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                </td>
                                                                <td className="p-3">
                                                                    {isProductMatched && isBranchMatched ? (() => {
                                                                        const k = `${tcvBranchMap[r.csvBranch]}|${tcvProductMap[r.materialName]}`;
                                                                        const existingSaved = manualPurchaseByKey[k];
                                                                        const hasExisting = existingSaved !== undefined && existingSaved > 0;
                                                                        const isUnlocked = tcvUnlockedEdits[r.key] || false;
                                                                        
                                                                        if (hasExisting && !isUnlocked) {
                                                                            return (
                                                                                <div className="flex items-center gap-2">
                                                                                    <div className="text-right font-mono text-xs text-blue-300 bg-blue-500/10 border border-blue-500/30 rounded-lg py-1.5 px-3 flex items-center justify-between min-w-[80px]">
                                                                                        <span>{existingSaved}</span>
                                                                                        <span className="text-[10px] text-blue-400 font-bold ml-2">{matchedProduct?.unit || 'ADET'}</span>
                                                                                    </div>
                                                                                    <button 
                                                                                        onClick={() => setTcvUnlockedEdits(prev => ({ ...prev, [r.key]: true }))}
                                                                                        className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors bg-izbel-dark border border-white/5"
                                                                                        title="Değeri değiştir"
                                                                                    >
                                                                                        <Edit3 size={14} />
                                                                                    </button>
                                                                                </div>
                                                                            );
                                                                        }
                                                                        
                                                                        return (
                                                                            <div className="flex items-center gap-1.5">
                                                                                <input
                                                                                    type="text"
                                                                                    inputMode="decimal"
                                                                                    value={tcvQtyOverride[r.key] ?? ''}
                                                                                    onChange={(e) => setTcvQtyOverride(prev => ({ ...prev, [r.key]: e.target.value }))}
                                                                                    placeholder={hasExisting ? String(existingSaved) : String(r.totalQty)}
                                                                                    className={`w-20 bg-izbel-dark border rounded-lg py-1.5 px-2 text-right font-mono text-xs outline-none focus:border-fuchsia-500 ${
                                                                                        tcvQtyOverride[r.key] !== undefined && tcvQtyOverride[r.key] !== ''
                                                                                            ? 'border-emerald-500/40 text-emerald-300' : 'border-amber-500/30 text-amber-300'
                                                                                    }`}
                                                                                />
                                                                                <span className="text-[10px] text-gray-500 font-bold min-w-[40px]">{matchedProduct?.unit || 'ADET'}</span>
                                                                            </div>
                                                                        );
                                                                    })() : !isBranchMatched ? (
                                                                        <span className="text-[10px] text-gray-600 italic">şube eşleşmedi</span>
                                                                    ) : null}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                    {tcvFilteredAgg.length === 0 && (
                                                        <tr><td colSpan={8} className="p-10 text-center text-gray-500 font-bold">Filtre sonucu boş.</td></tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })()}
            </div>
        </div>
    );
}






