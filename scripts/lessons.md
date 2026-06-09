# Lições Aprendidas — Shift+Enter no Prompt

## Decisão Final

A decisão de newline vs submit **depende dos bytes reais observados** no stdin, não de suposições sobre o terminal.

## Impossibilidade Técnica

Se Enter e Shift+Enter chegarem ambos como `"\r"` (0x0D), é **impossível** distinguir entre eles no Node.js.
Nesse caso, o usuário deve usar **Ctrl+J** ou **Alt+Enter** (se disponível) como fallback para inserir nova linha.

## Regras de Implementação

### Timer
- Timer **NÃO** deve ser usado para inferir Shift+Enter (ex: medir tempo entre `\r` e `\n` para adivinhar intenção).
- Timer **PODE** ser usado para normalizar CRLF dividido entre chunks (suprimir `\n` residual logo após `\r`).

### `\n` (LF)
- `\n` deve ser tratado como **intenção de nova linha** (Ctrl+J), **não** como prova semântica de Shift+Enter.
- Se o terminal envia `\n` para Shift+Enter, ótimo — o comportamento desejado é alcançado. Mas não se pode afirmar que foi Shift+Enter.

### CSI-u / modifyOtherKeys
- Sequências como `\x1B[13;2u` e `\x1B[13;130u` são a **única** forma confiável de detectar Shift+Enter.
- O parser deve usar `modifierBits = modifierParam - 1` e testar `modifierBits & 1` para o bit de Shift.
- Terminal que não suporta modifyOtherKeys (ex: mintty) simplesmente não enviará essas sequências.

### Histórico de Tentativas

| Data | Abordagem | Resultado |
|------|-----------|-----------|
| 2026-05-13 | modifyOtherKeys level 2 (`ESC[>4;2m`) + sequências fixas | Funciona em xterm, não no mintty |
| 2026-05-15 | Kitty protocol (`;1u`) + sequências fixas | Mais compatibilidade, ainda não cobre mintty |
| 2026-05-15 | Parsing dinâmico de modificadores (regex + bitmask) | Cobre Windows Terminal (mod=130), mas mintty não envia CSI |
| 2026-05-18 | Re-aplicação após merge | Mesmo resultado |
| 2026-05-19 | **REVERT** — volta ao estado anterior | Nenhuma abordagem resolve o mintty |
| 2026-06-08 | **Abordagem definitiva**: 7 frentes de mudança (ver abaixo) | Typecheck ✅, lint ✅, bundle ✅, 39/39 testes de input ✅ |

### Tentativa 2026-06-08 — Detalhes

**O que foi feito (7 frentes):**

1. **`scripts/debug-stdin.mjs`**: script de diagnóstico (`npm run debug:keys`) que imprime os bytes hexadecimais de cada chunk do stdin. Sem isso, qualquer tentativa é tiro no escuro.

2. **CRLF normalization em `dispatchTerminalInput`**: `\r\n` em chunk único → `\r` (um único Enter). Evita que certos terminais disparem Enter + Ctrl+J separados.

3. **Split CRLF suppression em `handleData`**: timer de 5ms — quando `\r` chega sozinho, o `\n` seguinte é suprimido. Timer curto (5ms) para não atrasar input real.

4. **Parser dinâmico `isShiftReturn()`**: regex `/^\x1B\[13;(\d+)u$/` + `modifierBits = modifierParam - 1` + `modifierBits & 1`. Resolve Windows Terminal (modifier=130 → 129&1=1).

5. **`getPromptReturnKeyAction(key, input)` unificada**: Ctrl+J agora retorna `"newline"` diretamente da função de decisão (antes era handler separado na linha 573). Menos caminhos de código, menos bugs.

6. **Handler Ctrl+J redundante removido** do PromptInput.tsx.

7. **`DSCODE_DISABLE_EXTENDED_KEYS=1`**: escape hatch para desabilitar `ESC[>4;2m` sem recompilar.

**O que NÃO foi feito (por princípio):**
- NÃO se usou timer para distinguir Shift+Enter de Enter.
- NÃO se bloqueou modifyOtherKeys por `MSYSTEM`/`MINGW64`.
- NÃO se tratou `\n` como prova de Shift+Enter — é tratado como intenção de newline.
- NÃO se colocou escrita de escape sequences dentro de `useTerminalInput` — continua em `useTerminalExtendedKeys`.

**O que ainda pode falhar:**
- Se o terminal envia `\r` tanto para Enter quanto para Shift+Enter, não há solução em software. O usuário precisa usar Ctrl+J ou Alt+Enter.
- O script `debug:keys` deve ser executado no ambiente do usuário para confirmar os bytes reais antes de qualquer nova tentativa.

## Evidência Conclusiva — 2026-06-09

Um `diag.log` capturado da instrumentação temporária `[DIAG-*]` provou o caso de falha em um terminal real:

**Ambiente do teste:**
- `TERM=undefined`, `MSYSTEM=undefined` → **não é Git Bash/mintty**; provavelmente CMD/ConHost ou outro terminal Windows
- `isTTY=true`, `DSCODE_DISABLE_EXTENDED_KEYS=undefined` → extended keys foram habilitadas

**Bytes observados para Shift+Enter:**
```
[DIAG-parse] raw="\r" hex=[0x0d] flags=[return]
[DIAG-action] returnAction=submit input="\r" flags=[return]
```

**Conclusão:**
1. Nesse ambiente, **Shift+Enter é indistinguível de Enter** no nível do Node.js — chega como `0x0d` puro, sem modificador Shift, sem CSI.
2. Nenhum parser, timer, ou heurística pode corrigir isso — o processo simplesmente não recebe informação suficiente.
3. Isso **não** é uma falha do mintty (o teste não foi no mintty). É uma limitação do terminal onde o teste foi executado.
4. O fallback oficial nesse ambiente deve ser **Ctrl+J** (sempre disponível) ou **Alt+Enter** (quando suportado).
5. Shift+Enter só funciona quando o terminal envia `0x0a` distinto ou sequência CSI (`\x1B[13;2u`, `\x1B[13;130u`).

**Próximos passos:**
- [x] Remover instrumentação `[DIAG-*]` (cumpriu seu propósito)
- [x] Manter scripts `debug:keys` e `debug:keys:extended` como ferramentas de suporte
- [x] Atualizar help/atalhos para refletir a realidade: Shift+Enter é terminal-dependente, Ctrl+J é o fallback garantido
- [x] Implementar detecção conservadora de perfil de terminal (terminal-runtime.ts) para UX/rodapé
- [ ] Para validar Git Bash/mintty, o teste precisa ser executado **dentro** do Git Bash, com `MSYSTEM=MINGW64` e `TERM=xterm-256color`

## Detecção de Terminal Runtime — 2026-06-09

### Decisão

O app não promete Shift+Enter universal. A detecção de perfil de terminal (`detectTerminalRuntime()`) serve exclusivamente para UX — rodapé, help, welcome screen e `--help` — e nunca para o parser de teclas.

### Regras

- **Windows Console clássico** (CMD/Console Host, PowerShell clássico sem terminal wrapper): o rodapé oculta Shift+Enter e prioriza Ctrl+J. Shift+Enter é classificado como `not-reliable`.
- **Terminais modernos** (Windows Terminal, VS Code, WezTerm, ConEmu, Cmder, mintty-like): Shift+Enter aparece com ressalva — "if supported", "if configured" ou "terminal-dependent".
- **Ctrl+J é sempre o fallback primário** em todos os perfis.
- A detecção é conservadora e baseada exclusivamente em variáveis de ambiente. Não usa timer, heurística, ou estado visual.
- Para diagnóstico real de teclas no ambiente do usuário, usar `npm run debug:keys` e `npm run debug:keys:extended`.

### Arquivo

`src/ui/core/terminal-runtime.ts` — exporta `detectTerminalRuntime(env?)` e tipos `TerminalRuntimeProfile`, `TerminalRuntimeKind`.

### Testes

`src/tests/terminal-runtime.test.ts` cobre:
- classic-windows-console (sem env vars de terminal)
- Windows Terminal (WT_SESSION / WT_PROFILE_ID)
- VS Code terminal (TERM_PROGRAM=vscode)
- WezTerm (TERM_PROGRAM=WezTerm / WEZTERM_PANE)
- Git Bash / MSYS / mintty-like (MSYSTEM / MINGW_PREFIX)
- ConEmu / Cmder
- Unknown (non-Windows, sem env vars)
- PowerShell-like e CMD-like como sub-indicadores
- Verificações de footerNewlineHint, helpNewlineHint, shouldShowShiftEnterInFooter
