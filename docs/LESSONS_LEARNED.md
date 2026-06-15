# Lições Aprendidas — Release Pipeline do DsCode

## v1.0.27 → v1.0.34 (junho/2026)

### 1. Matrix strategy é desnecessária para 2 plataformas

**Problema:** `matrix` com `platform: [windows, linux]` adicionava complexidade sem benefício real com apenas 2 variações.

**Solução:** Dois jobs explícitos (`build-windows`, `build-linux`), mais legíveis e fáceis de auditar.

### 2. Guards de workflow devem ser defensivos, não genéricos

**Errado:**
```yaml
if: github.event_name == 'push'
```

**Certo:**
```yaml
if: startsWith(github.ref, 'refs/tags/v')
```

`event_name == 'push'` dispara em qualquer push (main, branch, tag). Se alguém adicionar `push: branches:` no `on:` do workflow, builds indevidos seriam executados. `startsWith(github.ref, 'refs/tags/v')` só dispara em tag de versão.

### 3. Empacotamento portátil exige bundle autocontido

**Problema:** `build-sea.mjs` copiava `dist/cli.js` (código com `import` de `ink`, `react` e outras dependências externas) para dentro do ZIP. O executável portátil quebrava com `Cannot find module 'ink'`.

**Solução:** Copiar `release/bundle/dscode.mjs` — o bundle gerado pelo esbuild com todas as dependências empacotadas inline (6.4 MB autocontido).

### 4. Top-level await do Ink impede formato CJS

**Problema:** Ink usa `top-level await`, incompatível com output `"cjs"` do esbuild.

**Solução:** Manter ESM (`.mjs`) e adicionar shim de `createRequire` no banner para módulos built-in do Node que usam `require`:
```js
import { createRequire as __createRequire } from 'node:module';
const require = __createRequire(import.meta.url);
```

### 5. Versão deve ter fonte única de verdade: a tag Git

**Problema:** `package.json` estava em `1.0.27` enquanto os releases estavam em `v1.0.32+`. Os scripts de build liam `package.json` e geravam assets com versão errada (`dscode-v1.0.27-windows-x64.zip` em release `v1.0.32`).

**Solução:** `scripts/build-bundle.mjs` e `scripts/package-binary.mjs` agora usam `GITHUB_REF_NAME` (strip do prefixo `v`) como fonte primária. `package.json` é fallback apenas para desenvolvimento local.

### 6. Versões hardcoded no código-fonte apodrecem

**Problema:** `src/mcp/mcp-http-client.ts` tinha `version: "1.0.0"` e `src/mcp/mcp-client.ts` tinha `version: "0.1.0"` — valores estáticos que nunca foram atualizados.

**Solução:** Ambos agora importam `package.json` com `pkg.version`, mantendo-se sempre sincronizados.

### 7. `[skip ci]` no commit apontado pela tag bloqueia o workflow da tag

**Problema:** Um commit com `[skip ci]` na mensagem impede que workflows disparem, inclusive workflows acionados por push de tag. Se a tag aponta para um commit com `[skip ci]`, o release.yml não dispara.

**Solução:** Commit de preparação (`chore: prepare release trigger`) sem `[skip ci]` criado após todo commit com `[skip ci]`. A tag aponta para o commit sem `[skip ci]`.

### 8. Shell trava se `startCwd` aponta para diretório deletado

**Problema:** Durante teste de extração do ZIP, o diretório temporário foi deletado enquanto o shell ainda o referenciava como `startCwd`. Todos os comandos subsequentes falharam com `spawn bash.exe ENOENT`.

**Solução:** Evitar `cd` para diretórios temporários que serão deletados. Usar caminhos absolutos a partir da raiz do projeto.

### 9. Validação de asset names no workflow evita surpresas

**Problema:** Sem validação, assets com versão errada eram publicados silenciosamente.

**Solução:** Adicionado step de validação no `release.yml` que confere se cada asset contém o número da versão da tag atual. Workflow falha antes do upload se houver divergência.

### 10. `package-lock.json` também tem versão e precisa ser atualizado

**Problema:** Ao bump de versão no `package.json`, o `package-lock.json` continuava com versão antiga (`1.0.10`).

**Solução:** Ambos os arquivos precisam ser atualizados juntos (2 ocorrências no `package-lock.json`: top-level e `packages[""]`).

### 11. Templates não estavam no pacote portátil → todos os comandos slash quebravam

**Problema:** O ZIP portátil incluía apenas `dscode.mjs` + `node.exe` + launchers. O diretório `templates/` (com arquivos `.md.ejs` para `/steering-add`, `/spec-list`, `/spec-new`, etc.) nunca era copiado. No modo dev, `getExtensionRoot()` retornava `path.resolve(__dirname, "..")` — de `src/` ia para a raiz do repo onde `templates/` existe. No pacote portátil, o bundle está na raiz do diretório de instalação, então `..` ia para o diretório pai (ex: `C:\Git\`), onde `templates/` não existe. Resultado: `ENOENT` em todo comando que usasse template.

**Solução:** Duas mudanças:
1. `build-sea.mjs`: copiar `templates/` para `release/bin/templates/` (ao lado do bundle).
2. `getExtensionRoot()`: detectar modo portátil — se `__dirname/templates/` existir, retornar `__dirname` direto (sem `..`). Fallback para comportamento antigo nos modos dev/npm.

### 12. `copyFileSync` não copia diretórios — usar `cpSync` com `recursive: true`

**Problema:** O script `package-binary.mjs` (CI) montava o ZIP lendo todos os arquivos de `release/bin/` e copiando com `copyFileSync`. Quando `templates/` (diretório) foi adicionado ao pacote, `copyFileSync` quebrou com `EPERM` no Windows e `EISDIR` no Linux — ele só copia arquivos, não diretórios.

**Solução:** Substituir `copyFileSync(f, dest)` por `cpSync(f, dest, { recursive: true })`. O `cpSync` é nativo do Node desde a v16.7.0 e copia arquivos E diretórios recursivamente.

**Commit:** `ea227834` (depois mergeado via `703fc3eb`)

### 13. Bundle ESM não tem `__dirname` — o fallback também precisa checar modo portátil

**Problema:** O bundle é gerado como ESM (`format: "esm"` no `build-bundle.mjs`). Em ESM, `__dirname` não existe. O `getExtensionRoot()` tinha um branch CJS (`typeof __dirname !== "undefined"`) que detectava modo portátil corretamente, mas o fallback ESM (`import.meta.url`) **não tinha** o cheque de modo portátil — sempre subia `..`. Resultado: no pacote portátil, retornava `C:\Git\` em vez de `C:\Git\dscode\`. Templates não encontrados. Só descobrimos porque um usuário reportou.

**Por que escapou:** O código CJS funcionava no dev (`npx tsx`), e o teste de validação (`--version`, `--help`) não exercita caminhos que leem templates. A auditoria inicial assumiu que `__dirname` existia no bundle, mas ele era ESM.

**Solução:** Adicionar o mesmo cheque de modo portátil no fallback ESM:

```typescript
const currentDir = path.dirname(currentFilePath);
if (fs.existsSync(path.join(currentDir, "templates"))) {
  return currentDir;  // modo portátil
}
return path.resolve(currentDir, "..");  // modo dev
```

**Commit:** `924072a3`

**Lição:** Sempre verificar se o formato do bundle (CJS vs ESM) corresponde às premissas do código. ESM não tem `__dirname`, `__filename`, `require` — qualquer código que dependa deles precisa de fallback ou shim.

### 14. Shift+Enter é impossível de detectar no Windows Console clássico — a solução é CSI u / xterm modifyOtherKeys + `\` + Enter

**Problema:** No Windows CMD / Console Host clássico, o sistema operacional corta o modificador Shift antes de entregar o evento. `Shift+Enter` chega como `Enter` puro (`\r` = CR = 0x0D) — é **tecnicamente impossível** distinguir os dois no Node.js. O Ink/`key.shift` nunca será `true` para Shift+Enter nesse ambiente.

**Solução em 3 camadas:**

1. **Parser de bytes crus (CSI u + xterm):** `useTerminalInput.ts` já detecta `ESC [ 13 ; 2 u` (CSI u), `ESC [ 27 ; 2 ; 13 ~` (xterm modifyOtherKeys), e `ESC \r` (split sequence do mintty/conpty). Isso cobre Windows Terminal, VS Code, WezTerm, ConEmu, Cmder e terminais modernos. Ver `SHIFT_RETURN_SEQUENCES` + `CSI_RETURN_U_RE` + `isShiftReturn()`.

2. **`\` + Enter como fallback universal:** Backslash seguido de Enter insere nova linha em qualquer terminal, sem setup. O handler remove o `\` e insere `\n`. Funciona até no CMD clássico.

3. **UI adaptativa por perfil:** `TerminalRuntimeProfile.shiftEnterCapable` indica se o terminal suporta CSI u. Se sim, o footer mostra "Shift+Enter newline". Se não, mostra "Ctrl+J newline · \\ + Enter newline". Oito perfis de detecção cobrem todos os terminais comuns.

**Arquitetura correta:** Parse os bytes crus primeiro (`stdin.on('data')`), não confie no `key.shift` do Ink/Node. Se chegar `\x1b[13;2u`, é Shift+Enter. Se chegar `\r` puro, é Enter (nunca invente que é Shift+Enter).
