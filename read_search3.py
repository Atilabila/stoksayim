with open('AdminDashboard.jsx', encoding='utf-8') as f:
    lines = f.readlines()
    for i, line in enumerate(lines):
        if 'Modal' in line and ('Tedarik' in line or 'Supply' in line):
            print(f"Modals line: {i+1}")
