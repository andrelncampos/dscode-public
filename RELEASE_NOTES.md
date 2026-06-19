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
