import sys

with open('AdminDashboard.jsx', encoding='utf-8') as f:
    lines = f.readlines()

def_float = """
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

new_lines = []
inserted_parse = False
for i, l in enumerate(lines):
    if 'const applySupplyDrafts = () => {' in l and not inserted_parse:
        new_lines.append(def_float + '\n')
        new_lines.append(l)
        inserted_parse = True
    elif 'const n = Number(raw.replace(/[^\d.,]/g' in l or "const n = Number(raw.replace(/\\./g, '').replace(',', '.'));" in l:
        new_lines.append(l.replace("Number(raw.replace(/\\./g, '').replace(',', '.'));", "humanParseFloat(raw);").replace("Number(raw.replace(/[^\\d.,]/g, '').replace(',', '.'));", "humanParseFloat(raw);"))
    else:
        new_lines.append(l)

with open('AdminDashboard.jsx', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print("Patched humanParseFloat")
