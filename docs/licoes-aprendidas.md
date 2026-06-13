# Lições Aprendidas

Registro de problemas encontrados, suas causas raiz e soluções aplicadas, para evitar retrabalho futuro.

---

## Cursores dessincronizados em texto com quebra de linha (Ink + Yoga bug)

**Data:** 2026-06-13

**Sintoma:** No `PromptInput`, quando o texto digitado ultrapassa a largura do terminal e sofre quebra de linha (wrap), o cursor fino do terminal (posicionado via ANSI `cursorForward`) fica para trás do cursor visual (bloco retangular renderizado via `\x1B[7m`). A distância aumenta progressivamente a cada quebra de linha — ~1 caractere na primeira quebra, ~2 na segunda, e assim por diante.

**Causa:** É um **bug conhecido do Ink** (biblioteca React para terminal, v7.0.5 com Yoga 3.2.1). O motor de layout Yoga 3 calcula o soft-wrap do texto em posições ligeiramente diferentes do que um simples character-count faria. Como o `PromptInput` usa **dois cursores independentes** — o visual (parte da string renderizada pelo Ink) e o fino do terminal (posicionado manualmente via ANSI calculado por `measureTextPosition`) — qualquer divergência entre o wrapping do Yoga e o cálculo de caracteres causa desalinhamento cumulativo.

Este bug está documentado nas issues do Ink:
- "Cursor position wrong when text wraps in a column with offset" (issue #523 e relacionadas)
- O problema é intrínseco: o terminal trata wrapping a nível de hardware, e o Yoga calcula com métricas diferentes

**Solução aplicada:** `hardWrapText()` em `src/ui/hooks/cursor.ts`.

Em vez de deixar o Ink fazer soft-wrap (não confiável), o texto renderizado é **pré-quebrado com `\n` explícito** nos pontos calculados pelo mesmo algoritmo de `measureTextPosition`. Assim, tanto o cursor visual (Ink renderizando `\n` reais) quanto o cursor fino (ANSI calculado) usam exatamente as mesmas posições de quebra, eliminando a divergência.

**Arquivos relevantes:**
- `src/ui/hooks/cursor.ts` — `hardWrapText()`, `measureTextPosition()`, `getPromptCursorPlacement()`
- `src/ui/views/PromptInput.tsx` — `renderedText` memo aplica `hardWrapText` antes do `<Text>`

**NÃO FAZER (anti-padrões testados e rejeitados):**
- ❌ Ajustar `column = initialColumn - 1` — não resolve, o cálculo já está correto
- ❌ Trocar `flexShrink={1}` por `width={screenWidth - 2}` — piora drasticamente (9+ caracteres de atraso)
- ❌ Remover `flexShrink={1}` do Box de texto — quebra o layout básico
- ❌ Tentar "compensar" o erro no `measureTextPosition` — o erro está no Yoga, não no cálculo
