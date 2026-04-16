import sys

with open('AdminDashboard.jsx', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
for i, l in enumerate(lines):
    if 'const recipeRows = recipeByProductId.get(recipePid) || [];' in l:
        new_lines.append(l)
        new_lines.append('            // Yeni Kural: Reçetesi (alt kırılımı) yoksa doğrudan kendisini 1\'e 1 oranda tüket (Direkt İçecek vs)\n')
        new_lines.append('            if (recipeRows.length === 0) {\n')
        new_lines.append('                consumptionMap.set(recipePid, (consumptionMap.get(recipePid) || 0) + sold);\n')
        new_lines.append('            } else {\n')
        new_lines.append('                soldRecipeProductCount++;\n')
        new_lines.append('                recipeRows.forEach((ri) => {\n')
        new_lines.append('                    const useQty = sold * (Number(ri.quantity_per_recipe) || 0);\n')
        new_lines.append('                    if (!Number.isFinite(useQty) || useQty === 0) return;\n')
        new_lines.append('                    const pid = ri.ingredient_product_id;\n')
        new_lines.append('                    consumptionMap.set(pid, (consumptionMap.get(pid) || 0) + useQty);\n')
        new_lines.append('                });\n')
        new_lines.append('            }\n')
    # Filter out the old logic block inside the loop
    elif 'if (recipeRows.length > 0) soldRecipeProductCount++;' in l:
        pass
    elif 'recipeRows.forEach((ri) => {' in l and 'const useQty =' in lines[i+1]:
        # we skip the next 5 lines
        pass
    elif 'const useQty =' in l and 'recipeRows.forEach' in lines[i-1]:
        pass
    elif 'if (!Number.isFinite(useQty) || useQty === 0) return;' in l and 'const useQty = ' in lines[i-1]:
        pass
    elif 'const pid = ri.ingredient_product_id;' in l and 'if (!Number.isFinite' in lines[i-1]:
        pass
    elif 'consumptionMap.set(pid, (consumptionMap.get(pid) || 0) + useQty);' in l and 'const pid = ' in lines[i-1]:
        pass
    elif l.strip() == '});' and 'consumptionMap.set(pid' in lines[i-1]:
        pass
    else:
        new_lines.append(l)

with open('AdminDashboard.jsx', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)
print('Patched consumption map')
