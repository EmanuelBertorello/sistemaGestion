"""
SRT Comisiones Médicas - Descarga de expedientes (PDFs)
Accede a la Ventanilla Electrónica de la SRT usando CUIT + clave fiscal de ARCA
"""

import asyncio
import json
import getpass
from datetime import datetime
from pathlib import Path
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout

# ─────────────────────────────────────────
# CONFIGURACIÓN
# ─────────────────────────────────────────
CUIT = "20283143873"
CLAVE_FISCAL = "Brunoc2026"

HEADLESS = False
TIMEOUT = 30_000

URL_LOGIN_ARCA  = "https://auth.afip.gob.ar/contribuyente_/login.xhtml"
URL_PORTAL      = "https://portalcf.cloud.afip.gob.ar/portal/app/"
URL_SRT_HOME    = "https://eservicios.srt.gob.ar/home/Servicios.aspx"
URL_EXPEDIENTES = "https://eservicios.srt.gob.ar/Patrocinio/Expedientes/Expedientes.aspx"

TODAY = datetime.now().strftime("%Y-%m-%d")
OUTPUT_DIR = Path("output") / TODAY
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
# ─────────────────────────────────────────


async def login_arca(page, cuit, clave):
    print("[1/3] Login ARCA...")
    await page.goto(URL_LOGIN_ARCA, wait_until="domcontentloaded")

    cuit_input = page.locator("input:not([type='hidden']):not([type='submit']):not([type='button'])").first
    await cuit_input.wait_for(state="visible", timeout=TIMEOUT)
    await cuit_input.fill(cuit)

    siguiente = page.locator("button:has-text('Siguiente'), input[value='Siguiente'], input[type='submit'], button[type='submit']").first
    await siguiente.wait_for(state="visible", timeout=TIMEOUT)
    await siguiente.click()
    await page.wait_for_load_state("domcontentloaded")
    await page.wait_for_timeout(2000)

    pass_input = page.locator("input[type='password']").first
    await pass_input.wait_for(state="visible", timeout=TIMEOUT)
    await pass_input.fill(clave)

    ingresar = page.locator("button:has-text('Ingresar'), input[value='Ingresar'], input[type='submit'], button[type='submit']").first
    await ingresar.wait_for(state="visible", timeout=TIMEOUT)
    await ingresar.click()
    await page.wait_for_load_state("domcontentloaded")
    await page.wait_for_timeout(3000)
    print(f"[1/3] Login OK — {page.url}")


async def navegar_srt(page):
    print("[2/3] Abriendo portal ARCA...")
    await page.goto(URL_PORTAL, wait_until="domcontentloaded")
    await page.wait_for_timeout(4000)

    buscador = page.locator("input[type='search'], input[placeholder*='uscar']").first
    if await buscador.count() > 0:
        await buscador.fill("SRT")
        await page.wait_for_timeout(2000)

    srt_card = page.locator("a:has(h3:has-text('e-Servicios SRT')), h3:has-text('e-Servicios SRT')").first
    await srt_card.wait_for(state="visible", timeout=TIMEOUT)
    print("[2/3] Abriendo e-Servicios SRT...")

    async with page.context.expect_page() as nueva_tab_info:
        await srt_card.click()
    nueva_tab = await nueva_tab_info.value

    await nueva_tab.wait_for_load_state("domcontentloaded")
    await nueva_tab.wait_for_timeout(3000)
    print(f"[2/3] SRT URL: {nueva_tab.url}")

    if "eservicios.srt.gob.ar" not in nueva_tab.url:
        print("[2/3] Redirigiendo al home SRT...")
        await nueva_tab.goto(URL_SRT_HOME, wait_until="domcontentloaded")
        await nueva_tab.wait_for_timeout(3000)

    print("[2/3] Navegando a Expedientes Medicos...")
    await nueva_tab.goto(URL_EXPEDIENTES, wait_until="domcontentloaded",
                         referer=URL_SRT_HOME)
    await nueva_tab.wait_for_timeout(4000)
    print(f"[2/3] Expedientes URL: {nueva_tab.url}")
    return nueva_tab


async def cerrar_modales(page):
    """Cierra cualquier modal abierto: SweetAlert2, Bootstrap, o dialogs."""
    # SweetAlert2 — primero intentar click si el botón está habilitado
    swal_btn = page.locator(
        "button.swal2-confirm:visible:not([disabled]), "
        "button.swal2-cancel:visible:not([disabled]), "
        ".swal2-close:visible"
    ).first
    if await swal_btn.count() > 0:
        try:
            await swal_btn.click(timeout=3000)
            await page.wait_for_timeout(500)
        except Exception:
            pass

    # Forzar cierre de SweetAlert2 por JS (cubre botones disabled y overlays residuales)
    await page.evaluate("""
        () => {
            document.querySelectorAll('.swal2-container').forEach(el => el.remove());
            document.querySelectorAll('.swal2-backdrop-show').forEach(el => el.remove());
            document.body.classList.remove('swal2-shown', 'swal2-height-auto');
            document.body.style.overflow = '';
        }
    """)

    # Bootstrap modals
    cerrar = page.locator(
        "button.close:visible, [data-dismiss='modal']:visible"
    ).first
    if await cerrar.count() > 0:
        try:
            await cerrar.click(timeout=3000)
            await page.wait_for_timeout(400)
        except Exception:
            pass


async def intentar_descarga(page, nro, downloads_dir, max_reintentos=2):
    """Intenta descargar un expediente con reintentos."""
    nombre = f"bruno_expediente_{nro.replace('/', '_')}.pdf"
    destino = downloads_dir / nombre

    for intento in range(max_reintentos):
        await cerrar_modales(page)
        await page.wait_for_timeout(300)

        btn = page.locator("table tbody tr").filter(has_text=nro).locator(
            "a[ng-click='exportar(e)']"
        ).first

        if await btn.count() == 0:
            return False

        try:
            await btn.click(timeout=10000)
        except Exception:
            await cerrar_modales(page)
            continue

        await page.wait_for_timeout(1500)

        # Buscar modal de confirmación (Bootstrap o SweetAlert2)
        aceptar = page.locator(
            "button.swal2-confirm:visible, "
            "button:has-text('Aceptar'):visible, button:has-text('Confirmar'):visible, "
            "button:has-text('Si'):visible, button:has-text('OK'):visible"
        ).first

        try:
            if await aceptar.count() > 0:
                async with page.expect_download(timeout=20000) as dl_info:
                    await aceptar.click()
            else:
                async with page.expect_download(timeout=8000) as dl_info:
                    pass

            dl = await dl_info.value
            await dl.save_as(str(destino))
            print(f"    Guardado: {nombre}")
            return True

        except PlaywrightTimeout:
            await cerrar_modales(page)
            if intento < max_reintentos - 1:
                print(f"    Reintentando {nro}...")
                await page.wait_for_timeout(1000)
        except Exception as e:
            err_msg = str(e)
            if "canceled" in err_msg and intento < max_reintentos - 1:
                print(f"    Descarga cancelada {nro}, reintentando...")
                await cerrar_modales(page)
                await page.wait_for_timeout(2000)
            else:
                print(f"    FALLO {nro}: {e}")
                await cerrar_modales(page)
                return False

    return False


async def tomar_vista_en_pagina(page, downloads_dir):
    """
    Clickea todos los botones 'Tomar Vista' habilitados en la página actual.
    Re-consulta el DOM después de cada click para evitar referencias inválidas.
    """
    async def accept_dialog(dialog):
        await dialog.accept()
    page.on("dialog", accept_dialog)

    descargados = 0
    fallidos = 0
    ya_clickeados = set()

    while True:
        await cerrar_modales(page)

        nro = await page.evaluate(f"""
            () => {{
                const ya = {json.dumps(list(ya_clickeados))};
                const filas = document.querySelectorAll('table tbody tr');
                for (const fila of filas) {{
                    const nroTd = fila.querySelector('td');
                    if (!nroTd) continue;
                    const nro = nroTd.innerText.trim();
                    if (ya.includes(nro)) continue;

                    const btn = fila.querySelector("a[ng-click='exportar(e)']");
                    if (!btn) continue;
                    if (btn.classList.contains('disabled')) continue;
                    const icono = fila.querySelector('i.glyphicon-download');
                    if (!icono) continue;

                    return nro;
                }}
                return null;
            }}
        """)

        if nro is None:
            break

        ya_clickeados.add(nro)
        pdf_esperado = downloads_dir / f"bruno_expediente_{nro.replace('/', '_')}.pdf"
        if pdf_esperado.exists():
            continue

        print(f"    Descargando: {nro}")
        ok = await intentar_descarga(page, nro, downloads_dir)
        if ok:
            descargados += 1
        else:
            fallidos += 1

        await cerrar_modales(page)

        for extra_page in page.context.pages[2:]:
            await extra_page.close()

        await page.wait_for_timeout(600)

    page.remove_listener("dialog", accept_dialog)
    if fallidos > 0:
        print(f"    ({fallidos} fallidos en esta pagina)")
    return descargados


async def descargar_todos(page, downloads_dir):
    """Recorre TODAS las páginas de la tabla y descarga los PDFs."""
    print("[3/3] Descargando expedientes — recorriendo todas las paginas...")

    tab_link = page.locator("ul.nav-tabs li a, .nav-tabs a").first
    if await tab_link.count() > 0:
        await tab_link.click()
        await page.wait_for_timeout(1500)

    btn_100 = page.locator("button[ng-click='params.count(count)']").filter(has_text="100").first
    if await btn_100.count() > 0:
        await btn_100.click()
        await page.wait_for_timeout(1500)

    link_pag1 = page.locator("a[ng-switch-when='first'][lang='notab']").first
    if await link_pag1.count() > 0:
        await link_pag1.click()
        await page.wait_for_timeout(1500)

    total_descargados = 0
    pagina_actual = 1

    while True:
        await page.wait_for_selector("table tbody tr", timeout=10000)
        await page.wait_for_timeout(800)
        print(f"  [pag {pagina_actual}] procesando...")

        desc = await tomar_vista_en_pagina(page, downloads_dir)
        total_descargados += desc
        print(f"  [pag {pagina_actual}] {desc} expedientes descargados")

        siguiente_num = pagina_actual + 1
        next_link = page.locator(
            f"a[ng-switch-when='page'][lang='notab']:has-text('{siguiente_num}'),"
            f"a[ng-switch-when='last'][lang='notab']:has-text('{siguiente_num}')"
        ).first

        if await next_link.count() == 0:
            break

        await next_link.click()
        await page.wait_for_timeout(1500)
        pagina_actual += 1

    print(f"[3/3] Total expedientes descargados: {total_descargados}")
    return total_descargados


async def main():
    cuit  = CUIT or input("CUIT: ").strip()
    clave = CLAVE_FISCAL or getpass.getpass("Clave fiscal: ").strip()
    if not cuit or not clave:
        print("ERROR: CUIT y clave requeridos.")
        return

    async with async_playwright() as p:
        downloads_dir = OUTPUT_DIR / "vistas"
        downloads_dir.mkdir(exist_ok=True)

        browser = await p.chromium.launch(headless=HEADLESS)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 800},
            locale="es-AR",
            timezone_id="America/Argentina/Buenos_Aires",
            accept_downloads=True,
        )
        page = await context.new_page()

        async def bloquear(route):
            if route.request.resource_type in ("image", "media"):
                await route.abort()
            else:
                await route.continue_()
        await context.route("**/*", bloquear)

        try:
            await login_arca(page, cuit, clave)
            srt_page = await navegar_srt(page)
            total = await descargar_todos(srt_page, downloads_dir)

            print(f"\nListo.")
            print(f"  Expedientes descargados: {total}")
            print(f"  Carpeta: {downloads_dir.absolute()}")

        except PlaywrightTimeout as e:
            try:
                await page.screenshot(path=str(OUTPUT_DIR / "error.png"))
            except Exception:
                pass
            print(f"ERROR timeout: {e}")

        except Exception as e:
            try:
                target = srt_page if 'srt_page' in dir() else page
                await target.screenshot(path=str(OUTPUT_DIR / "error.png"))
            except Exception:
                pass
            print(f"ERROR: {e}")
            import traceback; traceback.print_exc()

        finally:
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
