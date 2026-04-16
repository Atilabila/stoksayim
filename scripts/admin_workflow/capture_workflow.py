import argparse
import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeoutError


def _now_stamp() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def _slugify(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    return s.strip("_")[:80]


def _env(name: str, default=None):
    v = os.environ.get(name, default)
    return v


def save_step_png(page, out_dir: Path, step_name: str, width: int, height: int) -> Path:
    fn = out_dir / f"{_slugify(step_name)}_{width}x{height}.png"
    # full_page=True bazen çok büyük PNG üretebilir; eğitim amaçlı yine de faydalı.
    page.screenshot(path=str(fn), full_page=True)
    return fn


def wait_for_any(page, locators, timeout_ms=15000):
    deadline = time.time() + timeout_ms / 1000.0
    last_err = None
    while time.time() < deadline:
        for name, locator in locators:
            try:
                if locator.count() > 0:
                    return name
            except Exception as e:
                last_err = e
        time.sleep(0.2)
    raise RuntimeError(f"Beklenen görünüm bulunamadı. Son hata: {last_err}")


def try_login(page, username: str, password: str, selectors: dict):
    # Login inputları görünene kadar bekle
    page.wait_for_timeout(200)
    page.locator(selectors["username_input"]).first.wait_for(state="visible", timeout=15000)
    page.locator(selectors["username_input"]).first.fill("", timeout=5000)
    page.locator(selectors["username_input"]).first.fill(username)
    page.locator(selectors["password_input"]).first.fill("", timeout=5000)
    page.locator(selectors["password_input"]).first.fill(password)
    page.locator(selectors["submit_button"]).first.click()


def try_handle_person_name_modal(page, selectors: dict, person_name: str, timeout_ms=15000) -> bool:
    # Modal gelirse otomatik dolduralım; gelmezse sessizce devam.
    try:
        page.locator(selectors["person_name_input"]).first.wait_for(state="visible", timeout=timeout_ms)
    except PWTimeoutError:
        return False
    page.locator(selectors["person_name_input"]).first.fill("", timeout=5000)
    page.locator(selectors["person_name_input"]).first.fill(person_name)
    page.locator(selectors["person_name_continue_button"]).first.click()
    page.wait_for_timeout(1200)
    return True


def safe_click_first_category_and_product(page):
    """
    Advanced filter açıkken:
    - Kategori (grup) adımında ilk kategori butonunu tıkla
    - Ürün adımında ilk ürün butonunu tıkla
    """
    # filterStep==1 container: <div className="flex-1 overflow-y-auto p-4 space-y-1 min-h-0">
    list_container = page.locator(".flex-1.overflow-y-auto.p-4.space-y-1.min-h-0").first
    cat_buttons = list_container.locator("button")
    if cat_buttons.count() < 1:
        return False
    cat_buttons.first.click()
    page.wait_for_timeout(600)

    page.get_by_text("Ürün seçin").wait_for(state="visible", timeout=10000)
    product_list_container = page.locator(".flex-1.overflow-y-auto.p-4.space-y-1.min-h-0").first
    product_buttons = product_list_container.locator("button")
    if product_buttons.count() < 1:
        return False
    product_buttons.first.click()
    page.wait_for_timeout(900)
    return True


def safe_open_numpad(page):
    # Step2'de miktar alanı içindeki "GİRİLEN MİKTAR" textini bul ve üstteki button'u tıkla.
    marker = page.get_by_text("GİRİLEN MİKTAR").first
    btn = marker.locator("xpath=ancestor::button[1]")
    btn.click()
    page.wait_for_timeout(800)


def main():
    load_dotenv()

    parser = argparse.ArgumentParser()
    parser.add_argument("--headless", action="store_true", help="headless çalıştır")
    parser.add_argument("--no-headless", action="store_true", help="headless kapat")
    parser.add_argument("--out-root", default=_env("OUT_DIR", "screenshots"))
    parser.add_argument("--viewport-width", type=int, default=int(_env("VIEWPORT_WIDTH", 390)))
    parser.add_argument("--viewport-height", type=int, default=int(_env("VIEWPORT_HEIGHT", 844)))
    parser.add_argument("--timeout-ms", type=int, default=20000)
    args = parser.parse_args()

    headless = True
    if args.no_headless:
        headless = False

    app_url = _env("APP_URL")
    admin_username = _env("ADMIN_USERNAME")
    admin_password = _env("ADMIN_PASSWORD")
    branch_username = _env("BRANCH_USERNAME")
    branch_password = _env("BRANCH_PASSWORD")
    person_name = _env("PERSON_NAME", "Otomatik Personel")

    if not app_url or not admin_username or not admin_password:
        raise RuntimeError("APP_URL, ADMIN_USERNAME, ADMIN_PASSWORD ENV set etmelisin.")

    out_root = Path(args.out_root)
    run_dir = out_root / _now_stamp()
    run_dir.mkdir(parents=True, exist_ok=True)

    # App.jsx / CountingScreen.jsx'deki placeholder/text'lere göre locator
    selectors = {
        "username_input": 'input[placeholder="Şube veya admin"]',
        "password_input": 'input[placeholder="••••••••"]',
        "submit_button": 'button[type="submit"]',
        "person_name_input": 'input[placeholder="Örn: Ahmet Yılmaz"]',
        "person_name_continue_button": 'button:has-text("DEVAM ET")',
    }

    steps = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        context = browser.new_context(
            viewport={"width": args.viewport_width, "height": args.viewport_height},
        )
        page = context.new_page()
        page.set_default_timeout(args.timeout_ms)

        def do_step(step_name: str):
            save_step_png(page, run_dir, step_name, args.viewport_width, args.viewport_height)
            steps.append(step_name)

        page.goto(app_url, wait_until="domcontentloaded")
        do_step("00_login_land")

        # Admin login
        try:
            try_login(page, admin_username, admin_password, selectors)
            page.wait_for_timeout(1500)
            do_step("01_admin_after_login")
        except Exception:
            # Login UI değişirse yine de iz bırakmak için ekran kaydı alalım
            do_step("01_admin_login_failed")
            raise

        # Admin ekranı sonrası branch ekranını yakalamak için yeniden login ekranına dönelim.
        if branch_username and branch_password:
            page.goto(app_url, wait_until="domcontentloaded")
            page.wait_for_timeout(600)
            try:
                try_login(page, branch_username, branch_password, selectors)
            except Exception:
                do_step("02_branch_login_failed")
                raise

            # Personel adı sorulursa
            try_handle_person_name_modal(page, selectors, person_name, timeout_ms=8000)
            do_step("02_branch_counting_step1_loaded")

            # Advanced filter ile ürün seçip step2'yi yakalamaya çalış
            try:
                page.get_by_text("Ürün seç (Kategori").first.click()
            except Exception:
                # ok: buton text varyasyonlarında fallback:
                page.locator("button", has_text=re.compile(r"Ürün seç")).first.click()

            do_step("03_advanced_filter_opened")
            try:
                page.get_by_text("Grubu (Kategori) seçin").wait_for(state="visible", timeout=10000)
            except Exception:
                # bazı tarayıcılar geç render edebilir
                page.wait_for_timeout(800)

            selected = safe_click_first_category_and_product(page)
            do_step("04_after_category_and_product_selected")
            if selected:
                # miktar alanından numpad aç
                try:
                    safe_open_numpad(page)
                    do_step("05_step2_numpad_opened")
                except Exception:
                    do_step("05_step2_numpad_open_failed")
            else:
                do_step("04_no_category_or_product_found")

        manifest = {
            "app_url": app_url,
            "created_at": run_dir.name,
            "viewport": {"width": args.viewport_width, "height": args.viewport_height},
            "steps": steps,
            "note": "Slayt üretimi için index.md + png'ler kullanılır.",
        }
        (run_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

        context.close()
        browser.close()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)

