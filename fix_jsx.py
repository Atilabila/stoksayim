import sys

with open('AdminDashboard.jsx', encoding='utf-8') as f:
    lines = f.readlines()

for i, l in enumerate(lines):
    if 'onClick={() => void handleResetAllCounts()}' in l and 'span' in lines[i-3]:
        # we found the broken part
        broken_start = i - 15  # around "disabled={isLoading}"
        break

new_lines = []
skip = False
for i, l in enumerate(lines):
    if l.strip() == 'disabled={isLoading}':
        if not skip:
            new_lines.append(l)
            new_lines.append("""                                onClick={() => void handleResetAllCounts()}
                                className="shrink-0 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white font-black py-4 px-8 rounded-xl uppercase tracking-widest text-xs shadow-lg border border-rose-400/40"
                            >
                                Tüm sayımları sil
                            </button>
                            <button
                                onClick={() => void handleResetDatabaseStocks()}
                                className="shrink-0 bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white font-black py-4 px-8 rounded-xl uppercase tracking-widest text-xs shadow-lg border border-red-400/40 ml-2"
                            >
                                Ana Stokları Sil
                            </button>
""")
        skip = True
    elif skip and l.strip() == 'Tüm sayımları sil':
        # the original one ends completely at `</button>` AFTER `Tüm sayımları sil`
        skip = False
    elif skip and l.strip() == '</button>' and lines[i-1].strip() == 'Tüm sayımları sil':
        skip = False # next is normal
    elif not skip:
        new_lines.append(l)

with open('AdminDashboard.jsx', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)
print('fixed jsx')
