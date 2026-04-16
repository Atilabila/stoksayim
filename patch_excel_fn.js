    const exportUrunOnayPremiumXlsx = async () => {
        if (selectedBranchId === 'ALL') {
            toast.error('Premium rapor almak için önce şube seçmelisiniz.');
            return;
        }
        setIsLoading(true);
        try {
            const branchName = branches.find((b) => b.id === selectedBranchId)?.branch_name || 'Şube';
            
            const consumptionMap = new Map();
            Object.keys(salesQtyByKey).forEach((k) => {
                const [bid, soldPid] = k.split('|');
                if (bid !== selectedBranchId) return;
                const sold = Number(salesQtyByKey[k]) || 0;
                if (!sold) return;
                const recipePid = resolveRecipeProductIdForSaleProduct(soldPid);
                if (!recipePid) return;
                const recipeRows = recipeByProductId.get(recipePid) || [];
                recipeRows.forEach((ri) => {
                    const useQty = sold * (Number(ri.quantity_per_recipe) || 0);
                    if (!useQty) return;
                    const pid = ri.ingredient_product_id;
                    consumptionMap.set(pid, (consumptionMap.get(pid) || 0) + useQty);
                });
            });

            const purchaseMap = new Map();
            Object.keys(manualPurchaseByKey).forEach((k) => {
                const [bid, pid] = k.split('|');
                if (bid !== selectedBranchId) return;
                const q = Number(manualPurchaseByKey[k]) || 0;
                if (q) purchaseMap.set(pid, (purchaseMap.get(pid) || 0) + q);
            });

            const periodId = selectedPeriodId !== 'ALL' ? selectedPeriodId : (periods.find(p => p.is_active) || periods[0])?.id;
            const periodCounts = counts.filter(c => c.period_id === periodId && c.branch_id === selectedBranchId);
            const countMap = new Map();
            periodCounts.forEach(c => {
                countMap.set(c.product_id, c.counted_stock ?? 0);
            });

            const wb = new ExcelJS.Workbook();
            const ws = wb.addWorksheet('Ürün Onay & Kayıp Kaçak');

            ws.columns = [
                { header: 'Stok Kodu', key: 'stokKodu', width: 18 },
                { header: 'Ürün Adı', key: 'urunAdi', width: 45 },
                { header: 'Birim', key: 'birim', width: 12 },
                { header: 'Sistem Stok (Önceki)', key: 'sistemStok', width: 22 },
                { header: 'Tedarik (+)', key: 'tedarik', width: 18 },
                { header: 'Tüketim (-)', key: 'tuketim', width: 18 },
                { header: 'Olması Gereken Stok', key: 'olmasiGereken', width: 25 },
                { header: 'Sayılan Adet', key: 'sayilan', width: 20 },
                { header: 'FARK (Kayıp/Kazaç)', key: 'fark', width: 25 }
            ];

            ws.getRow(1).height = 30;
            ws.getRow(1).eachCell((cell) => {
                cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12, name: 'Inter' };
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
                cell.fill = {
                    type: 'gradient',
                    gradient: 'angle',
                    degree: 90,
                    stops: [
                        { position: 0, color: { argb: 'FF1E3A8A' } },
                        { position: 1, color: { argb: 'FF3B82F6' } }
                    ]
                };
                cell.border = {
                    top: {style:'thin', color: {argb:'FF1E3A8A'}},
                    left: {style:'thin', color: {argb:'FF1E3A8A'}},
                    bottom: {style:'thin', color: {argb:'FF1E3A8A'}},
                    right: {style:'thin', color: {argb:'FF1E3A8A'}}
                };
            });

            products.forEach((p, index) => {
                if (p.is_active === false) return;
                const pid = p.id;
                const consumedQty = consumptionMap.get(pid) || 0;
                const purchaseQty = purchaseMap.get(pid) || 0;
                const countedQty = countMap.get(pid) || 0;

                const key = `${selectedBranchId}|${pid}`;
                const row = branchStockByKey.get(key);
                const prevQty = row ? Number(row.quantity) || 0 : Number(p.current_stock) || 0;

                const rowIndex = index + 2;

                const rowData = ws.addRow({
                    stokKodu: p.stok_kodu || '',
                    urunAdi: p.product_name || '',
                    birim: p.unit || 'Adet',
                    sistemStok: prevQty,
                    tedarik: purchaseQty,
                    tuketim: consumedQty,
                    olmasiGereken: { formula: `ROUND(D${rowIndex}+E${rowIndex}-F${rowIndex}, 2)` },
                    sayilan: countedQty,
                    fark: { formula: `ROUND(H${rowIndex}-G${rowIndex}, 2)` }
                });

                ['D', 'E', 'F', 'G', 'H', 'I'].forEach((colLetter) => {
                    const cell = ws.getCell(`${colLetter}${rowIndex}`);
                    cell.numFmt = '#,##0.00';
                    cell.alignment = { horizontal: 'right' };
                });

                rowData.eachCell({ includeEmpty: true }, (cell) => {
                    cell.border = {
                        bottom: { style: 'hair', color: { argb: 'FFCCCCCC' } }
                    };
                });
            });

            ws.addConditionalFormatting({
                ref: `I2:I${products.length + 1}`,
                rules: [
                    {
                        type: 'cellIs',
                        operator: 'lessThan',
                        formulae: ['0'],
                        style: {
                            fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFC7CE' } },
                            font: { color: { argb: 'FF9C0006' }, bold: true }
                        }
                    },
                    {
                        type: 'cellIs',
                        operator: 'greaterThan',
                        formulae: ['0'],
                        style: {
                            fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFC6EFCE' } },
                            font: { color: { argb: 'FF006100' }, bold: true }
                        }
                    }
                ]
            });

            ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];

            const buffer = await wb.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Sube_${branchName.replace(/\s+/g, '_')}_Kayip_Kazeck_Raporu.xlsx`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            toast.success('Premium Excel raporu (Canlı formüllü) başarıyla oluşturuldu.');
        } catch (err) {
            console.error(err);
            toast.error('Rapor oluşturulurken hata oluştu.');
        } finally {
            setIsLoading(false);
        }
    };
