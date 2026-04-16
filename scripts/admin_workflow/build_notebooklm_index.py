import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", default=None, help="screenshots/<timestamp> klasörü")
    parser.add_argument("--screenshots-root", default="screenshots")
    args = parser.parse_args()

    root = Path(args.screenshots_root)
    if args.run_dir:
        run_dir = Path(args.run_dir)
    else:
        # en güncel run'i seç
        candidates = [p for p in root.iterdir() if p.is_dir()]
        if not candidates:
            raise RuntimeError(f"{root} altında screenshot klasörü bulunamadı.")
        run_dir = sorted(candidates, key=lambda p: p.name)[-1]

    if not run_dir.exists():
        raise RuntimeError(f"run_dir bulunamadı: {run_dir}")

    manifest_path = run_dir / "manifest.json"
    manifest = {}
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    images = sorted(run_dir.glob("*.png"))

    # index.md: NotebookLM'e yüklerken görseller aynı klasörde olduğu varsayılıyor.
    index_md = run_dir / "index.md"
    lines = ["# Admin / Şube Sayım Workflow Ekran Görüntüleri", ""]

    steps = manifest.get("steps") or []
    if steps:
        lines.append("## Adım Listesi")
        for s in steps:
            lines.append(f"- {s}")
        lines.append("")

    lines.append("## Görseller")
    for img in images:
        rel = img.name
        lines.append(f"### {rel}")
        lines.append(f"![{rel}]({rel})")
        lines.append("")

    index_md.write_text("\n".join(lines), encoding="utf-8")
    print("index.md oluşturuldu:", index_md)


if __name__ == "__main__":
    main()

