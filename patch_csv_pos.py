import sys

with open('AdminDashboard.jsx', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
for i, l in enumerate(lines):
    if 'let skipped = 0;' in l and 'let ambiguous = 0;' in lines[i+2]:
        new_lines.append(l)
        new_lines.append(lines[i+1])
        new_lines.append(lines[i+2])
        new_lines.append("            const unmatchArrCsv = [];\n")
    elif 'let matched = 0;' in l and 'let skipped = 0;' in lines[i-1]:
        pass
    elif 'let ambiguous = 0;' in l and 'let matched = 0;' in lines[i-1]:
        pass
    elif 'setSalesQtyByKey((prev) => {' in l and 'let ambiguous = 0;' in lines[i-3]:
        new_lines.append(l)
    elif 'return next;' in l and '});' in lines[i+1] and 'const key =' in lines[i-4]:
        new_lines.append(l)
        new_lines.append("            setSalesPosUnmatched(unmatchArrCsv);\n")
    else:
        new_lines.append(l)

with open('AdminDashboard.jsx', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)
print('Patched handleBranchSalesImport state')
