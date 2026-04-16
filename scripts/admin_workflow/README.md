# Admin workflow screenshot automation

Bu set, `APP_URL` üzerinde:
1) Admin ile giriş yapar
2) Admin sayfası/erişim sonrası ilgili ekranlardan ekran görüntüleri alır
3) (Varsa) Şube/Personel ile giriş yapar, “şubelere sayım nasıl yapılır” akışı için adım adım UI ekranlarını da yakalamaya çalışır
4) NotebookLM için `index.md` oluşturur

## 1) Gereksinimler

```bash
python -m pip install -r scripts/admin_workflow/requirements-workflow.txt
python -m playwright install chromium
```

## 2) ENV ayarı

Terminalde ENV set etmek için örnek:

```powershell
$env:APP_URL="https://stoksayim.vercel.app"
$env:ADMIN_USERNAME="admin"
$env:ADMIN_PASSWORD="<ADMIN_PASSWORD>"

# Opsiyonel (sayım ekranını yakalamak için önerilir)
$env:BRANCH_USERNAME="<BRANCH_USERNAME>"
$env:BRANCH_PASSWORD="<BRANCH_PASSWORD>"
$env:PERSON_NAME="Otomatik Personel"
```

Alternatif olarak `scripts/admin_workflow/.env.example` dosyasını kopyalayıp (şifre kısmını doldurarak) çalıştırabilirsin.

## 3) Ekran görüntüsü al

```powershell
python scripts/admin_workflow/capture_workflow.py --headless
```

Çıktılar:
- `screenshots/<timestamp>/*png`
- `screenshots/<timestamp>/index.md`
- `screenshots/<timestamp>/manifest.json`

## 4) NotebookLM prompt

Aynı klasörde `notebooklm_prompt_tr.md` dosyası var. NotebookLM’e:
- `index.md`
- `*png`
- `notebooklm_prompt_tr.md` prompt içeriği
yükleyerek slayt taslağı ürettirebilirsin.

