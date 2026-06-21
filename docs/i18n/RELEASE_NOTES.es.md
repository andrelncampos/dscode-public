## ⚡ V40: Performance-First Execution — 4 specs, cero regresiones

Optimización quirúrgica de I/O, CPU y memoria en 4 frentes. Resultado: sesiones más rápidas, inicio más ligero, historial más compacto.

### Session I/O (spec 420)
- **Escritura incremental**: `appendFileSync` en lugar de reescribir el archivo completo de mensajes
- **Caché de índice de sesiones**: `_cachedSessionsIndex` en memoria — `loadSessionsIndex()` se llamaba 6× por turno leyendo del disco
- **Guarda de directorio**: `_projectDirEnsured` evita `mkdirSync` innecesario
- **Búferes de string**: `push` + `join` en bucles de streaming en lugar de `+=` (reasignación por cada chunk)

### Startup (spec 430)
- **Skills paralelas**: `Promise.all` + `fs/promises` — carga simultánea, cero `readFileSync` secuencial
- **Plantillas cacheadas**: Plantillas de prompt (`templates/tools/*.md`, `templates/skills/*.md`) en caché inmutable — ya no se releen del disco en cada turno

### Compaction y memoria (spec 440)
- **Hash incremental**: `findStablePrefixEndIndex()` usa una única instancia SHA-256 incremental — O(N) en lugar de O(N²)
- **Turns paralelos**: `readRecentTurns()` descomprime archivos en paralelo con `Promise.all`
- **Backup asíncrono**: `backupSpecFile()` usa `fs/promises.copyFile` — cero bloqueo

### Hardening (spec 450)
- **Concurrencia limitada**: `readRecentTurns` procesa en lotes de 8 con parada anticipada — sin desperdicio de I/O
- **Invalidación por mtime**: Caché de índice de sesiones verifica `mtimeMs` — seguro para uso multi-terminal
- **Recuperación de ENOENT**: `ensureProjectDir` resetea la bandera si `.dscode/` se elimina durante una sesión
- **ESLint `no-floating-promises`**: Regla activa — 5 violaciones corregidas con `void`

---

## 🐛 PDF: Context Budget Fix (spec 460)

- **PDFs con ObjStm comprimido**: `countPdfPages` devuelve `null` (no `0`) cuando la heurística regex falla. PDFs grandes ya no se incrustan como base64 en el contexto — previniendo el desbordamiento de la ventana de 1M tokens.

---

## 🚀 Optimizaciones con APIs nativas Node.js 24

- **Grep handler**: `fs.globSync` nativo, lectura paralela asíncrona, streaming — **-143 líneas, -1 dependencia**
- **Glob handler**: Walker personalizado reemplazado por `fs.globSync` — **-51 líneas**

---

## 🔧 Correcciones

- **`cacheMode` en Zod schema**: Settings con `cacheMode` ya no se rechazan como inválidos
- **`/spec-pipe`**: Auto-crea sesión cuando no hay ninguna activa
- **FD leaks**: File descriptors cerrados en el catch de detección binaria del grep y en el disconnect del MCP client
- **Variable no usada**: Regex `unusedInBinaryDetection` eliminada del grep handler

---

## 📋 Documentación e infra

- **5 reglas de steering** en `AGENTS.md`: autorización, cross-check, verificación, consecuencia, output
- **V39 y V40** documentados en `vision.md`
- **Aviso Node 26** en welcome screen: "A partir de Octubre 2026, DsCode requerirá Node.js 26."
- **Release notes** ahora usan `RELEASE_NOTES.md` (no `--generate-notes`)

---

## 🚀 Node.js 24 — All-in

Migración completa a Node 24 como baseline. Cero compatibilidad con versiones anteriores.

### APIs nativas que reemplazaron dependencias
- **`fs.globSync`** nativo reemplaza paquete `glob` npm — **-4 dependencias**
- **`node:zstd`** nativo reemplaza fallback Brotli de `node:zlib` — compresor 4× menor
- **`Error.isError()`** → función `getErrorMessage()` cross-realm safe en 21 archivos
- **`structuredClone`** nativo — clon profundo de 8 líneas a 1
- **esbuild target `node24`** — sin polyfills para Node 22
- **CI en Node 24** — build y test en runtime real

---

## 🍎 macOS Apple Silicon en releases automáticas

- macOS ARM64 (`macos-latest`) ahora builda automáticamente en cada push de tag
- macOS Intel (`macos-13`) eliminado — runner deprecado por GitHub, sin espera en cola
- Dry-run cubre Windows, Linux y macOS ARM64
- Descarga de checksums corregida (causa del error `400 Bad Content-Length` en v1.0.41)

---

## 🔄 Auto-update robusto

- Naming de assets 100% alineado entre CI y `update-check.ts`
- Paquetes portable (fallback cuando SEA falla) ahora copian **todos** los archivos compañeros: `dscode.mjs`, `node`, `templates/`, `node_modules/`
- Extracción de archivos y sustitución atómica del binario en todas las plataformas

---

## 🖼️ OCR local con Tesseract.js

- OCR offline vía `tesseract.js` para modelos sin soporte de imagen (ej: DeepSeek V4)
- **Import dinámico** — `tesseract.js` solo carga cuando OCR se usa realmente, cero impacto en startup
- Las 12 dependencias transitivas empaquetadas en el paquete portable
- Texto extraído truncado a 2000 caracteres (límite de palabra)
- `/image-paste` e `/image-upload` con fallback automático de OCR
- Drag-and-drop de archivos vía paste en terminal

---

## 🐛 Correcciones

- **v1.0.41**: Error `400 Bad Content-Length` en publicación — checksums no se descargaban
- **v1.0.42/43**: macOS Intel bloqueaba releases por falta de runner — eliminado del pipeline
- **Auto-update**: Paquetes portable fallaban al actualizar — ahora copia archivos compañeros
- **Bundle**: Build silencioso en fallo — ahora `exit(1)` y CI lo detecta
- **OCR startup**: `regenerator-runtime` no encontrado en startup — `tesseract.js` cargado bajo demanda
- **Error en ErrorBanner Ink**, overflow de context window, sufijos de spec

---

## 📐 Especificaciones y build

- Specs 370-410: validación de build, resiliencia operacional, trazabilidad, auto-update
- `validate-binary.mjs` usa versión de la tag (no package.json)
- `release-dry-run.yml` cubre 3 plataformas
- Validación de URLs de READMEs en CI
