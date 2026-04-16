import sys

with open('AdminDashboard.jsx', encoding='utf-8') as f:
    for i, line in enumerate(f):
        if 'Premium' in line or 'Premium' in line:
            print(f"Line: {i+1} -> {line.strip()[:100]}")
