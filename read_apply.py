import json
with open('AdminDashboard.jsx', encoding='utf-8') as f:
    lines = f.readlines()
    
start = -1
for i, l in enumerate(lines):
    if 'const applyRecipeConsumptionToBranchStocks' in l:
        start = i
        break

if start != -1:
    print(''.join(lines[start:start+120]))
