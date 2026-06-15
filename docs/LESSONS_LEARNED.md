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
