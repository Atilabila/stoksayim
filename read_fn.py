with open('AdminDashboard.jsx', encoding='utf-8') as f:
    lines = f.readlines()

s = False
block = []
for l in lines:
    if 'const applyRecipeConsumptionToBranchStocks' in l:
        s = True
    if s:
        block.append(l)
        if l.startswith('    };') and len(block) > 10:
            break

print("".join(block))
