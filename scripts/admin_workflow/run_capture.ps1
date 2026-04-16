$ErrorActionPreference = "Stop"

Write-Host "Admin/Şube workflow screenshot capture başlıyor..."

# Gerekli ENV set etmeyi öneriyoruz (örnek):
# $env:APP_URL="https://stoksayim.vercel.app"
# $env:ADMIN_USERNAME="admin"
# $env:ADMIN_PASSWORD="<ADMIN_PASSWORD>"
#
# Opsiyonel:
# $env:BRANCH_USERNAME="<BRANCH_USERNAME>"
# $env:BRANCH_PASSWORD="<BRANCH_PASSWORD>"
# $env:PERSON_NAME="Otomatik Personel"

python scripts/admin_workflow/capture_workflow.py --headless
python scripts/admin_workflow/build_notebooklm_index.py

Write-Host "Bitti."

