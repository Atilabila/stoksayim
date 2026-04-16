import sys

with open('AdminDashboard.jsx', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
for i, l in enumerate(lines):
    if 'const resolveName = (csvName) => {' in l:
        new_lines.append(l)
        new_lines.append("                const raw = String(csvName || '').trim();\n")
        new_lines.append("                if (posManualMap[raw]) {\n")
        new_lines.append("                    const mp = products.find(p => p.id === posManualMap[raw]);\n")
        new_lines.append("                    if (mp) return { product: mp, reason: null };\n")
        new_lines.append("                }\n")
    elif 'const resolveRef = (' in l and 'colBarkod' in lines[i-5]:
        new_lines.append(l)
    elif 'if (product) {' in l and 'const key =' in lines[i+1] and 'const resolveName =' not in lines[i-15]:
        # we are around line 1740-1760.
        new_lines.append(l)
        new_lines.append(lines[i+1])
        new_lines.append(lines[i+2])
        new_lines.append(lines[i+3])
        new_lines.append("                    } else {\n")
        new_lines.append("                        if (reason === 'ambiguous_name' || reason === 'ambiguous_partial') ambiguous++;\n")
        new_lines.append("                        else skipped++;\n")
        new_lines.append("                        unmatchArrCsv.push({ rawPosName: csvName, qty: qty, reason });\n")
        new_lines.append("                    }\n")
    elif '} else {' in l and 'matched++;' in lines[i-1] and 'let ambiguous = 0;' in lines[i-20]:
        pass
    elif "if (reason === 'ambiguous_name' ||" in l and '} else {' in lines[i-1] and 'matched++;' in lines[i-2]:
        pass
    elif 'else skipped++;' in l and "if (reason ===" in lines[i-1] and '} else {' in lines[i-2]:
        pass
    elif '}' in l and 'else skipped++;' in lines[i-1] and "if (reason ===" in lines[i-2]:
        pass
    else:
        new_lines.append(l)

with open('AdminDashboard.jsx', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)
print('Patched resolveName')
