import React, { useState, useCallback, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { Scanner } from '@yudiel/react-qr-scanner';
import toast, { Toaster } from 'react-hot-toast';
import { LogOut, ChevronRight, X } from 'lucide-react';

function formatIstanbulDateTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('tr-TR', {
        timeZone: 'Europe/Istanbul',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export default function CountingScreen({ branchId, branchInfo, personName, onLogout }) {
    const [step, setStep] = useState(1);
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [selectedProduct, setSelectedProduct] = useState(null);
    const [inputValue, setInputValue] = useState('');
    const [numpadOpen, setNumpadOpen] = useState(false);
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [cameraError, setCameraError] = useState(false);
    const [scannerRetryCount, setScannerRetryCount] = useState(0);
    const [isSaving, setIsSaving] = useState(false);
    const [activePeriod, setActivePeriod] = useState(null);
    const [myCounts, setMyCounts] = useState([]);
    const [isFetchingCounts, setIsFetchingCounts] = useState(false);
    // Geçmiş sayım düzenleme akışında, ilk numpad girişini mevcut değerin üzerine eklemek yerine "yerine yaz" moduna alıyoruz.
    const [replaceInputOnNextKey, setReplaceInputOnNextKey] = useState(false);
    // true ise kayıtta mevcut değeri değiştirir; false ise mevcut değerin üzerine ekler.
    const [isEditCountMode, setIsEditCountMode] = useState(false);
    /** Admin’in şube bazlı girdiği sistem stoku (branch_stocks); yoksa ürün.current_stock */
    const [branchSystemStock, setBranchSystemStock] = useState(null);
    /** branch_stocks.unit_cost; yoksa ürün.purchase_price gösterilir */
    const [branchUnitCost, setBranchUnitCost] = useState(null);

    const shouldIgnoreScannerPlayInterruptedError = (error) => {
        const msg = (error?.message || error || '').toString();
        // Bazı mobil tarayıcı/React yeniden-render senaryolarında kamera video elemanı DOM'dan kalktığı için
        // play() çağrısı yarıda kesilip bu mesajı üretebiliyor. Kullanıcıyı gereksiz toast ile yormuyoruz.
        return msg.includes('play() request was interrupted') && msg.includes('media was removed from the document');
    };

    const isCameraStreamTimeoutError = (error) => {
        const msg = (error?.message || error || '').toString().toLowerCase();
        return msg.includes('loading camera stream') && msg.includes('timed out');
    };

    // Şube/personel: ürün barkodu + maliyet düzenleme
    const [showEditProductModal, setShowEditProductModal] = useState(false);
    const [editBarcode, setEditBarcode] = useState('');
    const [editPurchasePrice, setEditPurchasePrice] = useState('');
    const [isUpdatingProduct, setIsUpdatingProduct] = useState(false);
    const [editBarcodeScannerOpen, setEditBarcodeScannerOpen] = useState(false);

    // Gelişmiş filtreleme: Kategori → Ürün listesi (Stok Kodu - Ürün İsmi) → Adet
    const [showAdvancedFilter, setShowAdvancedFilter] = useState(false);
    const [filterStep, setFilterStep] = useState(1);
    const [selectedFilterCategory, setSelectedFilterCategory] = useState('');
    const [allProductsForFilter, setAllProductsForFilter] = useState([]);
    const [filterCategorySearch, setFilterCategorySearch] = useState('');
    const [filterProductSearch, setFilterProductSearch] = useState('');

    // Fetch active period and categories on mount
    const [existingCategories, setExistingCategories] = useState([]);
    const [branchProductIds, setBranchProductIds] = useState([]);
    const [isBranchProductsReady, setIsBranchProductsReady] = useState(false);

    React.useEffect(() => {
        let cancelled = false;
        const fetchBranchProducts = async () => {
            setIsBranchProductsReady(false);
            const { data, error } = await supabase
                .from('branch_stocks')
                .select('product_id')
                .eq('branch_id', branchId);

            if (cancelled) return;
            if (error) {
                setBranchProductIds([]);
                setIsBranchProductsReady(true);
                return;
            }

            setBranchProductIds((data || []).map((row) => row.product_id).filter(Boolean));
            setIsBranchProductsReady(true);
        };

        if (branchId) fetchBranchProducts();
        return () => {
            cancelled = true;
        };
    }, [branchId]);

    React.useEffect(() => {
        if (step !== 2 || !selectedProduct?.id || String(selectedProduct.id).startsWith('temp-')) {
            setBranchSystemStock(null);
            setBranchUnitCost(null);
            return;
        }
        let cancelled = false;
        (async () => {
            const { data, error } = await supabase
                .from('branch_stocks')
                .select('quantity, unit_cost')
                .eq('branch_id', branchId)
                .eq('product_id', selectedProduct.id)
                .maybeSingle();
            if (!cancelled) {
                if (error) {
                    setBranchSystemStock(null);
                    setBranchUnitCost(null);
                    return;
                }
                setBranchSystemStock(data?.quantity != null && data.quantity !== '' ? Number(data.quantity) : null);
                const uc = data?.unit_cost;
                setBranchUnitCost(uc != null && uc !== '' && Number.isFinite(Number(uc)) ? Number(uc) : null);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [step, selectedProduct?.id, branchId]);

    React.useEffect(() => {
        const fetchInitialData = async () => {
            const { data: pData } = await supabase.from('counting_periods').select('*').eq('is_active', true).single();
            if (pData) setActivePeriod(pData);

            const { data: catData } = await supabase.from('categories').select('*').order('sort_order').order('name');
            if (catData && catData.length > 0) {
                setExistingCategories(catData.map(c => c.name));
            } else {
                const { data: cData } = await supabase.from('products').select('category').eq('is_active', true);
                if (cData) setExistingCategories([...new Set(cData.map(c => c.category).filter(Boolean))]);
            }
        };
        fetchInitialData();
    }, []);

    // Gelişmiş filtre açılınca ürünleri çek
    useEffect(() => {
        if (!showAdvancedFilter) return;
        setFilterStep(1);
        setSelectedFilterCategory('');
        setFilterCategorySearch('');
        setFilterProductSearch('');
        const fetchProducts = async () => {
            if (!isBranchProductsReady || !branchProductIds.length) {
                setAllProductsForFilter([]);
                return;
            }
            const { data } = await supabase
                .from('products')
                .select('id, product_name, stok_kodu, category, unit, barcode, current_stock, purchase_price')
                .eq('is_active', true)
                .in('id', branchProductIds)
                .not('product_name', 'is', null);
            setAllProductsForFilter(data || []);
        };
        fetchProducts();
    }, [showAdvancedFilter, isBranchProductsReady, branchProductIds]);

    // Fallback Product Name Modal State
    const [showNewProductModal, setShowNewProductModal] = useState(false);
    const [unknownBarcode, setUnknownBarcode] = useState('');
    const [newProductName, setNewProductName] = useState('');
    const [newCategory, setNewCategory] = useState('');
    const [newUnit, setNewUnit] = useState('Adet');
    const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
    const [newProductBarcodeScannerOpen, setNewProductBarcodeScannerOpen] = useState(false);

    const normalizeText = (value) => {
        if (!value) return '';
        let text = String(value).toLowerCase('tr-TR');
        text = text
            .replace(/İ/g, 'i')
            .replace(/I/g, 'ı')
            .replace(/[^a-zA-Z0-9ığüşöçİĞÜŞÖÇ\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return text;
    };

    const goHome = () => {
        setStep(1);
        setSelectedProduct(null);
        setInputValue('');
        setSearchTerm('');
        setSearchResults([]);
        setShowAdvancedFilter(false);
        setShowNewProductModal(false);
        setNumpadOpen(false);
        setShowEditProductModal(false);
        setCameraError(false);
        setReplaceInputOnNextKey(false);
        setIsEditCountMode(false);
        setIsScannerOpen(true);
    };

    const goBackOneStep = () => {
        if (showAdvancedFilter && filterStep === 2) {
            setFilterStep(1);
            setFilterProductSearch('');
            return;
        }
        if (showAdvancedFilter && filterStep === 1) {
            setShowAdvancedFilter(false);
            return;
        }
        if (showNewProductModal) {
            setShowNewProductModal(false);
            return;
        }
        if (step === 2 || step === 3) {
            setStep(1);
            setSelectedProduct(null);
            setInputValue('');
            setReplaceInputOnNextKey(false);
            setIsEditCountMode(false);
            return;
        }
    };

    // Search by product name / stok kodu / barkod (kelime kelime)
    const handleSearch = async () => {
        const raw = (searchTerm || '').trim();
        if (!raw) {
            toast.error('Lütfen bir ürün ismi, stok kodu veya barkod yazın.', { style: { background: '#151828', color: '#fff' } });
            return;
        }

        if (!isBranchProductsReady) {
            toast.error('Şube ürünleri yükleniyor, lütfen tekrar deneyin.', { style: { background: '#151828', color: '#fff' } });
            return;
        }
        if (!branchProductIds.length) {
            toast.error('Bu şube için ürün tanımı bulunamadı. Admin panelden şube stok listesini girin.', { style: { background: '#151828', color: '#fff' } });
            setSearchResults([]);
            return;
        }

        const normalizedQuery = normalizeText(raw);
        const words = normalizedQuery.split(' ').filter(Boolean);
        if (words.length === 0) {
            toast.error('Arama için en az bir harf yazın.', { style: { background: '#151828', color: '#fff' } });
            return;
        }

        const firstWord = words[0];

        const { data, error } = await supabase
            .from('products')
            .select('id, product_name, stok_kodu, barcode, category, unit, current_stock, purchase_price, is_active')
            .eq('is_active', true)
            .in('id', branchProductIds)
            .or(`product_name.ilike.%${firstWord}%,stok_kodu.ilike.%${firstWord}%,barcode.ilike.%${firstWord}%`)
            .limit(100);

        if (error) {
            toast.error('Arama sırasında hata oluştu.', { style: { background: '#EF4444', color: '#fff' } });
            setSearchResults([]);
            return;
        }

        const filtered = (data || []).filter(p => {
            const haystack = [
                normalizeText(p.product_name),
                normalizeText(p.stok_kodu),
                normalizeText(p.barcode)
            ].join(' ');
            return words.every(w => haystack.includes(w));
        });

        if (filtered.length > 0) {
            if (filtered.length === 1) {
                setSelectedProduct(filtered[0]);
                setNumpadOpen(false);
                setIsEditCountMode(false);
                setStep(2);
                setSearchResults([]);
            } else {
                setSearchResults(filtered);
            }
        } else {
            toast.error('Sistemde böyle bir ürün bulunamadı!', { style: { background: '#EF4444', color: '#fff' } });
            setSearchResults([]);
        }
    };

    // Barcode scanning & External API Fetch

    // Ses ve Titreşim Efekti
    const playBeep = () => {
        try {
            if ('vibrate' in navigator) navigator.vibrate([100, 50, 100]); // Cihaz titrer
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
                const ctx = new AudioContext();
                const osc = ctx.createOscillator();
                osc.type = 'sine';
                osc.frequency.value = 800; // Tiz bir 'bip' sesi
                osc.connect(ctx.destination);
                osc.start();
                osc.stop(ctx.currentTime + 0.1);
            }
        } catch (e) {
            console.log("Ses çalınamadı", e);
        }
    };

    const handleBarcodeScan = async (scannedData) => {
        // Yeni v2 sürümünde result bir obje veya array dönebilir
        let text = null;
        if (typeof scannedData === 'string') text = scannedData; // v1 fallback
        else if (Array.isArray(scannedData) && scannedData.length > 0) text = scannedData[0].rawValue; // v2 array
        else if (scannedData && scannedData.text) text = scannedData.text; // other structures
        else if (scannedData && scannedData.rawValue) text = scannedData.rawValue;

        if (text) {
            playBeep(); // ÖTTÜR VE TİTRET
            setIsScannerOpen(false); // Kamerayı kapat
            toast.loading(`Barkod sorgulanıyor: ${text}...`, { id: 'scan-toast', style: { background: '#151828', color: '#fff' } });

            if (!isBranchProductsReady) {
                toast.error('Şube ürünleri yükleniyor, lütfen tekrar deneyin.', { id: 'scan-toast', style: { background: '#EF4444', color: '#fff' } });
                return;
            }
            if (!branchProductIds.length) {
                toast.error('Bu şubede ürün tanımı yok. Admin panelden şube stoklarını girin.', { id: 'scan-toast', style: { background: '#EF4444', color: '#fff' } });
                return;
            }

            // 1. Önce Kendi Veritabanımızda Ara (Supabase)
            const { data: localData, error: localError } = await supabase
                .from('products')
                .select('*')
                .eq('barcode', text)
                .eq('is_active', true)
                .in('id', branchProductIds)
                .maybeSingle();

            if (localData) {
                toast.success(`Ürün Bulundu: ${localData.product_name}`, { id: 'scan-toast', style: { background: '#10B981', color: '#fff' } });
                setSelectedProduct(localData);
                setNumpadOpen(false);
                setIsEditCountMode(false);
                setStep(2);
            } else {
                // Dış barkod API'sini iptal ettik: personel kendi yazıyor
                toast.dismiss('scan-toast');
                toast.error('Bu barkod sistemde yok. Ürün adını yazıp kaydedin.', { style: { background: '#EF4444', color: '#fff' } });
                setUnknownBarcode(text);
                setShowNewProductModal(true);
            }
        }
    };

    // Personel Kendi Girdiği İsmi Kaydediyor
    const handleSaveNewProductString = () => {
        if (!newProductName) {
            toast.error("Lütfen bir ürün adı yazın!");
            return;
        }
        setShowNewProductModal(false);

        const tempId = unknownBarcode ? `temp-${unknownBarcode}` : `temp-manual-${Date.now()}`;
        setSelectedProduct({
            id: tempId,
            barcode: unknownBarcode || null,
            product_name: newProductName,
            category: newCategory,
            unit: newUnit,
            current_stock: 0,
            purchase_price: 0
        });
        setNumpadOpen(false);
        setIsEditCountMode(false);
        setStep(2);
        setNewProductName('');
        setNewCategory('');
        setNewUnit('Adet');
        setUnknownBarcode('');
        setNewProductBarcodeScannerOpen(false);
        toast.success("Ürün isimle hafızaya alındı!", { style: { background: '#10B981', color: '#fff' } });
    };

    const handleNewProductBarcodeScan = async (scannedData) => {
        let text = null;
        if (typeof scannedData === 'string') text = scannedData;
        else if (Array.isArray(scannedData) && scannedData.length > 0) text = scannedData[0].rawValue;
        else if (scannedData && scannedData.text) text = scannedData.text;
        else if (scannedData && scannedData.rawValue) text = scannedData.rawValue;

        const barcode = (text || '').trim();
        if (!barcode) return;

        playBeep();
        setUnknownBarcode(barcode);
        setNewProductBarcodeScannerOpen(false);
        toast.success('Barkod okundu.', { style: { background: '#10B981', color: '#fff' } });
    };

    // Custom key logic
    const handleKeypadPress = (val) => {
        if (replaceInputOnNextKey) {
            if (val === ',') {
                setInputValue('0.'); // Virgül tuşu -> ondalık ayracı
            } else if (val === 'SİL') {
                setInputValue('');
            } else {
                setInputValue(String(val));
            }
            setReplaceInputOnNextKey(false);
            return;
        }

        if (val === ',') {
            if (!String(inputValue).includes('.')) setInputValue(prev => String(prev) + '.');
        } else if (val === 'SİL') {
            setInputValue(prev => String(prev).slice(0, -1));
        } else {
            setInputValue(prev => String(prev) + val);
        }
    };

    const handleAutoSave = useCallback(async (stock) => {
        if (!selectedProduct) return;
        setIsSaving(true);

        let targetProductId = selectedProduct.id;

        // Eğer ürün geçici bir api ürünü ise (yani id'si temp- ile başlıyorsa) önce Supabase'e ürün olarak kaydedelim:
        if (typeof targetProductId === 'string' && targetProductId.startsWith('temp-')) {
            const { data: newProd, error: newProdErr } = await supabase.from('products').insert([{
                barcode: selectedProduct.barcode,
                product_name: selectedProduct.product_name,
                category: selectedProduct.category || null,
                unit: selectedProduct.unit || 'Adet',
                current_stock: 0,
                purchase_price: 0
            }]).select().single();

            if (newProdErr) {
                toast.error('Yeni ürün veritabanına eklenemedi.', { style: { background: '#EF4444', color: '#fff' } });
                setIsSaving(false);
                return;
            }
            targetProductId = newProd.id;
            setBranchProductIds((prev) => prev.includes(newProd.id) ? prev : [...prev, newProd.id]);
        }

        const { data: existingBsRow } = await supabase
            .from('branch_stocks')
            .select('unit_cost')
            .eq('branch_id', branchId)
            .eq('product_id', targetProductId)
            .maybeSingle();
        await supabase
            .from('branch_stocks')
            .upsert([{
                branch_id: branchId,
                product_id: targetProductId,
                quantity: 0,
                unit_cost: existingBsRow?.unit_cost ?? null,
            }], { onConflict: 'branch_id,product_id' });

        const entered = Number(String(stock).replace(',', '.'));
        const enteredValue = Number.isFinite(entered) ? entered : 0;

        let nextCountedStock = enteredValue;
        if (!isEditCountMode) {
            let existingQuery = supabase
                .from('counts')
                .select('counted_stock')
                .eq('branch_id', branchId)
                .eq('product_id', targetProductId);

            existingQuery = activePeriod
                ? existingQuery.eq('period_id', activePeriod.id)
                : existingQuery.is('period_id', null);

            const { data: existingCount } = await existingQuery.maybeSingle();
            const existingValue = Number(existingCount?.counted_stock || 0);
            nextCountedStock = existingValue + enteredValue;
        }

        const countData = {
            branch_id: branchId,
            product_id: targetProductId,
            period_id: activePeriod ? activePeriod.id : null,
            counted_stock: nextCountedStock,
            status: 'draft',
            person_name: (personName || '').trim() || null,
        };

        const { error } = await supabase
            .from('counts')
            .upsert([countData], { onConflict: 'branch_id, product_id, period_id' });

        setIsSaving(false);

        if (error) {
            toast.error('Kayıt başarısız! İnternetinizi kontrol edin.', { style: { background: '#EF4444', color: '#fff' } });
        } else {
            toast.success(isEditCountMode ? 'Sayım değeri güncellendi.' : 'Stok Sisteme işlendi (mevcut değerin üstüne eklendi).', { style: { background: '#10B981', color: '#fff' } });
        }
    }, [selectedProduct, branchId, activePeriod, personName, isEditCountMode]);

    const handleSaveAndNext = () => {
        if (inputValue) {
            handleAutoSave(inputValue);
        } else {
            toast.error('Lütfen önce bir rakam tuşlayın.');
            return;
        }
        setStep(1);
        setSelectedProduct(null);
        setInputValue('');
        setSearchTerm('');
        setSearchResults([]);
        setReplaceInputOnNextKey(false);
        setIsEditCountMode(false);
        setNumpadOpen(false);
    };

    const fetchMyCounts = async () => {
        setIsFetchingCounts(true);
        let query = supabase
            .from('counts')
            .select(`
                id,
                counted_stock,
                timestamp,
                first_counted_at,
                last_counted_at,
                products ( id, product_name, unit, barcode, category, current_stock, purchase_price )
            `)
            .eq('branch_id', branchId)
            .order('timestamp', { ascending: false });

        if (activePeriod) {
            query = query.eq('period_id', activePeriod.id);
        }

        const { data, error } = await query;
        if (data) {
            setMyCounts(data);
        } else if (error) {
            toast.error("Geçmiş sayımlar alınamadı.");
        }
        setIsFetchingCounts(false);
        setStep(3);
    };

    const handleEditPastCount = (countObj) => {
        setSelectedProduct(countObj.products);
        setInputValue(String(countObj.counted_stock));
        // İlk numpad tuşuna basılınca mevcut değerin üzerine eklemek yerine yerine yazalım.
        setReplaceInputOnNextKey(true);
        setIsEditCountMode(true);
        setNumpadOpen(false);
        setStep(2);
    };

    const openEditSelectedProduct = () => {
        if (!selectedProduct) return;
        if (typeof selectedProduct.id === 'string' && selectedProduct.id.startsWith('temp-')) {
            toast.error('Bu ürün henüz sisteme kaydedilmedi. Önce sayımı kaydedin veya admin panelden ürün kartı açın.', { style: { background: '#151828', color: '#fff' } });
            return;
        }
        setEditBarcode(selectedProduct.barcode || '');
        setEditPurchasePrice(
            selectedProduct.purchase_price != null && selectedProduct.purchase_price !== ''
                ? String(selectedProduct.purchase_price)
                : ''
        );
        setEditBarcodeScannerOpen(false);
        setShowEditProductModal(true);
    };

    const handleEditBarcodeScan = async (scannedData) => {
        let text = null;
        if (typeof scannedData === 'string') text = scannedData;
        else if (Array.isArray(scannedData) && scannedData.length > 0) text = scannedData[0].rawValue;
        else if (scannedData && scannedData.text) text = scannedData.text;
        else if (scannedData && scannedData.rawValue) text = scannedData.rawValue;

        const barcode = (text || '').trim();
        if (!barcode) return;

        playBeep();
        setEditBarcode(barcode);
        setEditBarcodeScannerOpen(false);
        toast.success('Barkod okundu.', { style: { background: '#10B981', color: '#fff' } });
    };

    const handleUpdateSelectedProduct = async () => {
        if (!selectedProduct) return;
        if (typeof selectedProduct.id === 'string' && selectedProduct.id.startsWith('temp-')) return;

        const barcode = (editBarcode || '').trim();
        const priceStr = (editPurchasePrice || '').trim();
        const cleaned = priceStr ? priceStr.replace(/\./g, '').replace(',', '.') : '';
        const priceNum = cleaned ? Number(cleaned) : null;

        if (priceStr && !Number.isFinite(priceNum)) {
            toast.error('Maliyet sayı olmalı. Örn: 149.17 veya 149,17', { style: { background: '#151828', color: '#fff' } });
            return;
        }

        setIsUpdatingProduct(true);
        try {
            const payload = {
                ...(barcode ? { barcode } : { barcode: null }),
                ...(priceNum != null ? { purchase_price: priceNum } : {}),
            };

            const { error } = await supabase
                .from('products')
                .update(payload)
                .eq('id', selectedProduct.id);

            if (error) {
                toast.error('Ürün güncellenemedi: ' + error.message, { style: { background: '#151828', color: '#fff' } });
                return;
            }

            setSelectedProduct(prev => prev ? ({
                ...prev,
                barcode: barcode || null,
                ...(priceNum != null ? { purchase_price: priceNum } : {}),
            }) : prev);

            toast.success('Ürün bilgileri güncellendi.', { style: { background: '#10B981', color: '#fff' } });
            setShowEditProductModal(false);
        } catch (e) {
            toast.error('Ürün güncellenirken hata oluştu.', { style: { background: '#151828', color: '#fff' } });
        } finally {
            setIsUpdatingProduct(false);
        }
    };

    return (
        <div className="min-h-screen bg-izbel-dark flex flex-col font-sans relative pb-80 md:pb-0 text-white selection:bg-blue-900 selection:text-white">

            {/* Background Glow */}
            <div className="fixed top-[-20%] left-[-20%] w-[50%] h-[50%] bg-blue-600 rounded-full mix-blend-screen filter blur-[150px] opacity-10 pointer-events-none z-0"></div>

            <Toaster position="top-center" reverseOrder={false} />

            {/* App Header */}
            <div className="bg-izbel-card/80 backdrop-blur-xl border-b border-white/5 p-4 flex justify-between items-center sticky top-0 z-50 w-full">
                <div className="flex flex-col items-start gap-1">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-800 flex items-center justify-center shadow-glow">
                            <span className="font-black text-white text-sm">İ</span>
                        </div>
                        <span className="text-xl font-black tracking-tighter uppercase whitespace-nowrap">STOK GİRİŞİ</span>
                    </div>
                    {activePeriod && <span className="text-[10px] font-bold text-green-400 uppercase tracking-widest bg-green-500/10 px-2 py-0.5 rounded-md ml-11">{activePeriod.period_name} Aktif</span>}
                    {personName && (
                        <span className="text-[10px] font-bold text-blue-300 uppercase tracking-widest bg-blue-500/10 px-2 py-0.5 rounded-md ml-11">
                            Personel: {personName}
                        </span>
                    )}
                    {branchInfo?.branchName && (
                        <span className="text-[10px] font-bold text-amber-300 uppercase tracking-widest bg-amber-500/10 px-2 py-0.5 rounded-md ml-11">
                            Şube: {branchInfo.branchName}{branchInfo?.vkn ? ` · VKN: ${branchInfo.vkn}` : ''}
                        </span>
                    )}
                </div>
                <button onClick={onLogout} className="text-gray-400 hover:text-white p-2 rounded-xl bg-white/5 border border-white/5 transition-all active:scale-95">
                    <LogOut size={18} />
                </button>
            </div>

            <div className={`flex-1 p-3 md:p-4 flex flex-col max-w-lg mx-auto w-full relative z-10 ${step === 2 && numpadOpen ? 'pb-[320px] md:pb-[380px]' : ''}`}>

                {!activePeriod && (
                    <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-2xl mb-6 text-center text-sm font-bold uppercase tracking-widest animate-pulse">
                        Admin tarafından başlatılmış bir sayım dönemi bulunmuyor. Kayıtlar dönemsiz işlenebilir veya bekleyin.
                    </div>
                )}

                {/* STEP 1: Scan or Search */}
                {step === 1 && (
                    <div className="flex flex-col space-y-8 mt-4 animate-fade-in">

                        <div className="bg-izbel-card p-6 rounded-[2rem] shadow-2xl border border-white/5 relative overflow-hidden group">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-[40px] pointer-events-none"></div>

                            {!isScannerOpen ? (
                                <div
                                    className="flex flex-col items-center justify-center p-6 bg-izbel-dark/50 rounded-3xl border border-white/5 cursor-pointer hover:border-blue-500/50 hover:bg-izbel-dark transition-all"
                                    onClick={() => { setCameraError(false); setIsScannerOpen(true); setScannerRetryCount(0); }}
                                >
                                    <div className="w-16 h-16 bg-blue-600/20 text-blue-400 rounded-full flex items-center justify-center mb-4">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"></path><path d="M17 3h2a2 2 0 0 1 2 2v2"></path><path d="M21 17v2a2 2 0 0 1-2 2h-2"></path><path d="M7 21H5a2 2 0 0 1-2-2v-2"></path><rect x="7" y="7" width="10" height="10" rx="1"></rect></svg>
                                    </div>
                                    <h2 className="text-lg font-black text-white tracking-widest uppercase mb-1">Kamerayı Aç</h2>
                                    <p className="text-xs text-gray-500 font-bold tracking-widest uppercase">BARKOD OKUTMAK İÇİN DOKUN</p>
                                </div>
                            ) : (
                                <>
                                    {(typeof window !== 'undefined' && !window.isSecureContext) || cameraError ? (
                                        <div className="mb-4 p-4 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-100">
                                            <p className="text-sm font-bold uppercase tracking-widest mb-2">Kamera siyah / açılmıyor</p>
                                            <p className="text-xs text-amber-200/90 mb-2">Mobilde tarayıcılar kamera için <strong>HTTPS</strong> ister. HTTP adresinde kamera çalışmaz.</p>
                                            <p className="text-xs text-amber-100 font-medium mb-2">Çözüm: Bilgisayarda <a href="https://ngrok.com" target="_blank" rel="noopener noreferrer" className="underline">ngrok</a> kurun, terminalde <code className="bg-black/30 px-1 rounded">ngrok http 5173</code> yazın. Çıkan <strong>https://...</strong> adresini telefondan açın.</p>
                                            <p className="text-[11px] text-amber-300/80 border-t border-amber-500/30 pt-2 mt-2">SSL protocol error alıyorsanız: Yerel ağda <strong>http://</strong> kullanın (https değil). Kamera için sadece ngrok’un verdiği https adresini kullanın.</p>
                                        </div>
                                    ) : null}
                                    <div className="flex justify-between items-center mb-4 relative z-10">
                                        <h2 className="text-sm font-bold text-gray-400 tracking-widest uppercase flex items-center gap-2">
                                            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
                                            Kamera Aktif
                                        </h2>
                                        <button
                                            onClick={() => { setIsScannerOpen(false); setCameraError(false); setScannerRetryCount(0); }}
                                            className="text-gray-500 hover:text-red-400 bg-white/5 px-3 py-1 rounded-lg text-xs font-bold transition-all"
                                        >
                                            İPTAL
                                        </button>
                                    </div>
                                    <div className="rounded-[1.5rem] overflow-hidden border border-blue-500/30 shadow-[0_0_30px_rgba(37,99,235,0.15)] bg-black flex justify-center items-center aspect-square transition-all">
                                        <Scanner
                                            formats={['qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf']}
                                            styles={{ container: { width: '100%', height: '100%' } }}
                                            onScan={(result) => handleBarcodeScan(result)}
                                            onResult={(text) => handleBarcodeScan(text)} // Geriye dönük destek
                                            onError={(error) => {
                                                if (shouldIgnoreScannerPlayInterruptedError(error)) return;
                                                console.warn('Kamera hatası:', error?.message || error);
                                                if (isCameraStreamTimeoutError(error) && scannerRetryCount < 2) {
                                                    setCameraError(false);
                                                    toast.error('Kamera akışı zaman aşımına uğradı. Yeniden deneniyor...', {
                                                        style: { background: '#151828', color: '#fff' },
                                                    });
                                                    setScannerRetryCount(prev => prev + 1);
                                                    setIsScannerOpen(false);
                                                    setTimeout(() => {
                                                        setIsScannerOpen(true);
                                                    }, 700);
                                                    return;
                                                }
                                                setCameraError(true);
                                                if (isCameraStreamTimeoutError(error)) {
                                                    toast.error('Kamera akışı zaman aşımına uğradı. Lütfen izinleri kontrol edin, uygulamayı kapat-açın veya tekrar deneyin.', { style: { background: '#151828', color: '#fff' } });
                                                } else if (typeof window !== 'undefined' && !window.isSecureContext) {
                                                    toast.error('Kamera için HTTPS gerekli. Yukarıdaki ngrok talimatını uygulayın.', { duration: 8000, style: { background: '#151828', color: '#fff' } });
                                                } else {
                                                    toast.error('Kamera açılamadı: ' + (error?.message || 'Bilinmeyen hata'), { style: { background: '#151828', color: '#fff' } });
                                                }
                                            }}
                                        />
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="flex items-center justify-center space-x-4 opacity-50">
                            <div className="h-px bg-gradient-to-r from-transparent to-gray-500 flex-1"></div>
                            <span className="text-gray-400 font-bold uppercase tracking-[0.3em] text-[10px]">VEYA</span>
                            <div className="h-px bg-gradient-to-l from-transparent to-gray-500 flex-1"></div>
                        </div>

                        <div className="bg-izbel-card p-6 rounded-[2rem] shadow-2xl border border-white/5 relative overflow-hidden">
                            <h2 className="text-sm font-bold text-gray-400 mb-4 tracking-widest uppercase">Manuel Arama</h2>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    placeholder="Ürün adı, stok kodu veya barkod parçası yazın"
                                    className="w-full text-lg p-5 bg-izbel-dark border border-white/10 rounded-2xl focus:border-blue-500 focus:bg-izbel-dark focus:ring-4 focus:ring-blue-500/20 outline-none transition-all text-white placeholder-gray-600 font-medium"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                                />
                                <button
                                    onClick={handleSearch}
                                    className="bg-blue-600 hover:bg-blue-500 text-white font-black px-6 rounded-2xl shadow-[0_0_20px_rgba(37,99,235,0.3)] border border-blue-500 active:scale-95 transition-all text-xl"
                                >
                                    BUL
                                </button>
                            </div>

                            <p className="mt-3 text-[11px] text-gray-500 font-medium">
                                <span className="font-bold text-gray-400">İpucu:</span> Birden fazla kelimeyi boşlukla yazabilirsiniz.
                                Örn: <span className="font-mono bg-white/5 px-1.5 py-0.5 rounded">tost karisik</span> → <span className="font-mono bg-white/5 px-1.5 py-0.5 rounded">KARIŞIK TOST</span>. Stok kodu veya barkodun bir parçasını da arayabilirsiniz.
                            </p>

                            {searchResults.length > 0 && (
                                <div className="mt-4 flex flex-col gap-2 max-h-60 overflow-y-auto pr-2">
                                    <h3 className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-1 mt-2 pl-1">{searchResults.length} SONUÇ BULUNDU</h3>
                                    {searchResults.map((product) => (
                                        <button
                                            key={product.id}
                                            onClick={() => {
                                                setSelectedProduct(product);
                                                setNumpadOpen(false);
                                                setIsEditCountMode(false);
                                                setStep(2);
                                                setSearchResults([]);
                                            }}
                                            className="w-full text-left bg-izbel-dark/50 hover:bg-blue-600/20 border border-white/5 hover:border-blue-500/50 p-4 rounded-xl transition-all active:scale-95 flex flex-col gap-2"
                                        >
                                            <span className="font-bold text-white text-lg leading-tight">{product.product_name}</span>
                                            <div className="flex justify-between items-center w-full">
                                                <span className="text-xs text-gray-500 font-mono inline-block bg-white/5 px-2 py-1 rounded-lg border border-white/5">
                                                    {product.barcode || 'Barkodsuz'}
                                                </span>
                                                {product.category && (
                                                    <span className="text-xs text-blue-400 font-bold bg-blue-500/10 px-2 py-1 rounded-lg">
                                                        {product.category}
                                                    </span>
                                                )}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        <button
                            onClick={() => setShowAdvancedFilter(true)}
                            className="bg-blue-600/20 hover:bg-blue-600/30 border-2 border-blue-500/50 text-blue-300 hover:text-white p-6 rounded-[2rem] font-bold tracking-widest uppercase transition-all flex flex-col items-center justify-center gap-2 active:scale-95"
                        >
                            <ChevronRight size={24} className="mb-1 opacity-80" />
                            Ürün seç (Kategori → Liste)
                        </button>

                        <button
                            onClick={() => { setUnknownBarcode(''); setNewProductName(''); setNewCategory(''); setNewProductBarcodeScannerOpen(false); setShowNewProductModal(true); }}
                            className="bg-transparent border-2 border-dashed border-white/10 hover:border-white/20 text-gray-400 hover:text-white p-6 rounded-[2rem] font-bold tracking-widest uppercase transition-all flex flex-col items-center justify-center gap-2 active:scale-95"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500 mb-1"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
                            Bütünüyle Yeni (Barkodsuz) Ürün Ekle
                        </button>

                        <button
                            onClick={fetchMyCounts}
                            className="bg-izbel-dark border border-white/5 hover:bg-white/5 hover:border-white/10 text-white p-6 rounded-[2rem] font-bold tracking-widest uppercase transition-all flex items-center justify-center gap-3 active:scale-95 shadow-lg"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                            GEÇMİŞ SAYIMLARIMI GÖR VE DÜZENLE
                        </button>
                    </div>
                )}

                {/* MODAL: Gelişmiş Filtreleme — Kategori → Ürün (Stok Kodu - Ürün İsmi) → Adet */}
                {showAdvancedFilter && (() => {
                    const NO_GROUP = '\u200B(Grubu yok)'; // zero-width then label
                    const catKey = (c) => (c === null || c === '') ? NO_GROUP : c;
                    const categoriesList = [...new Set(allProductsForFilter.map(p => catKey(p.category)))].sort((a, b) => a.localeCompare(b, 'tr'));
                    const categoryFiltered = filterCategorySearch.trim()
                        ? categoriesList.filter(c => c.toLowerCase().includes(filterCategorySearch.trim().toLowerCase()))
                        : categoriesList;
                    const selectedCatRaw = selectedFilterCategory === NO_GROUP ? '' : selectedFilterCategory;
                    const productsInCategory = allProductsForFilter
                        .filter(p => (p.category || '') === selectedCatRaw)
                        .sort((a, b) => (a.product_name || '').localeCompare(b.product_name || '', 'tr'));
                    const productWords = filterProductSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
                    const productFiltered = productWords.length
                        ? productsInCategory.filter(p => {
                            const name = (p.product_name || '').toLowerCase();
                            return productWords.every(w => name.includes(w));
                        })
                        : productsInCategory;
                    return (
                        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-start justify-center p-4 pt-24 overflow-y-auto">
                            <div className="bg-izbel-card w-full max-w-md max-h-[90vh] flex flex-col rounded-[2rem] border border-blue-500/50 shadow-glow overflow-hidden">
                                <div className="p-4 border-b border-white/10 flex justify-between items-center shrink-0">
                                    <div className="flex flex-col">
                                        <h2 className="text-lg font-black text-white uppercase tracking-widest">
                                            {filterStep === 1 ? 'Grubu (Kategori) seçin' : 'Ürün seçin'}
                                        </h2>
                                        <p className="text-[10px] text-gray-500 mt-1">Pasif ürünler burada da gizlidir.</p>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={goBackOneStep}
                                            className="text-[10px] font-bold text-gray-400 hover:text-white uppercase tracking-widest py-1.5 px-2 rounded-lg bg-white/5 border border-white/10"
                                        >
                                            Geri
                                        </button>
                                        <button
                                            type="button"
                                            onClick={goHome}
                                            className="text-[10px] font-bold text-gray-200 hover:text-white uppercase tracking-widest py-1.5 px-2 rounded-lg bg-red-600/60 hover:bg-red-600 border border-red-500/70"
                                        >
                                            Kapat
                                        </button>
                                    </div>
                                </div>
                                {filterStep === 1 ? (
                                    <>
                                        <input
                                            type="text"
                                            placeholder="Kategori ara..."
                                            value={filterCategorySearch}
                                            onChange={e => setFilterCategorySearch(e.target.value)}
                                            className="mx-4 mt-3 p-3 bg-izbel-dark border border-white/10 rounded-xl text-white placeholder-gray-500 outline-none focus:border-blue-500 font-medium"
                                        />
                                        <div className="flex-1 overflow-y-auto p-4 space-y-1 min-h-0">
                                            {categoryFiltered.length === 0 ? (
                                                <p className="text-gray-500 text-sm font-bold uppercase tracking-widest">Kategori bulunamadı</p>
                                            ) : (
                                                categoryFiltered.map(cat => (
                                                    <button
                                                        key={cat}
                                                        onClick={() => { setSelectedFilterCategory(cat); setFilterStep(2); setFilterProductSearch(''); }}
                                                        className="w-full text-left py-4 px-4 rounded-xl bg-izbel-dark/50 hover:bg-blue-600/20 border border-white/5 hover:border-blue-500/50 font-bold text-white transition-all active:scale-[0.99] flex items-center justify-between"
                                                    >
                                                        <span className="uppercase tracking-wide">{cat}</span>
                                                        <ChevronRight size={18} className="text-blue-400 opacity-70" />
                                                    </button>
                                                )))}
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => { setFilterStep(1); setSelectedFilterCategory(''); setFilterProductSearch(''); }}
                                            className="mx-4 mt-3 text-left text-sm font-bold text-blue-400 hover:text-blue-300 uppercase tracking-widest"
                                        >
                                            ← {selectedFilterCategory === NO_GROUP ? '(Grubu yok)' : selectedFilterCategory}
                                        </button>
                                        <input
                                            type="text"
                                            placeholder="Ürün adında ara (kelime kelime eşleşir)"
                                            value={filterProductSearch}
                                            onChange={e => setFilterProductSearch(e.target.value)}
                                            className="mx-4 mt-2 p-3 bg-izbel-dark border border-white/10 rounded-xl text-white placeholder-gray-500 outline-none focus:border-blue-500 font-medium"
                                        />
                                        <div className="flex-1 overflow-y-auto p-4 space-y-1 min-h-0">
                                            {productFiltered.length === 0 ? (
                                                <p className="text-gray-500 text-sm font-bold uppercase tracking-widest">Ürün bulunamadı</p>
                                            ) : null}
                                            {productFiltered.length > 0 && productFiltered.map(p => (
                                                    <button
                                                        key={p.id}
                                                        onClick={() => {
                                                            setSelectedProduct(p);
                                                            setShowAdvancedFilter(false);
                                                            setFilterStep(1);
                                                            setSelectedFilterCategory('');
                                                            setNumpadOpen(false);
                                                            setIsEditCountMode(false);
                                                            setStep(2);
                                                        }}
                                                        className="w-full text-left py-3 px-4 rounded-xl bg-izbel-dark/50 hover:bg-blue-600/20 border border-white/5 hover:border-blue-500/50 transition-all active:scale-[0.99]"
                                                    >
                                                        <span className="font-mono text-blue-300 text-sm">{p.stok_kodu || '—'}</span>
                                                        <span className="block font-bold text-white truncate">{p.product_name}</span>
                                                    </button>
                                                ))}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    );
                })()}

                {/* MODAL: Personel Bilinmeyen Ürünün Adını Kendi Giriyor */}
                {showNewProductModal && (
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-start justify-center p-4 pt-24 overflow-y-auto">
                        <div className="bg-izbel-card w-full max-w-sm rounded-[2rem] border border-blue-500 p-6 shadow-glow max-h-[90vh] overflow-y-auto">
                            <div className="flex items-center justify-between mb-2 border-b border-white/10 pb-3">
                                <h2 className="text-xl font-black text-white uppercase">YENİ ÜRÜN TESPİT EDİLDİ</h2>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={goBackOneStep}
                                        className="text-[10px] font-bold text-gray-400 hover:text-white uppercase tracking-widest py-1 px-2 rounded-lg bg-white/5 border border-white/10"
                                    >
                                        Geri
                                    </button>
                                    <button
                                        type="button"
                                        onClick={goHome}
                                        className="text-[10px] font-bold text-gray-200 hover:text-white uppercase tracking-widest py-1 px-2 rounded-lg bg-red-600/60 hover:bg-red-600 border border-red-500/70"
                                    >
                                        Kapat
                                    </button>
                                </div>
                            </div>
                            <p className="text-sm text-gray-400 font-bold tracking-widest mb-4">
                                {unknownBarcode ? (
                                    <>
                                        <span className="font-mono text-blue-300">{unknownBarcode}</span>
                                        <br />
                                        Bu barkod hiçbir sistemde bulunamadı. Lütfen ürün ismini yazın, sisteme kaydedilsin.
                                    </>
                                ) : (
                                    <>Barkodlu veya barkodsuz yeni ürün ekleyebilirsiniz.</>
                                )}
                            </p>

                            <div className="mb-4">
                                <label className="text-xs uppercase font-bold tracking-widest text-gray-500 mb-2 block pl-1">Barkod</label>
                                <div className="flex items-center gap-2">
                                    <div className="flex-1 bg-izbel-dark border border-white/10 p-4 rounded-xl font-mono text-sm text-gray-200">
                                        {unknownBarcode || '—'}
                                    </div>
                                    <button
                                        type="button"
                                                onClick={() => { setScannerRetryCount(0); setNewProductBarcodeScannerOpen(true); }}
                                        className="shrink-0 px-4 py-4 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-200 font-black uppercase tracking-widest text-xs active:scale-95 transition"
                                    >
                                        Barkod Oku
                                    </button>
                                </div>
                                <p className="text-[10px] text-gray-500 mt-2">Barkod elle girilmez; “Barkod Oku” ile kameradan okutun. İsterseniz barkodsuz da ekleyebilirsiniz.</p>

                                {newProductBarcodeScannerOpen && (
                                    <div className="mt-3">
                                        {(typeof window !== 'undefined' && !window.isSecureContext) ? (
                                            <div className="mb-3 p-3 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-100">
                                                <p className="text-xs font-bold uppercase tracking-widest mb-1">Kamera için HTTPS gerekli</p>
                                                <p className="text-[11px] text-amber-200/90">Mobilde kamera yalnızca HTTPS üzerinde çalışır. Ngrok ile açtığınız <strong>https://...</strong> adresini kullanın.</p>
                                            </div>
                                        ) : null}
                                        <div className="rounded-2xl overflow-hidden border border-blue-500/30 bg-black aspect-square">
                                            <Scanner
                                                formats={['qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf']}
                                                styles={{ container: { width: '100%', height: '100%' } }}
                                                onScan={(result) => handleNewProductBarcodeScan(result)}
                                                onResult={(text) => handleNewProductBarcodeScan(text)}
                                                onError={(error) => {
                                                    if (shouldIgnoreScannerPlayInterruptedError(error)) return;
                                                    if (isCameraStreamTimeoutError(error) && scannerRetryCount < 2) {
                                                        toast.error('Kamera akışı zaman aşımına uğradı. Yeniden deneniyor...', {
                                                            style: { background: '#151828', color: '#fff' },
                                                        });
                                                        setScannerRetryCount(prev => prev + 1);
                                                        setNewProductBarcodeScannerOpen(false);
                                                        setTimeout(() => {
                                                            setNewProductBarcodeScannerOpen(true);
                                                        }, 700);
                                                        return;
                                                    }
                                                    console.warn('Kamera hatası (yeni ürün barkod):', error?.message || error);
                                                    toast.error('Kamera açılamadı: ' + (error?.message || 'Bilinmeyen hata'), { style: { background: '#151828', color: '#fff' } });
                                                }}
                                            />
                                        </div>
                                        <div className="flex justify-end mt-2">
                                            <button
                                                type="button"
                                                onClick={() => setNewProductBarcodeScannerOpen(false)}
                                                className="text-xs font-bold text-gray-400 hover:text-white uppercase tracking-widest py-2 px-3 rounded-lg bg-white/5 border border-white/5 active:scale-95 transition-all"
                                            >
                                                Kamerayı kapat
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <input
                                autoFocus
                                type="text"
                                placeholder="Örn: Eti Burçak 120gr"
                                value={newProductName}
                                onChange={(e) => setNewProductName(e.target.value)}
                                className="w-full p-4 bg-izbel-dark border border-blue-500/50 rounded-xl text-xl text-white outline-none mb-4 font-bold"
                            />

                            <div className="relative mb-6">
                                <input
                                    type="text"
                                    placeholder="Kategori (Ops: Unlu Mamüller)"
                                    value={newCategory}
                                    onChange={(e) => setNewCategory(e.target.value)}
                                    onFocus={() => setShowCategoryDropdown(true)}
                                    onBlur={() => setTimeout(() => setShowCategoryDropdown(false), 200)}
                                    className="w-full p-4 bg-izbel-dark border border-white/10 rounded-xl text-lg text-white outline-none font-bold"
                                />
                                {showCategoryDropdown && existingCategories.length > 0 && (
                                    <div className="absolute top-full left-0 right-0 mt-2 bg-izbel-dark border border-white/10 rounded-xl shadow-2xl z-50 max-h-40 overflow-y-auto">
                                        {existingCategories.map(cat => (
                                            <div
                                                key={cat}
                                                className="p-3 hover:bg-white/5 cursor-pointer text-white font-medium border-b border-white/5 last:border-none"
                                                onClick={() => {
                                                    setNewCategory(cat);
                                                    setShowCategoryDropdown(false);
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
                                onChange={(e) => setNewUnit(e.target.value)}
                                className="w-full p-4 bg-izbel-dark border border-white/10 rounded-xl text-lg text-white font-bold cursor-pointer appearance-none outline-none mb-6 relative"
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

                            <div className="flex gap-3">
                                <button onClick={() => { setShowNewProductModal(false); setNewProductBarcodeScannerOpen(false); }} className="flex-1 py-4 border border-white/10 rounded-xl font-bold text-gray-400 active:scale-95 transition-transform">İPTAL</button>
                                <button onClick={handleSaveNewProductString} className="flex-2 w-2/3 py-4 bg-blue-600 rounded-xl font-black text-white active:scale-95 transition-transform">ONAYLA</button>
                            </div>
                        </div>
                    </div>
                )}

                {/* STEP 2: Input Number */}
                {step === 2 && selectedProduct && (
                    <div className="flex flex-col w-full mt-2 flex-1 animate-fade-in">
                        <div className="flex justify-between items-center mb-2">
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={goBackOneStep}
                                    className="text-[10px] font-bold text-gray-400 hover:text-white uppercase tracking-widest py-2 px-3 rounded-lg bg-white/5 border border-white/10 active:scale-95 transition-all"
                                >
                                    Geri
                                </button>
                                <button
                                    type="button"
                                    onClick={goHome}
                                    className="text-[10px] font-bold text-gray-200 hover:text-white uppercase tracking-widest py-2 px-3 rounded-lg bg-red-600/60 hover:bg-red-600 border border-red-500/70 active:scale-95 transition-all"
                                >
                                    Kapat
                                </button>
                            </div>
                        </div>
                        <div className="bg-izbel-card p-3 md:p-6 rounded-xl md:rounded-[2rem] shadow-xl border border-white/5 mb-2 md:mb-4 relative overflow-hidden shrink-0">
                            <div className="absolute top-0 right-0 w-full h-0.5 bg-gradient-to-r from-blue-600 to-purple-600"></div>

                            <div className="flex justify-between items-start mb-1 md:mb-2">
                                <div className="text-[10px] md:text-xs font-mono text-gray-500 tracking-wider bg-white/5 inline-block px-2 md:px-3 py-1 rounded-full border border-white/5 border-l-2 border-l-blue-500">
                                    Barkod: {selectedProduct.barcode || 'YOK'}
                                </div>
                                <button
                                    type="button"
                                    onClick={openEditSelectedProduct}
                                    className="text-[10px] md:text-xs font-bold text-blue-300 hover:text-white uppercase tracking-widest py-2 px-3 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 active:scale-95 transition-all"
                                >
                                    Barkod / Maliyet Düzenle
                                </button>
                            </div>

                            <h2 className="text-lg md:text-3xl font-black text-white mb-2 md:mb-4 tracking-tight leading-tight line-clamp-2 md:line-clamp-none">{selectedProduct.product_name}</h2>

                            <div className="flex flex-row items-center gap-2 md:gap-4 bg-izbel-dark p-2 md:p-4 rounded-lg md:rounded-2xl border border-white/5">
                                <div className="flex-1">
                                    <p className="text-gray-500 text-[9px] md:text-[10px] font-bold uppercase tracking-widest mb-1">Beklenen stok (bu şube)</p>
                                    <p className="text-lg md:text-3xl font-mono font-bold text-gray-300">
                                        {(branchSystemStock !== null && !Number.isNaN(branchSystemStock))
                                            ? branchSystemStock
                                            : (selectedProduct.current_stock ?? 0)}
                                        <span className="text-xs md:text-sm font-sans font-bold text-gray-500 ml-1 md:ml-2">{selectedProduct.unit || 'Adet'}</span>
                                    </p>
                                    {branchSystemStock === null && (
                                        <p className="text-[8px] text-amber-500/90 font-bold mt-1 uppercase tracking-wider">Admin şube stoku girmediyse ürün kartı stoku gösterilir</p>
                                    )}
                                </div>
                                <div className="w-px h-8 md:h-12 bg-white/10"></div>
                                <div className="flex-1 text-right">
                                    <p className="text-gray-500 text-[9px] md:text-[10px] font-bold uppercase tracking-widest mb-1">Birim maliyet</p>
                                    <p className="text-sm md:text-xl font-mono font-bold text-gray-400">
                                        {(branchUnitCost != null && !Number.isNaN(branchUnitCost))
                                            ? branchUnitCost
                                            : (selectedProduct.purchase_price ?? 0)} TL
                                    </p>
                                    {branchUnitCost === null && (
                                        <p className="text-[8px] text-amber-500/90 font-bold mt-1 uppercase tracking-wider">Şube maliyeti yoksa ürün kartı fiyatı</p>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Adet kutusu: tıklanınca numpad açılır */}
                        <button
                            type="button"
                            onClick={() => setNumpadOpen(true)}
                            className="w-full bg-[#1E3A8A]/20 p-3 md:p-6 rounded-xl md:rounded-2xl shadow-inner mb-2 md:mb-4 flex flex-col justify-center items-center border border-blue-500/30 relative shrink-0 cursor-pointer touch-manipulation active:bg-[#1E3A8A]/30 transition-colors text-left"
                        >
                            <span className="text-[10px] md:text-xs font-bold text-blue-400 uppercase tracking-[0.3em] mb-1 md:mb-2">GİRİLEN MİKTAR</span>
                            <div className="text-4xl md:text-6xl font-mono font-black text-white tracking-tighter truncate w-full text-center relative z-10 flex flex-row justify-center items-end min-h-[2.5rem] md:min-h-[4rem] gap-2 md:gap-3">
                                <span className={inputValue ? 'opacity-100' : 'opacity-20'}>{inputValue || '0'}</span>
                                <span className="text-lg md:text-2xl font-sans font-bold text-blue-500 opacity-80 mb-0.5 md:mb-1">{selectedProduct.unit || 'Adet'}</span>
                            </div>
                            <span className="text-[10px] text-gray-500 mt-1">Miktar girmek için dokun</span>
                        </button>
                    </div>
                )}

                {/* MODAL: Barkod + Maliyet düzenleme */}
                {showEditProductModal && selectedProduct && (
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[120] flex items-center justify-center p-4">
                        <div className="bg-izbel-card w-full max-w-md rounded-[2rem] border border-blue-500/40 shadow-2xl overflow-hidden">
                            <div className="p-4 border-b border-white/10 flex justify-between items-center">
                                <div className="flex flex-col">
                                    <h3 className="text-sm font-black text-white uppercase tracking-widest">Ürün Bilgisi Düzenle</h3>
                                    <p className="text-xs text-gray-500 font-bold mt-1 line-clamp-1">{selectedProduct.product_name}</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => !isUpdatingProduct && setShowEditProductModal(false)}
                                    className="p-2 text-gray-500 hover:text-white rounded-xl bg-white/5"
                                    title="Kapat"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                            <div className="p-4 space-y-4">
                                <div>
                                    <label className="text-xs uppercase font-bold tracking-widest text-gray-500 mb-2 block pl-1">Barkod</label>
                                    <div className="flex items-center gap-2">
                                        <div className="flex-1 bg-izbel-dark border border-white/10 p-4 rounded-xl font-mono text-sm text-gray-200">
                                            {editBarcode || '—'}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => { setScannerRetryCount(0); setEditBarcodeScannerOpen(true); }}
                                            className="shrink-0 px-4 py-4 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-200 font-black uppercase tracking-widest text-xs active:scale-95 transition"
                                        >
                                            Barkod Oku
                                        </button>
                                    </div>
                                    <p className="text-[10px] text-gray-500 mt-2">Barkod elle girilmez; “Barkod Oku” ile kameradan okutun.</p>

                                    {editBarcodeScannerOpen && (
                                        <div className="mt-3">
                                            {(typeof window !== 'undefined' && !window.isSecureContext) ? (
                                                <div className="mb-3 p-3 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-100">
                                                    <p className="text-xs font-bold uppercase tracking-widest mb-1">Kamera için HTTPS gerekli</p>
                                                    <p className="text-[11px] text-amber-200/90">Mobilde kamera yalnızca HTTPS üzerinde çalışır. Ngrok ile açtığınız <strong>https://...</strong> adresini kullanın.</p>
                                                </div>
                                            ) : null}
                                            <div className="rounded-2xl overflow-hidden border border-blue-500/30 bg-black aspect-square">
                                                <Scanner
                                                    formats={['qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf']}
                                                    styles={{ container: { width: '100%', height: '100%' } }}
                                                    onScan={(result) => handleEditBarcodeScan(result)}
                                                    onResult={(text) => handleEditBarcodeScan(text)}
                                                    onError={(error) => {
                                                        if (shouldIgnoreScannerPlayInterruptedError(error)) return;
                                                        if (isCameraStreamTimeoutError(error) && scannerRetryCount < 2) {
                                                            toast.error('Kamera akışı zaman aşımına uğradı. Yeniden deneniyor...', {
                                                                style: { background: '#151828', color: '#fff' },
                                                            });
                                                            setScannerRetryCount(prev => prev + 1);
                                                            setEditBarcodeScannerOpen(false);
                                                            setTimeout(() => {
                                                                setEditBarcodeScannerOpen(true);
                                                            }, 700);
                                                            return;
                                                        }
                                                        console.warn('Kamera hatası (barkod düzenle):', error?.message || error);
                                                        if (isCameraStreamTimeoutError(error)) {
                                                            toast.error('Kamera akışı zaman aşımına uğradı. Lütfen izinleri kontrol edin ve tekrar deneyin.', {
                                                                style: { background: '#151828', color: '#fff' },
                                                            });
                                                        } else {
                                                            toast.error('Kamera açılamadı: ' + (error?.message || 'Bilinmeyen hata'), { style: { background: '#151828', color: '#fff' } });
                                                        }
                                                    }}
                                                />
                                            </div>
                                            <div className="flex justify-end mt-2">
                                                <button
                                                    type="button"
                                                    onClick={() => setEditBarcodeScannerOpen(false)}
                                                    className="text-xs font-bold text-gray-400 hover:text-white uppercase tracking-widest py-2 px-3 rounded-lg bg-white/5 border border-white/5 active:scale-95 transition-all"
                                                >
                                                    Kamerayı kapat
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <div>
                                    <label className="text-xs uppercase font-bold tracking-widest text-gray-500 mb-2 block pl-1">Maliyet (TL)</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        placeholder="Örn: 149.17"
                                        value={editPurchasePrice}
                                        onChange={(e) => setEditPurchasePrice(e.target.value)}
                                        className="w-full bg-izbel-dark border border-white/10 p-4 rounded-xl outline-none focus:border-blue-500 font-medium text-white placeholder-gray-600"
                                    />
                                    <p className="text-[10px] text-gray-500 mt-2">149.17 veya 149,17 formatı kabul edilir.</p>
                                </div>
                                <div className="flex gap-3 pt-1">
                                    <button
                                        type="button"
                                        onClick={() => { setShowEditProductModal(false); setEditBarcodeScannerOpen(false); }}
                                        disabled={isUpdatingProduct}
                                        className="flex-1 py-4 border border-white/10 rounded-xl font-bold text-gray-400 active:scale-95 transition-transform disabled:opacity-50"
                                    >
                                        İPTAL
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleUpdateSelectedProduct}
                                        disabled={isUpdatingProduct}
                                        className="flex-[2] py-4 bg-blue-600 hover:bg-blue-500 rounded-xl font-black text-white active:scale-95 transition-transform disabled:opacity-50"
                                    >
                                        {isUpdatingProduct ? 'KAYDEDİLİYOR...' : 'KAYDET'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* STEP 3: My Past Counts */}
                {step === 3 && (
                    <div className="flex flex-col space-y-4 mt-4 animate-fade-in w-full pb-10">
                        <div className="flex justify-between items-center bg-izbel-card p-4 rounded-2xl border border-white/5 shadow-xl">
                            <h2 className="text-sm font-bold text-white tracking-widest uppercase flex items-center gap-2">
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-500"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                                {activePeriod ? "Dönem Sayımlarım" : "Tüm Sayımlarım"}
                            </h2>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={goBackOneStep}
                                    className="bg-white/5 hover:bg-white/10 text-gray-300 px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-widest active:scale-95 transition"
                                >
                                    Geri
                                </button>
                                <button
                                    type="button"
                                    onClick={goHome}
                                    className="bg-red-600/70 hover:bg-red-600 text-white px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-widest active:scale-95 transition"
                                >
                                    Kapat
                                </button>
                            </div>
                        </div>

                        <div className="bg-izbel-card rounded-[2rem] border border-white/5 overflow-hidden flex flex-col h-full shadow-2xl relative">
                            {isFetchingCounts ? (
                                <div className="p-10 text-center text-gray-400 font-bold uppercase tracking-widest text-sm animate-pulse">Sayımlar Yükleniyor...</div>
                            ) : myCounts.length === 0 ? (
                                <div className="p-10 text-center text-gray-400 font-bold uppercase tracking-widest text-sm">Bu dönem hiç sayım yapmadınız.</div>
                            ) : (
                                <div className="flex flex-col gap-px bg-white/5 overflow-y-auto max-h-[60vh] md:max-h-[70vh]">
                                    {myCounts.map(count => (
                                        <div key={count.id} className="bg-izbel-card hover:bg-izbel-dark/80 p-4 transition-all flex justify-between items-center group gap-4 relative">

                                            <div className="flex flex-col flex-1 overflow-hidden">
                                                <span className="font-bold text-white text-base md:text-lg truncate">{count.products?.product_name || 'Bilinmeyen Ürün'}</span>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <span className="text-[10px] text-gray-500 font-mono bg-white/5 px-2 py-0.5 rounded border border-white/5">
                                                        {count.products?.barcode || 'Barkodsuz'}
                                                    </span>
                                                    <span className="text-[8px] text-cyan-300/90 font-mono leading-tight block mt-0.5">
                                                        İlk: {formatIstanbulDateTime(count.first_counted_at || count.timestamp)}
                                                        <span className="text-gray-500 mx-1">·</span>
                                                        Son: {formatIstanbulDateTime(count.last_counted_at || count.timestamp)}
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="flex flex-col items-end shrink-0 mr-6">
                                                <div className="text-xl md:text-2xl font-mono font-black text-green-400">
                                                    {count.counted_stock}
                                                </div>
                                                <span className="text-[10px] text-gray-500 uppercase font-bold">{count.products?.unit || 'Adet'}</span>
                                            </div>

                                            <button
                                                onClick={() => handleEditPastCount(count)}
                                                className="w-8 h-8 bg-blue-600/20 text-blue-400 rounded-full flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity cursor-pointer shrink-0"
                                                title="Düzenle"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Numpad: sadece adet kutusuna tıklanınca açılır */}
            {step === 2 && selectedProduct && numpadOpen && (
                <div className="fixed bottom-0 left-0 right-0 bg-izbel-card/95 backdrop-blur-2xl shadow-[0_-20px_50px_rgba(0,0,0,0.5)] rounded-t-[2rem] md:rounded-t-[2.5rem] p-3 md:p-5 pb-5 md:pb-8 border-t border-white/10 z-20 md:max-w-lg md:mx-auto animate-slide-up select-none">
                    <div className="grid grid-cols-3 gap-2 md:gap-3 mb-3 md:mb-5">
                        {['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'SİL'].map((key) => {
                            const isAction = key === ',' || key === 'SİL';
                            return (
                                <button
                                    key={key}
                                    onClick={() => handleKeypadPress(key)}
                                    className={`font-mono text-xl md:text-3xl font-black py-3 md:p-5 rounded-xl md:rounded-2xl active:scale-95 transition-all select-none touch-manipulation border-b-4 
                            ${key === ',' ? 'bg-izbel-dark text-blue-400 border-white/5 border-t border-t-white/10 hover:bg-[#1E2336]' :
                                            key === 'SİL' ? 'bg-[#451A0A] text-orange-500 border-orange-900 border-t border-t-orange-500/20' :
                                                'bg-izbel-dark text-white border-white/5 border-t border-t-white/10 hover:bg-[#1E2336]'}`}
                                >
                                    {key}
                                </button>
                            )
                        })}
                    </div>

                    <div className="flex gap-2 md:gap-3">
                        <button
                            onClick={() => setNumpadOpen(false)}
                            className="w-1/4 bg-[#450A0A] text-red-500 font-bold py-4 md:py-6 rounded-xl md:rounded-2xl active:scale-95 transition-all text-xs md:text-sm uppercase tracking-widest border-b-4 border-red-900 border-t border-t-red-500/20"
                        >
                            İPTAL
                        </button>
                        <button
                            onClick={handleSaveAndNext}
                            disabled={isSaving}
                            className={`w-3/4 text-white text-lg md:text-xl font-black py-4 md:py-6 rounded-xl md:rounded-2xl transition-all touch-manipulation select-none tracking-widest relative overflow-hidden group border-b-4 
                       ${isSaving
                                    ? 'bg-gray-800 text-gray-500 cursor-not-allowed border-gray-900'
                                    : 'bg-green-600 border-green-800 hover:bg-green-500 active:translate-y-1 active:border-b-0 border-t border-t-green-400/30'
                                }`}
                        >
                            {isSaving ? 'GÖNDERİLİYOR...' : 'ONAYLA'}
                        </button>
                    </div>
                </div>
            )
            }
        </div >
    );
}
