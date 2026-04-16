with open('AdminDashboard.jsx', encoding='utf-8') as f:
    for i, line in enumerate(f):
        if 'handleBranchSalesImport' in line:
            print(f"Line: {i+1}")
