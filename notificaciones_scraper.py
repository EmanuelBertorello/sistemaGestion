"""
Scraper de notificaciones SRT - Comisiones Médicas
Cada 5 minutos:
  1. Login ARCA
  2. Va a Expedientes Médicos
  3. Detecta expedientes con notificaciones (ícono sobre con badge)
  4. Abre las notificaciones de cada uno
  5. Si la última es "Citación al Servicio de Homologación", la agrega al calendario de Josefina
"""

import asyncio
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout

# ─── Config ──────────────────────────────────────────────────────────────────
CUIT = "20283143873"
CLAVE_FISCAL = "Brunoc2026"

HEADLESS = False
TIMEOUT = 30_000
INTERVALO_MINUTOS = 5

URL_LOGIN_ARCA  = "https://auth.afip.gob.ar/contribuyente_/login.xhtml"
URL_PORTAL      = "https://portalcf.cloud.afip.gob.ar/portal/app/"
URL_SRT_HOME    = "https://eservicios.srt.gob.ar/home/Servicios.aspx"
URL_EXPEDIENTES = "https://eservicios.srt.gob.ar/Patrocinio/Expedientes/Expedientes.aspx"

# Firestore
PROJECT_ID      = "bdcap-a3b7b"
JOSEFINA_EMAIL  = "restovichjosefina1@gmail.com"
FIREBASE_CFG    = os.path.join(os.path.expanduser("~"), ".config", "configstore", "firebase-tools.json")
CLIENT_ID       = "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com"
CLIENT_SECRET   = "j9iVZfS8kkCEFUPaAeJV0sAi"

# ─── Firebase helpers ────────────────────────────────────────────────────────
import urllib.request
import urllib.parse

def _firebase_token():
    with open(FIREBASE_CFG, "r") as f:
        cfg = json.load(f)
    rt = cfg["tokens"]["refresh_token"]
    body = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "refresh_token": rt,
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
    }).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body,
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())["access_token"]


def _firestore_query(token, collection, filters):
    url = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents:runQuery"
    fs_filters = []
    for field, op, val_type, val in filters:
        fs_filters.append({
            "fieldFilter": {
                "field": {"fieldPath": field},
                "op": op,
                "value": {val_type: val}
            }
        })
    where = fs_filters[0] if len(fs_filters) == 1 else {"compositeFilter": {"op": "AND", "filters": fs_filters}}
    body = json.dumps({"structuredQuery": {"from": [{"collectionId": collection}], "where": where}}).encode()
    req = urllib.request.Request(url, data=body, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    })
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def _firestore_create(token, collection, fields):
    url = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents/{collection}"
    fs_fields = {}
    for k, v in fields.items():
        if isinstance(v, bool):
            fs_fields[k] = {"booleanValue": v}
        elif isinstance(v, int):
            fs_fields[k] = {"integerValue": str(v)}
        else:
            fs_fields[k] = {"stringValue": str(v)}
    body = json.dumps({"fields": fs_fields}).encode()
    req = urllib.request.Request(url, data=body, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    })
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def evento_ya_existe(token, expediente_nro, titulo_parcial):
    """Verifica si ya existe un evento de calendario para este expediente con este tipo."""
    try:
        results = _firestore_query(token, "cal_eventos", [
            ("email", "EQUAL", "stringValue", JOSEFINA_EMAIL),
            ("expedienteNro", "EQUAL", "stringValue", expediente_nro),
        ])
        if not isinstance(results, list):
            return False
        for r in results:
            doc = r.get("document")
            if not doc:
                continue
            titulo = doc.get("fields", {}).get("titulo", {}).get("stringValue", "")
            if titulo_parcial.lower() in titulo.lower():
                return True
    except Exception as e:
        print(f"    [WARN] Error verificando duplicado: {e}")
    return False


def agregar_evento_calendario(token, expediente_nro, damnificado, tipo_notif, fecha_notif):
    """Agrega un evento al calendario de Josefina."""
    titulo = f"Citación: {damnificado} (Exp {expediente_nro})"

    if evento_ya_existe(token, expediente_nro, "citación"):
        print(f"    [SKIP] Ya existe evento para {expediente_nro}")
        return False

    # La fecha de notificación viene como "DD/MM/YYYY HH:MM" — convertir a YYYY-MM-DD
    try:
        dt = datetime.strptime(fecha_notif.strip().split(" ")[0], "%d/%m/%Y")
        fecha_iso = dt.strftime("%Y-%m-%d")
    except Exception:
        fecha_iso = datetime.now().strftime("%Y-%m-%d")

    _firestore_create(token, "cal_eventos", {
        "email": JOSEFINA_EMAIL,
        "titulo": titulo,
        "fecha": fecha_iso,
        "hora": "",
        "tipo": "audiencia",
        "expedienteNro": expediente_nro,
        "descripcion": f"{tipo_notif} — {fecha_notif}",
    })
    print(f"    [OK] Evento creado: {titulo} ({fecha_iso})")
    return True


# ─── Playwright helpers ──────────────────────────────────────────────────────

async def login_arca(page):
    print("[1/3] Login ARCA...")
    await page.goto(URL_LOGIN_ARCA, wait_until="domcontentloaded")

    cuit_input = page.locator("input:not([type='hidden']):not([type='submit']):not([type='button'])").first
    await cuit_input.wait_for(state="visible", timeout=TIMEOUT)
    await cuit_input.fill(CUIT)

    siguiente = page.locator("button:has-text('Siguiente'), input[value='Siguiente'], input[type='submit'], button[type='submit']").first
    await siguiente.wait_for(state="visible", timeout=TIMEOUT)
    await siguiente.click()
    await page.wait_for_load_state("domcontentloaded")
    await page.wait_for_timeout(2000)

    pass_input = page.locator("input[type='password']").first
    await pass_input.wait_for(state="visible", timeout=TIMEOUT)
    await pass_input.fill(CLAVE_FISCAL)

    ingresar = page.locator("button:has-text('Ingresar'), input[value='Ingresar'], input[type='submit'], button[type='submit']").first
    await ingresar.wait_for(state="visible", timeout=TIMEOUT)
    await ingresar.click()
    await page.wait_for_load_state("domcontentloaded")
    await page.wait_for_timeout(3000)
    print(f"[1/3] Login OK — {page.url}")


async def navegar_expedientes(page):
    print("[2/3] Navegando a expedientes SRT...")
    await page.goto(URL_PORTAL, wait_until="domcontentloaded")
    await page.wait_for_timeout(4000)

    buscador = page.locator("input[type='search'], input[placeholder*='uscar']").first
    if await buscador.count() > 0:
        await buscador.fill("SRT")
        await page.wait_for_timeout(2000)

    srt_card = page.locator("a:has(h3:has-text('e-Servicios SRT')), h3:has-text('e-Servicios SRT')").first
    await srt_card.wait_for(state="visible", timeout=TIMEOUT)

    async with page.context.expect_page() as nueva_tab_info:
        await srt_card.click()
    srt_page = await nueva_tab_info.value
    await srt_page.wait_for_load_state("domcontentloaded")
    await srt_page.wait_for_timeout(3000)

    if "eservicios.srt.gob.ar" not in srt_page.url:
        await srt_page.goto(URL_SRT_HOME, wait_until="domcontentloaded")
        await srt_page.wait_for_timeout(3000)

    await srt_page.goto(URL_EXPEDIENTES, wait_until="domcontentloaded", referer=URL_SRT_HOME)
    await srt_page.wait_for_timeout(4000)
    print(f"[2/3] En expedientes: {srt_page.url}")
    return srt_page


async def cerrar_modales(page):
    await page.evaluate("""
        () => {
            document.querySelectorAll('.swal2-container').forEach(el => el.remove());
            document.querySelectorAll('.swal2-backdrop-show').forEach(el => el.remove());
            document.body.classList.remove('swal2-shown', 'swal2-height-auto');
            document.body.style.overflow = '';
        }
    """)
    cerrar = page.locator("button.close:visible, [data-dismiss='modal']:visible").first
    if await cerrar.count() > 0:
        try:
            await cerrar.click(timeout=3000)
            await page.wait_for_timeout(400)
        except Exception:
            pass


async def set_100_por_pagina(srt_page):
    btn_100 = srt_page.locator("button[ng-click='params.count(count)']").filter(has_text="100").first
    if await btn_100.count() > 0:
        await btn_100.click()
        await srt_page.wait_for_timeout(2000)


async def obtener_siguiente_con_badge(srt_page, ya_procesados):
    """Busca en la tabla actual el primer expediente con badge que no hayamos procesado.
    Retorna nroExp, damnificado y la URL de comunicaciones."""
    result = await srt_page.evaluate(f"""
        () => {{
            const ya = {json.dumps(list(ya_procesados))};
            const filas = document.querySelectorAll('table tbody tr');
            for (const fila of filas) {{
                const tds = fila.querySelectorAll('td');
                if (tds.length < 4) continue;
                const nro = tds[0]?.innerText?.trim() || '';

                const badges = fila.querySelectorAll('.badge');
                let hasBadge = false;
                for (const b of badges) {{
                    const n = parseInt(b.textContent.trim());
                    if (n > 0) {{ hasBadge = true; break; }}
                }}

                if (hasBadge && !ya.includes(nro)) {{
                    const damnificado = tds[3]?.innerText?.trim() || '';
                    // Extraer la URL del link de comunicaciones
                    const links = fila.querySelectorAll('a[href*="Comunicacion"]');
                    const url = links.length > 0 ? links[0].href : '';
                    return {{ nroExp: nro, damnificado: damnificado, url: url }};
                }}
            }}
            return null;
        }}
    """)
    return result


async def leer_primera_notificacion_frame(frame):
    """Lee la primera fila de la tabla de comunicaciones desde un frame."""
    try:
        return await frame.evaluate("""
            () => {
                const allRows = document.querySelectorAll('table tr');
                for (const row of allRows) {
                    const tds = row.querySelectorAll('td');
                    if (tds.length < 5) continue;
                    const first = tds[0]?.innerText?.trim() || '';
                    if (!/\\d{2}\\/\\d{2}\\/\\d{4}/.test(first)) continue;
                    return {
                        fechaNotif: first,
                        expediente: tds[1]?.innerText?.trim() || '',
                        remitente: tds[2]?.innerText?.trim() || '',
                        sector: tds[3]?.innerText?.trim() || '',
                        tipoComunicacion: tds[4]?.innerText?.trim() || '',
                        estado: tds[5]?.innerText?.trim() || '',
                        fechaEstado: tds[6]?.innerText?.trim() || '',
                    };
                }
                return null;
            }
        """)
    except Exception:
        return None


async def leer_primera_notificacion(page):
    """Lee la primera fila de la tabla de comunicaciones."""
    # Esperar a que la página cargue
    try:
        await page.wait_for_selector("table tr td", timeout=15000)
    except Exception:
        pass
    await page.wait_for_timeout(2000)

    return await page.evaluate("""
        () => {
            // Buscar filas con 5+ celdas en cualquier tabla (ASP.NET no siempre usa tbody)
            const allRows = document.querySelectorAll('table tr');
            for (const row of allRows) {
                const tds = row.querySelectorAll('td');
                if (tds.length < 5) continue;

                // Verificar que parece una fila de comunicaciones (tiene fecha en primer td)
                const first = tds[0]?.innerText?.trim() || '';
                if (!/\\d{2}\\/\\d{2}\\/\\d{4}/.test(first)) continue;

                return {
                    fechaNotif: first,
                    expediente: tds[1]?.innerText?.trim() || '',
                    remitente: tds[2]?.innerText?.trim() || '',
                    sector: tds[3]?.innerText?.trim() || '',
                    tipoComunicacion: tds[4]?.innerText?.trim() || '',
                    estado: tds[5]?.innerText?.trim() || '',
                    fechaEstado: tds[6]?.innerText?.trim() || '',
                };
            }
            return null;
        }
    """)


async def buscar_notificaciones(srt_page, firebase_token):
    """Recorre expedientes, detecta los que tienen badge de notificación,
    abre sus comunicaciones y si hay citación, la agrega al calendario."""
    print("[3/3] Buscando expedientes con notificaciones...")

    await cerrar_modales(srt_page)
    await set_100_por_pagina(srt_page)

    total_eventos = 0
    ya_procesados = set()

    # Dump HTML de la primera fila para entender la estructura del badge
    debug_html = await srt_page.evaluate("""
        () => {
            const fila = document.querySelector('table tbody tr');
            return fila ? fila.innerHTML : 'NO HAY FILAS';
        }
    """)
    print(f"  [DEBUG] Primera fila HTML:\n{debug_html[:1500]}\n")

    while True:
        await srt_page.wait_for_selector("table tbody tr", timeout=15000)
        await srt_page.wait_for_timeout(1500)

        exp = await obtener_siguiente_con_badge(srt_page, ya_procesados)
        if not exp:
            print("  No quedan más expedientes con notificaciones por procesar.")
            break

        nro = exp["nroExp"]
        damnificado = exp["damnificado"]
        notif_url = exp.get("url", "")
        ya_procesados.add(nro)
        print(f"  Revisando {nro} — {damnificado}...")

        if not notif_url:
            print(f"    [WARN] Sin URL de comunicaciones para {nro}")
            continue

        # Navegar directamente a la URL de comunicaciones
        try:
            await srt_page.goto(notif_url, wait_until="domcontentloaded", timeout=20000)
            await srt_page.wait_for_timeout(4000)

            print(f"    URL: {srt_page.url}")

            # Clickear BUSCAR si está disponible (a veces la tabla no carga sin esto)
            buscar_btn = srt_page.locator("input[value='BUSCAR'], input[type='submit'][value*='BUSCAR']").first
            if await buscar_btn.count() > 0:
                await buscar_btn.click()
                await srt_page.wait_for_timeout(3000)

            await srt_page.screenshot(path="output/debug_notif.png")

            # Detectar frames
            frames = srt_page.frames
            print(f"    Frames: {len(frames)} — {[f.url[:80] for f in frames]}")

            # Buscar la tabla en todos los frames
            notif_data = None
            for frame in frames:
                notif_data = await leer_primera_notificacion_frame(frame)
                if notif_data:
                    print(f"    Encontrado en frame: {frame.url[:80]}")
                    break

            if notif_data:
                tipo = notif_data["tipoComunicacion"].lower()
                print(f"    Última notif: {notif_data['tipoComunicacion']} ({notif_data['fechaNotif']})")

                if "citación" in tipo or "citacion" in tipo:
                    ok = agregar_evento_calendario(
                        firebase_token, nro, damnificado,
                        notif_data["tipoComunicacion"], notif_data["fechaNotif"],
                    )
                    if ok:
                        total_eventos += 1
                else:
                    print(f"    [SKIP] No es citación: {notif_data['tipoComunicacion']}")
            else:
                print(f"    [WARN] No se pudo leer la tabla de notificaciones")

        except PlaywrightTimeout:
            print(f"    [WARN] Timeout en {nro}")
            await srt_page.screenshot(path="output/debug_timeout.png")

        # Volver a expedientes
        await srt_page.goto(URL_EXPEDIENTES, wait_until="domcontentloaded", referer=URL_SRT_HOME)
        await srt_page.wait_for_timeout(3000)
        await cerrar_modales(srt_page)
        await set_100_por_pagina(srt_page)

    return total_eventos


# ─── Main loop ───────────────────────────────────────────────────────────────

async def ejecutar_una_vez():
    """Ejecuta un ciclo completo de scraping."""
    print(f"\n{'='*60}")
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Iniciando scraping de notificaciones...")
    print(f"{'='*60}")

    firebase_token = _firebase_token()
    print("[OK] Token Firebase obtenido")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=HEADLESS)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 800},
            locale="es-AR",
            timezone_id="America/Argentina/Buenos_Aires",
            accept_downloads=True,
        )
        page = await context.new_page()

        # Bloquear imágenes para más velocidad
        async def bloquear(route):
            if route.request.resource_type in ("image", "media"):
                await route.abort()
            else:
                await route.continue_()
        await context.route("**/*", bloquear)

        try:
            await login_arca(page)
            srt_page = await navegar_expedientes(page)
            total = await buscar_notificaciones(srt_page, firebase_token)
            print(f"\n[RESULTADO] {total} citaciones agregadas al calendario de Josefina")

        except PlaywrightTimeout as e:
            print(f"[ERROR] Timeout: {e}")
        except Exception as e:
            print(f"[ERROR] {e}")
            import traceback
            traceback.print_exc()
        finally:
            await browser.close()


async def main():
    una_vez = "--once" in sys.argv

    if una_vez:
        await ejecutar_una_vez()
    else:
        print(f"Scraper de notificaciones SRT — ejecutando cada {INTERVALO_MINUTOS} minutos")
        print(f"Calendario: {JOSEFINA_EMAIL}")
        print(f"Ctrl+C para detener\n")

        while True:
            try:
                await ejecutar_una_vez()
            except Exception as e:
                print(f"[ERROR CICLO] {e}")

            print(f"\n[ESPERA] Próximo ciclo en {INTERVALO_MINUTOS} minutos...")
            await asyncio.sleep(INTERVALO_MINUTOS * 60)


if __name__ == "__main__":
    asyncio.run(main())
