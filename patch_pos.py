import sys

with open('AdminDashboard.jsx', encoding='utf-8') as f:
    lines = f.readlines()

state_lines = """
    const [posManualMap, setPosManualMap] = useState(() => {
        try { return JSON.parse(localStorage.getItem('izbel_pos_map')) || {}; } catch { return {}; }
    });
    const [salesPosUnmatched, setSalesPosUnmatched] = useState([]);

    const applyManualPosMatches = () => {
        // Find them again by re-triggering the parse logic or just manually reading salesPosUnmatched
        let matched = 0;
        setSalesQtyByKey(prev => {
            const next = { ...prev };
            const stillUnmatched = [];
            salesPosUnmatched.forEach(u => {
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

"""

new_lines = []
inserted_state = False

for i, l in enumerate(lines):
    if 'const [salesUndoStack, setSalesUndoStack] = useState' in l and not inserted_state:
        new_lines.append(l)
        new_lines.append(state_lines)
        inserted_state = True
    elif 'const resolveScLoggerProductName = (rawName) => {' in l:
        new_lines.append(l)
        new_lines.append("                const raw = String(rawName || '').trim();\n")
        new_lines.append("                if (posManualMap[raw]) {\n")
        new_lines.append("                    const mp = products.find(p => p.id === posManualMap[raw]);\n")
        new_lines.append("                    if (mp) return { product: mp, reason: null };\n")
        new_lines.append("                }\n")
    elif 'let skipped = 0;' in l and 'let matched = 0;' in lines[i+1]:
        new_lines.append(l)
        new_lines.append(lines[i+1])
        new_lines.append(lines[i+2])
        new_lines.append("            const unmatchArr = [];\n")
        # skip next 2 lines
    elif 'let matched = 0;' in l and 'let skipped = 0;' in lines[i-1]:
        pass
    elif 'let ambiguous = 0;' in l and 'let matched = 0;' in lines[i-1]:
        pass
    elif 'if (product) {' in l and 'resolveScLoggerProductName' in lines[i-1]:
        new_lines.append(l)
        new_lines.append(lines[i+1])
        new_lines.append(lines[i+2])
        new_lines.append(lines[i+3])
        new_lines.append(lines[i+4])
        new_lines.append("                        if (reason === 'ambiguous_name' || reason === 'ambiguous_partial') ambiguous++;\n")
        new_lines.append("                        else skipped++;\n")
        new_lines.append("                        unmatchArr.push({ rawPosName: r.name, qty: r.qty, reason });\n")
        new_lines.append("                    }\n")
    elif 'const key = `${selectedBranchId}|${product.id}`;' in l and 'if (product) {' in lines[i-1]:
        pass
    elif 'next[key] = (next[key] || 0) + r.qty;' in l and 'const key = ' in lines[i-1]:
        pass
    elif 'matched++;' in l and 'next[key]' in lines[i-1]:
        pass
    elif '} else {' in l and 'matched++;' in lines[i-1]:
        pass
    elif "if (reason === 'ambiguous_name'" in l and '} else {' in lines[i-1]:
        pass
    elif 'else skipped++;' in l and "if (reason === 'ambiguous_name'" in lines[i-1]:
        pass
    elif '}' in l and 'else skipped++;' in lines[i-1]:
        pass
    elif 'return next;' in l and '});' in lines[i-1]:
        new_lines.append(l)
        new_lines.append("            setSalesPosUnmatched(unmatchArr);\n")
    else:
        new_lines.append(l)

with open('AdminDashboard.jsx', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)
print('Patched ScLogger UI state')
