/* Pruebas de aceptación de M·OS v10.
   Uso:  node tests/acceptance.js
   Levanta un servidor local con una copia de index.html apuntando a un Supabase SIMULADO
   (en memoria) y maneja un Chromium real. No toca tu base de datos real. */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const MOCK = 'https://mock.supabase.co';
const results = [];
const ok = (name, cond, extra) => { results.push({ name, pass: !!cond, extra }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra && !cond ? '  → ' + extra : '')); };

/* ── Supabase simulado: tabla mos_kv en memoria + bitácora de llamadas ── */
function makeCloud() {
  const c = { rows: new Map(), log: [], down: false };
  c.put = (key, value, ts) => c.rows.set(key, { key, value, updated_at: new Date(ts || Date.now()).toISOString() });
  c.handler = async (route) => {
    const req = route.request(), cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (c.down) return route.abort('connectionrefused');
    const url = new URL(req.url());
    if (!url.pathname.endsWith('/rest/v1/mos_kv')) return route.fulfill({ status: 404, headers: cors, body: '{}' });
    if (req.method() === 'GET') {
      const off = +url.searchParams.get('offset') || 0, lim = +url.searchParams.get('limit') || 1000;
      const all = [...c.rows.values()].sort((a, b) => a.key.localeCompare(b.key)).slice(off, off + lim);
      c.log.push({ t: 'GET', n: all.length });
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(all) });
    }
    if (req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '[]');
      body.forEach(r => c.rows.set(r.key, { key: r.key, value: r.value, updated_at: r.updated_at }));
      c.log.push({ t: 'POST', keys: body.map(r => r.key) });
      return route.fulfill({ status: 201, headers: cors, body: '' });
    }
    return route.fulfill({ status: 405, headers: cors, body: '' });
  };
  c.val = k => (c.rows.get(k) || {}).value;
  return c;
}

/* ── servidor estático con la app configurada hacia el simulado ── */
function serve() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mos-'));
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  html = html.replace(/const SB_URL='[^']*';/, `const SB_URL='${MOCK}';`).replace(/const SB_KEY='[^']*';/, "const SB_KEY='test-key';");
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  fs.copyFileSync(path.join(ROOT, 'sw.js'), path.join(dir, 'sw.js'));
  return new Promise(res => {
    const srv = http.createServer((q, r) => {
      const f = path.join(dir, q.url === '/' ? 'index.html' : q.url.split('?')[0]);
      if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); }
      r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); r.end(fs.readFileSync(f));
    }).listen(0, () => res({ srv, url: 'http://localhost:' + srv.address().port + '/' }));
  });
}

const FIXED = new Date('2026-10-27T20:00:00Z'); // = martes 27 oct 2026, 14:00 hora de México

async function newCtx(browser, cloud, opts) {
  const ctx = await browser.newContext({ timezoneId: 'America/Mexico_City', locale: 'es-MX', viewport: { width: 400, height: 860 }, serviceWorkers: 'block', ...(opts || {}) });
  await ctx.route(MOCK + '/**', cloud.handler);
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  return ctx;
}
async function open(ctx, url, time) {
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());
  page.errors = []; page.on('pageerror', e => page.errors.push(e.message));
  await page.clock.install({ time: time || FIXED });
  await page.goto(url);
  return page;
}
async function pin(page) {
  for (const d of '2227') await page.click('.pin-btn:text-is("' + d + '")');
  await page.waitForFunction(() => document.getElementById('app').style.display === 'flex' && document.getElementById('splash').style.display === 'none', null, { timeout: 8000 });
  await page.waitForTimeout(150);
}
const nav = (page, p) => page.click('.nb[data-p="' + p + '"]');
const settle = (page, ms) => page.waitForTimeout(ms || 350);
const text = (page, sel) => page.locator(sel).innerText();

(async () => {
  const { srv, url } = await serve();
  const browser = await chromium.launch();
  const cloud = makeCloud();

  /* ═══ 1. Primer arranque: descargar ANTES de subir; semillas ═══ */
  let ctx = await newCtx(browser, cloud);
  let page = await open(ctx, url);
  await pin(page); await settle(page, 800);
  const firstWrite = cloud.log.findIndex(l => l.t === 'POST'), firstGet = cloud.log.findIndex(l => l.t === 'GET');
  ok('1a. La primera llamada a la nube es una DESCARGA (GET), nunca una subida', firstGet === 0 && (firstWrite === -1 || firstWrite > firstGet), JSON.stringify(cloud.log.slice(0, 3)));
  ok('1b. Primer arranque con BD vacía: se siembran metas, split, rutina, nota, identidad', ['goals', 'goals_long', 'routine', 'nota', 'identity'].every(k => cloud.rows.has(k)), [...cloud.rows.keys()].join(','));
  ok('1c. No se subió ningún día/hábito vacío al arrancar', ![...cloud.rows.keys()].some(k => k.startsWith('day:') || k.startsWith('gym:')));
  ok('1d. Sin errores de JavaScript', page.errors.length === 0, page.errors.join(' | '));

  /* ═══ 2. Hábitos: lista nueva, marcar, recargar ═══ */
  await nav(page, 'hab'); await settle(page);
  const habTexts = await page.locator('#habLists .cl').allInnerTexts();
  ok('2a. Son 14 hábitos (sin cardio)', habTexts.length === 14, String(habTexts.length));
  ok('2b. Agrupados MAÑANA / DÍA / NOCHE', JSON.stringify(await page.locator('#habLists .hgroup').allInnerTexts()) === JSON.stringify(['MAÑANA', 'DÍA', 'NOCHE']));
  ok('2c. "Manifestación y visualización" lleva la etiqueta NO NEGOCIABLE', (await page.locator('#habLists .ci.nn .nnb').innerText()).includes('NO NEGOCIABLE'));
  ok('2d. No hay separación prioridad/general', !/Prioridad|Generales/i.test(await text(page, '#p-hab')));
  const rows = page.locator('#habLists .ci');
  await rows.nth(0).click(); await rows.nth(2).click(); await rows.nth(8).click();   // despertar, estudiar 30, agua
  await settle(page, 500);
  ok('2e. Estatus del día: 3/14 = 21%', (await text(page, '#dayStatus')).includes('3/14') && (await text(page, '#dayStatus')).includes('21%'), await text(page, '#dayStatus'));
  ok('2f. Estatus del día muestra la fecha local de hoy (2026-10-27)', (await text(page, '#dayStatus')).includes('2026-10-27'));
  ok('2g. Estatus del día muestra hora de guardado', /guardado \d\d:\d\d/.test(await text(page, '#dayStatus')));
  ok('2h. Sin lo no negociable a las 2 pm: aviso dorado, NO rojo', (await text(page, '#dayStatus')).includes('NO NEGOCIABLE pendiente') && !(await text(page, '#dayStatus')).includes('FALTA LO NO NEGOCIABLE'));
  const dayRec = cloud.val('day:2026-10-27');
  ok('2i. Se guardó en la nube al instante, con id estable y nombres vigentes ese día', dayRec && dayRec.checked.wake && dayRec.checked.study30 && dayRec.checked.water && dayRec.habits.length === 14 && dayRec.habits[1].name === 'Manifestación y visualización', JSON.stringify(dayRec && dayRec.checked));
  await page.reload(); await pin(page); await nav(page, 'hab'); await settle(page);
  ok('2j. Tras RECARGAR persisten las 3 marcas', (await page.locator('#habLists .ci.done').count()) === 3);

  /* ═══ 3. Almacenamiento limpio (equivale a incógnito / reinstalar) ═══ */
  const ctx2 = await newCtx(browser, cloud);
  const page2 = await open(ctx2, url);
  await pin(page2); await nav(page2, 'hab'); await settle(page2);
  ok('3a. Navegador SIN datos locales: los hábitos vuelven desde Supabase', (await page2.locator('#habLists .ci.done').count()) === 3);
  await ctx2.close();

  /* ═══ 4. Entrenamiento eliminado ═══ */
  ok('4a. No hay pestaña GYM en el menú ni página de entrenamiento', (await page.locator('.nb[data-p="train"]').count()) === 0 && (await page.locator('#p-train').count()) === 0);
  ok('4b. El menú queda con 7 botones', (await page.locator('#nav .nb').count()) === 7);
  ok('4c. Una BD nueva no recibe split de gym', !cloud.rows.has('gym_split'));
  await nav(page, 'dash'); await settle(page);
  ok('4d. El dashboard no muestra "Hoy en el gym"', !/gym/i.test(await text(page, '#p-dash')));

  /* ═══ 5. Metas ═══ */
  await nav(page, 'metas'); await settle(page);
  const titles = await page.locator('#metasContent .meta-title').allInnerTexts();
  ok('5a. Categorías NEGOCIO — Covant / MENTE (CUERPO fuera)', JSON.stringify(titles) === JSON.stringify(['NEGOCIO — Covant', 'MENTE']), JSON.stringify(titles));
  ok('5b. 4 metas (3 + 1)', (await page.locator('#metasContent .cl').count()) === 4);
  ok('5c. Fechas: Covant 2026-11-25, contrato 2027-02-28, millón 2027-05-22; cuerpo y mente sin fecha',
    JSON.stringify(await page.locator('#metasContent input[type=date]').evaluateAll(l => l.map(i => i.value))) === JSON.stringify(['2026-11-25', '2027-02-28', '2027-05-22', '']));
  await page.locator('#metasContent .meta-main').nth(1).locator('button:has-text("AGREGAR")').click();
  await page.fill('#mf_text', 'Curso de ventas'); await page.fill('#mf_date', '2027-01-15'); await page.click('#modalContent button:has-text("Guardar")'); await settle(page);
  ok('5d. Agregar meta', (await text(page, '#metasContent')).includes('Curso de ventas'));
  await page.locator('#metasContent .meta-main').nth(1).locator('.ib').first().click();
  await page.fill('#mf_text', 'Buena base de marketing digital'); await page.click('#modalContent button:has-text("Guardar")'); await settle(page);
  ok('5e. Editar meta', (await text(page, '#metasContent')).includes('Buena base de marketing digital'));
  await page.locator('#metasContent .meta-main').nth(1).locator('.ci').first().click(); await settle(page);
  ok('5f. Marcar meta (checkbox) actualiza progreso por categoría', (await text(page, '#metasContent .meta-main >> nth=1')).includes('1/2'));
  await page.locator('#metasContent .meta-main').nth(1).locator('button.ib.del').last().click(); await settle(page);
  ok('5g. Eliminar meta (se archiva, no se pierde)', !(await text(page, '#metasContent')).includes('Curso de ventas') && JSON.stringify(cloud.val('goals_archive') || '').includes('Curso de ventas'));
  await page.reload(); await pin(page); await nav(page, 'metas'); await settle(page);
  ok('5h. Tras recargar: editada y marcada persisten, eliminada sigue eliminada', (await text(page, '#metasContent')).includes('marketing digital') && !(await text(page, '#metasContent')).includes('Curso de ventas') && (await text(page, '#metasContent .meta-main >> nth=1')).includes('1/1'));
  ok('5i. Metas anteriores no se muestran (clientes, MRR, lectura…)', !/Cerrar 15 clientes|MRR|Inglés|Lectura/i.test(await text(page, '#p-metas')));

  /* ═══ 6. Tab $ sincronizada con la meta del millón ═══ */
  await nav(page, 'fin'); await settle(page);
  ok('6a. 100 cuadros', (await page.locator('#finContent .sq').count()) === 100);
  await page.locator('#finContent input[type=number]').fill('345000'); await page.locator('#finContent input[type=number]').press('Tab'); await settle(page);
  ok('6b. Muestra "$345k / $1M" y 35%', (await text(page, '#finContent')).includes('$345k') && (await text(page, '#finContent')).includes('/ $1M') && (await text(page, '#finContent')).includes('35%'), (await text(page, '#finContent')).slice(0, 120));
  ok('6c. 34 cuadros llenos + 1 parcial (50%)', (await page.locator('#finContent .sq.full').count()) === 34 && (await page.locator('#finContent .sq i').count()) === 35);
  await page.click('#finContent button:has-text("+$10k")'); await settle(page);
  ok('6d. +$10k suma un cuadro', (await page.locator('#finContent .sq.full').count()) === 35 && (await text(page, '#finContent')).includes('$355k'));
  await nav(page, 'metas'); await settle(page);
  ok('6e. Sincronizado con el monto de la meta en Metas (355000)', (await page.locator('#metasContent input[type=number]').inputValue()) === '355000');
  await page.locator('#metasContent input[type=number]').fill('400000'); await page.locator('#metasContent input[type=number]').press('Tab'); await nav(page, 'fin'); await settle(page);
  ok('6f. …y al revés: cambiar en Metas actualiza la tab $', (await text(page, '#finContent')).includes('$400k') && (await page.locator('#finContent .sq.full').count()) === 40);
  await page.reload(); await pin(page); await nav(page, 'fin'); await settle(page);
  ok('6g. Persiste tras recargar', (await text(page, '#finContent')).includes('$400k'));

  /* ═══ 7. Dashboard ═══ */
  await nav(page, 'dash'); await settle(page);
  const pend = await page.locator('#pendingBox .pend').allInnerTexts();
  ok('7a. Pendientes próximos: Covant terminado / 1 cliente con contrato / 1,000,000 MXN con cuenta regresiva',
    pend.length === 3 && pend[0].includes('Covant terminado') && pend[0].includes('29d') && pend[1].includes('1 cliente con contrato') && pend[1].includes('124d') && pend[2].includes('1,000,000 MXN') && pend[2].includes('207d'), JSON.stringify(pend));
  ok('7b. Pendientes viejos fuera (contrato de socios, trademark, shelby…)', !/notariado|IMPI|Shelby|artes marciales/i.test(await text(page, '#p-dash')));
  ok('7c. Progreso de metas con las 2 categorías (negocio, mente)', JSON.stringify((await page.locator('#metaGrid .pclbl').allInnerTexts()).map(t => t.toLowerCase())) === JSON.stringify(['negocio', 'mente']));

  /* ═══ 8. Rutina editable ═══ */
  await nav(page, 'rutina'); await settle(page);
  ok('8a. Rutina con los bloques pedidos (sin cardio) + Restaurante del abuelo', (await page.locator('#rutinaContent .rut-item').count()) === 14 && !/Cardio/i.test(await text(page, '#rutinaContent')) && (await text(page, '#rutinaContent')).includes('Restaurante del abuelo'));
  ok('8b. Bloque NO NEGOCIABLE destacado y con etiqueta', (await page.locator('#rutinaContent .rut-item.hl .nnb').innerText()).includes('NO NEGOCIABLE'));
  await page.locator('#rutinaContent .rut-item').last().locator('button[onclick^="editBlock"]').click();
  await page.fill('#mf_time', '7:00–10:00 pm'); await page.click('#modalContent button:has-text("Guardar")'); await settle(page);
  await page.click('#rutinaContent button:has-text("+ Bloque")'); await page.fill('#mf_time', '3:00 pm'); await page.fill('#mf_title', 'Siesta de prueba'); await page.click('#modalContent button:has-text("Guardar")'); await settle(page);
  await page.locator('#rutinaContent .rut-item').last().locator('button').first().click(); await settle(page); // ▲
  await page.reload(); await pin(page); await nav(page, 'rutina'); await settle(page);
  const rt = await page.locator('#rutinaContent .rut-item').allInnerTexts();
  ok('8c. Editar hora, agregar y reordenar bloque persisten tras recargar', rt.length === 15 && rt[13].includes('Siesta de prueba') && rt[14].includes('7:00–10:00 pm'), JSON.stringify(rt.slice(13)));
  const delN = (await page.locator('#rutinaContent .rut-item').count());
  await page.locator('#rutinaContent .rut-item').nth(13).locator('button.ib.del').click(); await settle(page);
  ok('8d. Quitar bloque', (await page.locator('#rutinaContent .rut-item').count()) === delN - 1);

  /* ═══ 9. Historial de días anteriores con SU lista (y la anterior) ═══ */
  const oldHabits = [{ id: 'wake', name: 'Levantarme 5 am (nombre viejo)', group: 'MAÑANA', nn: false }, { id: 'manif', name: 'Manifestación y visualización', group: 'MAÑANA', nn: true }, { id: 'x1', name: 'Hábito que ya no existe', group: 'DÍA', nn: false }];
  cloud.put('day:2026-10-26', { v: 2, date: '2026-10-26', habits: oldHabits, checked: { wake: true, x1: true }, done: 2, total: 3, pct: 67, nn_done: false, saved_at: '2026-10-26T22:10:00.000Z' });
  cloud.put('day:2026-10-25', { v: 2, date: '2026-10-25', habits: oldHabits, checked: { manif: true }, done: 1, total: 3, pct: 33, nn_done: true, saved_at: '2026-10-25T22:00:00.000Z' });
  cloud.put('day:2026-10-20', { legacy: true, date: '2026-10-20', hab_checked: { pri_0: true, pri_1: true, gen_1: true }, pri_done: 2, pri_total: 11, gen_done: 1, gen_total: 5, pct: 18, saved_at: '2026-10-20T20:00:00.000Z' });
  await page.reload(); await pin(page); await nav(page, 'hab'); await settle(page);
  await page.click('button:has-text("Ver historial")'); await settle(page, 250);
  const hist = await text(page, '#modalContent');
  ok('9a. Historial lista los días guardados (incluido hoy)', hist.includes('2026-10-26') && hist.includes('2026-10-25') && hist.includes('2026-10-20') && hist.includes('HOY'));
  ok('9b. Día pasado sin lo no negociable se muestra en ROJO "FALTA LO NO NEGOCIABLE"', (await page.locator('#modalContent div:has-text("FALTA LO NO NEGOCIABLE")').count()) > 0 && hist.indexOf('FALTA LO NO NEGOCIABLE') < hist.indexOf('2026-10-25'));
  await page.locator('#modalContent div[onclick^="expandHabDay"]', { hasText: '2026-10-26' }).first().click(); await settle(page, 200);
  const d26 = await text(page, '#modalContent');
  ok('9c. Al tocar un día: ✓ hechos y ✗ faltantes con los nombres de ESE día', d26.includes('✓ Levantarme 5 am (nombre viejo)') && d26.includes('✗ Manifestación y visualización') && d26.includes('✓ Hábito que ya no existe'), d26.slice(0, 300));
  await page.locator('#modalContent div[onclick^="expandHabDay"]', { hasText: '2026-10-20' }).first().click(); await settle(page, 200);
  const d20 = await text(page, '#modalContent');
  ok('9d. Día guardado ANTES del cambio sigue mostrando la lista anterior', d20.includes('✓ Planear el día — definir tarea única') && d20.includes('✗ Meditar') === false && d20.includes('✓ Meditar') && d20.includes('lista anterior'), d20.slice(-400));
  await page.click('#modalOverlay', { position: { x: 5, y: 5 } });
  /* racha derivada de lo no negociable */
  cloud.put('day:2026-10-26', { ...cloud.val('day:2026-10-26'), nn_done: true });
  await page.reload(); await pin(page); await nav(page, 'dash'); await settle(page);
  ok('9e. Racha cuenta días consecutivos con lo no negociable (25 y 26 = 2)', (await text(page, '#streakNum')).startsWith('2'), await text(page, '#streakNum'));

  /* ═══ 10. Referencias prohibidas en la interfaz ═══ */
  let leaks = [];
  for (const p of ['dash', 'hab', 'metas', 'fin', 'nota', 'rutina', 'pend', 'stats', 'sem', 'id']) {
    await page.evaluate(p => goTo(p), p); await settle(page, 120);
    const body = (await text(page, '#p-' + p)) + ' ' + (await page.locator('#nav').innerText());
    if (/afirm|sentadilla|bench|squat/i.test(body)) leaks.push(p);
  }
  ok('10a. Ninguna pantalla (ni el menú) menciona afirmaciones, sentadilla ni bench', leaks.length === 0, leaks.join(','));
  await page.evaluate(() => goTo('extra')); await settle(page, 100);
  ok('10b. Largo plazo conserva solo "Retomar bench" de lo de entrenamiento', /Retomar bench/.test(await text(page, '#p-extra')) && !/sentadilla|pelea|militar|artes marciales/i.test(await text(page, '#p-extra')), await text(page, '#p-extra'));
  ok('10c. Largo plazo oculto: 5 metas', (await page.locator('#extraContent .cl').count()) === 5);
  await nav(page, 'dash'); ok('10d. …y no salen en el dashboard', !/Filantrop|empresario grande|Holding/i.test(await text(page, '#p-dash')));
  let tl = [];
  for (const p of ['dash', 'hab', 'metas', 'fin', 'nota', 'rutina', 'pend', 'stats', 'sem']) {
    await page.evaluate(p => goTo(p), p); await settle(page, 100);
    if (/gym|cardio|entrenar|entrenamiento|pierna|brazo|grasa corporal|f[ií]sico/i.test(await text(page, '#p-' + p))) tl.push(p);
  }
  ok('10f. Ninguna pantalla menciona gym, cardio, entrenar, piernas, brazos ni físico', tl.length === 0, tl.join(','));
  ok('10e. Sin errores de JS durante toda la sesión', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();

  /* ═══ 11. Hora local de México (el bug del día UTC) y cambio de medianoche ═══ */
  const cloud2 = makeCloud();
  const ctx3 = await newCtx(browser, cloud2);
  const p3 = await open(ctx3, url, new Date('2026-10-28T02:00:00Z')); // lunes→martes: 8:00 pm del 27 en México (ya es 28 en UTC)
  await pin(p3); await nav(p3, 'hab'); await settle(p3);
  ok('11a. 8 pm en México sigue siendo el día 27 (antes la app saltaba al 28 desde las 6 pm)', (await text(p3, '#dayStatus')).includes('2026-10-27'), await text(p3, '#dayStatus'));
  await p3.locator('#habLists .ci').nth(4).click(); await settle(p3, 400);
  ok('11b. A las 8 pm sin lo no negociable aún no es rojo (la regla roja es desde las 9 pm)', !(await text(p3, '#dayStatus')).includes('FALTA LO NO NEGOCIABLE'));
  await p3.clock.fastForward('01:05:00'); await settle(p3, 300);  // 9:05 pm
  await p3.evaluate(() => refreshStatusOnly());
  ok('11c. Pasadas las 9 pm sin lo no negociable → estatus en ROJO', (await text(p3, '#dayStatus')).includes('FALTA LO NO NEGOCIABLE'), await text(p3, '#dayStatus'));
  await p3.clock.fastForward('03:00:00'); await settle(p3, 600);  // 12:05 am del 28
  await p3.evaluate(() => { if (today() !== CUR_DAY) return rollDay(); }); await settle(p3, 500);
  ok('11d. Medianoche: el día nuevo arranca en 0/15', (await text(p3, '#dayStatus')).includes('2026-10-28') && (await text(p3, '#dayStatus')).includes('0/14'), await text(p3, '#dayStatus'));
  const prev = cloud2.val('day:2026-10-27');
  ok('11e. …y el día anterior quedó guardado en la nube con su marca', prev && prev.checked.covant === true, JSON.stringify(prev && prev.checked));
  await ctx3.close();

  /* ═══ 12. Sin conexión / nube caída ═══ */
  const cloud3 = makeCloud(); cloud3.down = true;
  const ctx4 = await newCtx(browser, cloud3);
  const p4 = await open(ctx4, url);
  for (const d of '2227') await p4.click('.pin-btn:text-is("' + d + '")');
  await p4.waitForSelector('#spRetry', { state: 'visible', timeout: 8000 });
  ok('12a. Nube caída y sin datos locales: NO se muestra una app vacía, sale pantalla de error con Reintentar', (await text(p4, '#spTitle')).toLowerCase().includes('no se pudieron descargar') && (await p4.locator('#app').evaluate(e => e.style.display)) === 'none');
  ok('12b. …y no se subió NADA a la nube', cloud3.log.filter(l => l.t === 'POST').length === 0);
  cloud3.down = false; await p4.click('#spRetry'); await p4.waitForFunction(() => document.getElementById('app').style.display === 'flex', null, { timeout: 8000 }); await settle(p4, 600);
  ok('12c. Al volver la nube y reintentar, arranca normal', (await p4.locator('#syncIndicator').innerText()).includes('✓') || (await p4.locator('#syncIndicator').innerText()).includes('↑'));
  await nav(p4, 'hab'); await settle(p4);
  cloud3.down = true;                                    // se cae la nube a media sesión
  await p4.locator('#habLists .ci').nth(1).click(); await settle(p4, 500);
  ok('12d. Sin nube: la marca se guarda local y queda en cola', (await p4.locator('#habLists .ci.done').count()) === 1 && /↑|✗/.test(await p4.locator('#syncIndicator').innerText()), await p4.locator('#syncIndicator').innerText());
  await p4.reload(); for (const d of '2227') await p4.click('.pin-btn:text-is("' + d + '")'); await p4.waitForFunction(() => document.getElementById('app').style.display === 'flex', null, { timeout: 8000 }); await nav(p4, 'hab'); await settle(p4, 400);
  ok('12e. Recargar sin nube: la marca pendiente sigue ahí (datos locales) y se avisa "sin conexión"', (await p4.locator('#habLists .ci.done').count()) === 1 && (await text(p4, '#topBanner')).includes('Sin conexión'));
  ok('12f. Todavía nada subido (no se sube sin descargar primero)', cloud3.log.filter(l => l.t === 'POST' && l.keys.some(k => k.startsWith('day:'))).length === 0);
  cloud3.down = false; await p4.evaluate(() => reloadFromCloud()); await settle(p4, 1500);
  ok('12g. Al volver la nube se descarga primero y luego se sube lo pendiente', cloud3.val('day:2026-10-27') && cloud3.val('day:2026-10-27').checked.manif === true, JSON.stringify(cloud3.val('day:2026-10-27')));
  await ctx4.close();

  /* ═══ 13. Migración de datos ya guardados (se archiva, no se borra) ═══ */
  const cloud5 = makeCloud();
  const money = { id: 'g_mill', text: '1,000,000 MXN para mí', date: '2027-05-22', done: false, dash: true, dashTitle: '1,000,000 MXN', money: true, amount: 120000, target: 1000000 };
  cloud5.put('goals', [
    { id: 'negocio', name: 'NEGOCIO — Covant', short: 'Negocio', color: 'var(--gold)', items: [money] },
    { id: 'cuerpo', name: 'CUERPO', short: 'Cuerpo', color: 'var(--green)', items: [{ id: 'g_c1', text: '12% de grasa corporal', date: null, done: true }] },
    { id: 'mente', name: 'MENTE', short: 'Mente', color: 'var(--blue)', items: [{ id: 'g_m1', text: 'Buena base de marketing', date: null, done: false }] }]);
  cloud5.put('goals_long', [
    { id: 'l1', text: 'Filantropía — la meta principal de vida', done: false }, { id: 'l2', text: 'Pelea a nivel profesional', done: false },
    { id: 'l3', text: 'Preparación de nivel militar siendo civil', done: false }, { id: 'l4', text: 'Retomar bench y sentadilla', done: true }, { id: 'l5', text: 'Artes marciales', done: false }]);
  cloud5.put('routine', [{ id: 'r8', time: '4:30–5:15 pm', title: 'Crear contenido', note: '', tag: '', hl: false }, { id: 'r9', time: '5:30 pm', title: 'Cardio 45 min', note: '', tag: '', hl: false }]);
  cloud5.put('gym_split', [{ id: 'd1', day: 'Lunes', name: 'Push', exercises: [] }]);
  cloud5.put('gym:2026-10-20:d1', { date: '2026-10-20', exs: {} });
  const ctx5 = await newCtx(browser, cloud5);
  const p5 = await open(ctx5, url);
  await pin(p5); await settle(p5, 1400);
  ok('13a. Meta CUERPO quitada de las metas visibles', JSON.stringify(cloud5.val('goals').map(c => c.id)) === JSON.stringify(['negocio', 'mente']));
  ok('13b. …y archivada con su contenido (no borrada)', JSON.stringify(cloud5.val('goals_archive')).includes('12% de grasa corporal'));
  ok('13c. El monto acumulado del millón se conserva (120000)', cloud5.val('goals')[0].items[0].amount === 120000);
  const ll = cloud5.val('goals_long');
  ok('13d. Largo plazo: quedan Filantropía y "Retomar bench" (con su ✓); pelea, militar y artes marciales archivadas', JSON.stringify(ll.map(x => x.id)) === JSON.stringify(['l1', 'l4']) && ll[1].text === 'Retomar bench' && ll[1].done === true && JSON.stringify(cloud5.val('goals_archive')).includes('Artes marciales'), JSON.stringify(ll));
  ok('13e. Bloque de cardio fuera de la rutina y archivado', !JSON.stringify(cloud5.val('routine')).includes('Cardio') && JSON.stringify(cloud5.val('routine_archive')).includes('Cardio 45 min'));
  ok('13f. Datos de gym ya guardados NO se borran de la base', cloud5.rows.has('gym_split') && cloud5.rows.has('gym:2026-10-20:d1'));
  const archN = cloud5.val('goals_archive').length;
  await p5.reload(); await pin(p5); await settle(p5, 1000);
  ok('13g. Idempotente: al recargar no se vuelve a archivar nada', cloud5.val('goals_archive').length === archN && archN === 4, String(cloud5.val('goals_archive').length));
  ok('13h. Sin errores de JS', p5.errors.length === 0, p5.errors.join(' | '));
  await ctx5.close();

  await browser.close(); srv.close();
  const failed = results.filter(r => !r.pass);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' pruebas pasaron');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('ERROR DEL ARNÉS:', e); process.exit(2); });
