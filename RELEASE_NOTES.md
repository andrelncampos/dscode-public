## ⚡ V40: Performance-First Execution — 4 specs, zero regressões

Otimização cirúrgica de I/O, CPU e memória em 4 frentes. Resultado: sessões mais rápidas, startup mais leve, histórico mais enxuto.

### Session I/O (spec 420)
- **Gravação incremental**: `appendFileSync` no lugar de reescrever o arquivo inteiro de mensagens
- **Cache de sessions index**: `_cachedSessionsIndex` em memória — `loadSessionsIndex()` era chamado 6× por turno lendo do disco
- **Guarda de diretório**: `_projectDirEnsured` evita `mkdirSync` desnecessário
- **Buffers de string**: `push` + `join` nos loops de streaming em vez de `+=` (realocação a cada chunk)

### Startup (spec 430)
- **Skills paralelas**: `Promise.all` + `fs/promises` — carregamento simultâneo, zero `readFileSync` sequencial
- **Templates cacheados**: Templates de prompt (`templates/tools/*.md`, `templates/skills/*.md`) em cache imutável — não são mais relidos do disco a cada turno

### Compaction & memória (spec 440)
- **Hash incremental**: `findStablePrefixEndIndex()` usa uma única instância de SHA-256 incremental — O(N) em vez de O(N²)
- **Turns paralelos**: `readRecentTurns()` descomprime arquivos em paralelo com `Promise.all`
- **Backup assíncrono**: `backupSpecFile()` usa `fs/promises.copyFile` — zero bloqueio

### Hardening (spec 450)
- **Concorrência limitada**: `readRecentTurns` processa em lotes de 8 com parada antecipada — sem desperdício de I/O
- **Invalidação por mtime**: Cache de sessions index verifica `mtimeMs` — seguro para uso multi-terminal
- **Recuperação de ENOENT**: `ensureProjectDir` reseta a flag se `.dscode/` for deletado durante a sessão
- **ESLint `no-floating-promises`**: Regra ativa — 5 violações corrigidas com `void`

---

## 🐛 PDF: Context Budget Fix (spec 460)

- **PDFs com ObjStm comprimido**: `countPdfPages` retorna `null` (não `0`) quando a heurística regex falha. PDFs grandes não são mais embutidos como base64 no contexto — prevenindo overflow da janela de 1M tokens.

---

## 🚀 Otimizações com APIs nativas Node.js 24

- **Grep handler**: `fs.globSync` nativo, leitura paralela assíncrona, streaming — **-143 linhas, -1 dependência**
- **Glob handler**: Walker customizado substituído por `fs.globSync` — **-51 linhas**

---

## 🔧 Correções

- **`cacheMode` no Zod schema**: Settings com `cacheMode` não são mais rejeitados como inválidos
- **`/spec-pipe`**: Auto-cria sessão quando nenhuma está ativa
- **FD leaks**: File descriptors fechados no catch de detecção binária do grep e no disconnect do MCP client
- **Variável não usada**: Regex `unusedInBinaryDetection` removida do grep handler

---

## 📋 Documentação & infra

- **5 regras de steering** no `AGENTS.md`: autorização, cross-check, verificação, consequência, output
- **V39 e V40** documentados no `vision.md`
- **Aviso Node 26** no welcome screen: "A partir de Outubro/2026, o DsCode passará a exigir Node.js 26."
- **Release notes** agora usam `RELEASE_NOTES.md` (não `--generate-notes`)

---

## 🚀 Node.js 24 — All-in

Migração completa para Node 24 como baseline. Zero compatibilidade com versões antigas.

### APIs nativas que substituíram dependências
- **`fs.globSync`** nativo substitui pacote `glob` npm — **-4 dependências**
- **`node:zstd`** nativo substitui fallback Brotli do `node:zlib` — compressor 4× menor
- **`Error.isError()`** → função `getErrorMessage()` cross-realm safe em 21 arquivos
- **`structuredClone`** nativo — clone profundo de 8 linhas vira 1
- **esbuild target `node24`** — sem polyfills para Node 22
- **CI em Node 24** — build e teste no runtime real

---

## 🍎 macOS Apple Silicon em releases automáticas

- macOS ARM64 (`macos-latest`) agora builda automaticamente em todo push de tag
- macOS Intel (`macos-13`) removido — runner deprecated pelo GitHub, sem fila de espera
- Dry-run cobre Windows, Linux e macOS ARM64
- Download de checksums corrigido (causa do erro `400 Bad Content-Length` na v1.0.41)

---

## 🔄 Auto-update robusto

- Naming de assets 100% alinhado entre CI e `update-check.ts`
- Pacotes portable (fallback quando SEA falha) agora copiam **todos** os arquivos companheiros: `dscode.mjs`, `node`, `templates/`, `node_modules/`
- Extração de arquivos e substituição atômica do binário em todas as plataformas

---

## 🖼️ OCR local com Tesseract.js

- OCR offline via `tesseract.js` para modelos sem suporte a imagem (ex: DeepSeek V4)
- **Import dinâmico** — `tesseract.js` só carrega quando OCR é realmente usado, zero impacto no startup
- Todas as 12 dependências transitivas empacotadas no pacote portable
- Texto extraído truncado em 2000 caracteres (limite de palavra)
- `/image-paste` e `/image-upload` com fallback automático de OCR
- Drag-and-drop de arquivos via paste no terminal

---

## 🐛 Correções

- **v1.0.41**: Erro `400 Bad Content-Length` na publicação — checksums não eram baixados
- **v1.0.42/43**: macOS Intel travava release por falta de runner — removido do pipeline
- **Auto-update**: Pacotes portable quebravam ao atualizar — agora copia arquivos companheiros
- **Bundle**: Build silencioso em falha — agora `exit(1)` e CI detecta
- **OCR startup**: `regenerator-runtime` não encontrado no startup — `tesseract.js` carregado sob demanda
- **Erro no ErrorBanner Ink**, overflow de context window, sufixos de spec

---

## 📐 Especificações e build

- Specs 370-410: validação de build, resiliência operacional, rastreabilidade, auto-update
- `validate-binary.mjs` usa versão da tag (não package.json)
- `release-dry-run.yml` cobre 3 plataformas
- Validação de URLs dos READMEs no CI
