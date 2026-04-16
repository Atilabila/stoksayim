with open('AdminDashboard.jsx', encoding='utf-8') as f:
    lines = f.readlines()
    for i, line in enumerate(lines):
        if 'Tedarik Gir' in line or 'Modal' in line or 'value={supplyDrafts' in line:
            if 'supplyDraft' in line or 'value=' in line or 'onChange=' in line:
                print(f"{i+1}: {line.strip()}")
