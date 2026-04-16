with open('AdminDashboard.jsx', encoding='utf-8') as f:
    for i, l in enumerate(f):
        if l.startswith('    return ('):
            print(f'{i+1}: {l.strip()}')
