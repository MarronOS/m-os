# M · OS

PWA personal (un solo usuario, en español). Un único `index.html` + `sw.js`; los datos viven en Supabase.

## Puesta en marcha (una sola vez)

1. En Supabase crea un proyecto **nuevo**.
2. **SQL Editor** → pega y ejecuta `schema.sql` (crea la tabla `mos_kv` y sus políticas; solo agrega, no borra).
3. **Project Settings → API**: copia la *Project URL* y la clave *anon / publishable*.
4. En `index.html`, al inicio del `<script>`, llena:
   ```js
   const SB_URL='https://TU-PROYECTO.supabase.co';
   const SB_KEY='tu-clave-anon';
   ```
5. Commit a `main`. (GitHub Pages sirve `index.html`; el service worker pide la red primero, así que siempre ves la última versión.)

Ya están configuradas con el proyecto de Supabase de M·OS (tabla `mos_kv` creada). Si las dejas vacías, la app funciona **solo en local** y lo avisa con un banner.

## Cómo se guarda

- Cada cambio se escribe al instante en el dispositivo y se envía a Supabase (tabla `mos_kv`: `key`, `value jsonb`, `updated_at`).
- Al abrir: **primero descarga, después renderiza**. Nada se sube hasta que la descarga inicial terminó bien; si la nube no responde y no hay datos locales, se muestra un error con *Reintentar* en vez de una app vacía.
- Sin conexión: los cambios quedan en cola y se suben al reconectar (se descarga primero, gana el cambio más reciente por clave).
- Nada se borra: lo que eliminas (metas, bloques de la rutina) se archiva en `goals_archive` y `routine_archive`.
- Entrenamiento (30 oct 2026): se quitó de la app (pestaña Gym, hábito y bloque de cardio). Las METAS de cuerpo y de largo plazo se conservan. Lo que ya tuvieras guardado (`gym:*`, `gym_split`) sigue en la base, solo no se muestra.
- Respaldo manual: Nota → **⬇ Backup** (JSON + CSV de hábitos).

## Claves de la tabla

`day:AAAA-MM-DD` (hábitos del día, con los nombres vigentes ese día) · `goals` · `goals_long` · `routine` · `nota` · `identity` · `pendientes` · `sem:<lunes>` · `fin_notes`.

## Seguridad (léelo)

El PIN es solo una pantalla en el cliente. Las políticas de `schema.sql` dan acceso a la clave *anon*, y esa clave es visible para cualquiera que abra la app o el repo. Es el mismo modelo de antes. Para protegerlo de verdad: Supabase Auth (un usuario) + políticas `auth.uid() = ...`.

## Pruebas

```
npm i playwright   # o ya instalado
node tests/acceptance.js
```
Levanta un Supabase simulado en memoria y un Chromium real (hora de México). No toca tu base real.

`archive/` conserva la versión anterior (v9) sin cambios.
