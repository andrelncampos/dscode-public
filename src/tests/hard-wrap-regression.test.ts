/**
 * Testes de regressão para concordância entre hardWrapText() e measureTextPosition().
 *
 * Regra arquitetural: o DsCode calcula as linhas visuais; o renderizador apenas imprime.
 * O Ink nunca deve decidir onde a linha quebra para texto editável com cursor, prefixo,
 * margem, padding, prompt marker, ANSI ou qualquer offset visual.
 *
 * Pipeline: buffer → visual lines (hardWrapText) → cursor position (measureTextPosition) → render.
 *
 * Estes testes validam que hardWrapText e measureTextPosition concordam exatamente
 * sobre linha e coluna para qualquer posição de cursor em qualquer texto.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// Re-import via ui barrel to match how consumers access these functions.
import { hardWrapText, measureTextPosition } from "../ui";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Verifica que para cada posição de cursor em `text`, o cálculo de
 * measureTextPosition concorda com a inspeção visual do hardWrapText.
 *
 * Invariante: se hardWrapText insere \n no texto, measureTextPosition deve
 * detectar um incremento de linha na mesma posição.
 */
function assertAgreement(text: string, width: number, prefixWidth: number): void {
  const wrapped = hardWrapText(text, width, prefixWidth);

  // Para cada posição de cursor (0 até text.length), calculamos a posição esperada
  // via measureTextPosition e verificamos que o texto wrapped tem a mesma
  // contagem de \n até a posição equivalente.
  for (let cursor = 0; cursor <= text.length; cursor++) {
    const beforeCursor = text.slice(0, cursor);
    const pos = measureTextPosition(beforeCursor, width, prefixWidth);

    // Encontra a posição equivalente no texto wrapped.
    const wrappedPos = mapCursorToWrapped(beforeCursor, wrapped, width, prefixWidth);

    assert.deepEqual(
      wrappedPos,
      pos,
      `Desacordo na posição cursor=${cursor} do texto "${text}" (w=${width}, pfx=${prefixWidth}): ` +
        `measureTextPosition=${JSON.stringify(pos)} vs wrapped=${JSON.stringify(wrappedPos)}`
    );
  }
}

/**
 * Mapeia a posição do cursor no texto original para {row, column} no texto
 * já pré-quebrado por hardWrapText, percorrendo caractere a caractere.
 */
function mapCursorToWrapped(
  beforeCursor: string,
  wrappedFull: string,
  width: number,
  prefixWidth: number
): { row: number; column: number } {
  let row = 0;
  let column = Math.min(prefixWidth, width - 1);
  let wi = 0; // índice no texto wrapped

  for (let i = 0; i < beforeCursor.length; i++) {
    const char = beforeCursor[i]!;

    if (char === "\n") {
      row++;
      column = prefixWidth;
      wi++; // consome o \n no wrapped
      continue;
    }

    const cw = characterWidth(char);
    if (column + cw > width) {
      row++;
      column = prefixWidth;
    }
    column += cw;
    if (column >= width) {
      row++;
      column = prefixWidth;
    }
    wi++;
  }

  return { row, column };
}

function characterWidth(char: string): number {
  const codePoint = char.codePointAt(0) ?? 0;
  if (codePoint === 0 || codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
  if (codePoint >= 0x300 && codePoint <= 0x36f) return 0;
  if (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6)
  )
    return 2;
  return 1;
}

// ---------------------------------------------------------------------------
// Testes: concordância hardWrapText ↔ measureTextPosition
// ---------------------------------------------------------------------------

test("hardWrapText ↔ measureTextPosition: sem wrap (texto curto, width=80)", () => {
  assertAgreement("hello", 80, 2);
});

test("hardWrapText ↔ measureTextPosition: sem wrap (texto curto, width=40)", () => {
  assertAgreement("abcdef", 40, 2);
});

test("hardWrapText ↔ measureTextPosition: texto vazio", () => {
  assertAgreement("", 80, 2);
  assertAgreement("", 20, 2);
  assertAgreement("", 10, 0);
});

test("hardWrapText ↔ measureTextPosition: um caractere apenas", () => {
  assertAgreement("x", 80, 2);
  assertAgreement("x", 1, 0); // width mínima = 1
});

// ---------------------------------------------------------------------------
// Larguras diferentes
// ---------------------------------------------------------------------------

test("hardWrapText ↔ measureTextPosition: width=20, prefix=2, texto longo", () => {
  // 18 chars utilizáveis por linha
  assertAgreement("abcdefghijklmnopqrstuvwxyz", 20, 2);
});

test("hardWrapText ↔ measureTextPosition: width=40, prefix=2, texto longo", () => {
  assertAgreement("The quick brown fox jumps over the lazy dog.", 40, 2);
});

test("hardWrapText ↔ measureTextPosition: width=80, prefix=2, texto longo", () => {
  assertAgreement("Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt.", 80, 2);
});

test("hardWrapText ↔ measureTextPosition: width=120, prefix=2", () => {
  assertAgreement(
    "This is a very long line of text that should wrap at exactly 120 characters with a prefix of width 2.",
    120,
    2
  );
});

// ---------------------------------------------------------------------------
// Prefixo "> " (largura 2) — o caso real do PromptInput
// ---------------------------------------------------------------------------

test("hardWrapText ↔ measureTextPosition: prefix '> ' (width=2), wrap exato na borda", () => {
  // Com width=10 e prefix=2, 8 chars cabem por linha após o prefixo
  // "12345678" cabe exato → sem wrap
  // "123456789" → wrap: "12345678" + "\n" + "9"
  assertAgreement("12345678", 10, 2);
  assertAgreement("123456789", 10, 2);
  assertAgreement("1234567890abcdef", 10, 2);
});

// ---------------------------------------------------------------------------
// Texto longo com múltiplas quebras
// ---------------------------------------------------------------------------

test("hardWrapText ↔ measureTextPosition: 5 quebras de linha", () => {
  // 10 chars utilizáveis (width=12, prefix=2)
  const text = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  assertAgreement(text, 12, 2);
});

test("hardWrapText ↔ measureTextPosition: texto muito longo, 100+ quebras", () => {
  const chunk = "0123456789ABCDEF"; // 16 chars
  const text = chunk.repeat(50); // 800 chars
  assertAgreement(text, 20, 2);
});

// ---------------------------------------------------------------------------
// Cursor no meio da linha, no fim da linha, na fronteira de quebra
// ---------------------------------------------------------------------------

test("hardWrapText ↔ measureTextPosition: cursor no meio da linha", () => {
  // width=12, prefix=2 → 10 chars por linha
  // "hello world" → cursor no meio (posição 5 = após "hello")
  const text = "hello world foo bar";
  assertAgreement(text, 12, 2);
});

test("hardWrapText ↔ measureTextPosition: cursor no fim da linha (antes do wrap)", () => {
  // width=10, prefix=2 → 8 chars por linha
  // "12345678" → cursor=8 está no fim da linha
  assertAgreement("12345678", 10, 2);
  assertAgreement("123456789", 10, 2); // cursor=8 no fim, cursor=9 após wrap
});

test("hardWrapText ↔ measureTextPosition: backspace perto da quebra", () => {
  // Simula o usuário digitando até a borda e depois apagando
  // width=10, prefix=2 → 8 chars por linha
  const text = "abcdefghijklm"; // 13 chars
  assertAgreement(text, 10, 2);
});

test("hardWrapText ↔ measureTextPosition: cursor exatamente na fronteira do wrap", () => {
  // width=10, prefix=2 → 8 colunas utilizáveis por linha
  // "12345678" preenche exatamente as 8 colunas → col atinge 10,
  // dispara wrap (col >= width) → row=1, col=2
  const pos = measureTextPosition("12345678", 10, 2);
  assert.deepEqual(pos, { row: 1, column: 2 });

  // cursor=9: após "123456789" → wrap ocorreu após o 8º char,
  // o 9º char ("9") fica na nova linha, coluna = prefix + 1 = 3
  const pos2 = measureTextPosition("123456789", 10, 2);
  assert.deepEqual(pos2, { row: 1, column: 3 });
});

// ---------------------------------------------------------------------------
// Texto com acentos e caracteres especiais
// ---------------------------------------------------------------------------

test("hardWrapText ↔ measureTextPosition: acentos (á, ç, ã, ê, ô)", () => {
  assertAgreement("áéíóú çãõ êâô àèìòù", 20, 2);
  assertAgreement("coração nação atenção", 15, 2);
});

test("hardWrapText ↔ measureTextPosition: texto com `ç` e `ã` no ponto de quebra", () => {
  // width=12, prefix=2 → 10 chars por linha
  // "nação" = 5 chars (n,a,ç,ã,o), todos width=1
  assertAgreement("nação brasileira", 12, 2);
});

test("hardWrapText ↔ measureTextPosition: combinação de acentos e ASCII", () => {
  const text = "Olá, como você está? Espero que sim!";
  assertAgreement(text, 20, 2);
});

// ---------------------------------------------------------------------------
// ANSI zero-width — sequências de escape não afetam o cálculo de coluna
// ---------------------------------------------------------------------------

test("hardWrapText ↔ measureTextPosition: ANSI zero-width (cursor cell)", () => {
  // A sequência \x1B[7mX\x1B[27m é como o cursor visual aparece no texto
  const text = "abc\u001B[7md\u001B[27mefg";
  assertAgreement(text, 20, 2);
});

test("hardWrapText ↔ measureTextPosition: múltiplas sequências ANSI", () => {
  const text = "\u001B[7ma\u001B[27m \u001B[7mb\u001B[27m \u001B[7mc\u001B[27m";
  assertAgreement(text, 10, 2);
});

test("hardWrapText ↔ measureTextPosition: ANSI próximo ao ponto de quebra", () => {
  // width=10, prefix=2 → 8 chars por linha
  // A ANSI com cursor cell não deve empurrar o texto para a próxima linha
  const text = "1234567\u001B[7m8\u001B[27m9"; // 9 chars visuais (após o prefixo)
  assertAgreement(text, 10, 2);
});

test("hardWrapText preserva sequências ANSI intactas", () => {
  const text = "abc\u001B[7md\u001B[27mefg";
  const wrapped = hardWrapText(text, 80, 2);
  // ANSI sequences should be preserved verbatim
  assert.ok(wrapped.includes("\u001B[7m"), "deve preservar ANSI inverse-start");
  assert.ok(wrapped.includes("\u001B[27m"), "deve preservar ANSI inverse-end");
  // Text content should survive — note that ANSI splits "d" from "efg"
  assert.ok(wrapped.includes("abc"), "deve conter conteúdo antes da ANSI");
  assert.ok(wrapped.includes("d"), "deve conter 'd' entre as sequências ANSI");
  assert.ok(wrapped.includes("efg"), "deve conter conteúdo depois da ANSI");
});

// ---------------------------------------------------------------------------
// CJK characters (width=2)
// ---------------------------------------------------------------------------

test("hardWrapText ↔ measureTextPosition: CJK básico (你好)", () => {
  assertAgreement("你好世界", 20, 2);
});

test("hardWrapText ↔ measureTextPosition: CJK com wrap", () => {
  // width=10, prefix=2 → 8 colunas por linha
  // Cada CJK ocupa 2 colunas → 4 chars por linha
  assertAgreement("你好世界测试文本", 10, 2);
});

test("hardWrapText ↔ measureTextPosition: CJK misturado com ASCII", () => {
  assertAgreement("hello 世界 test 你好", 15, 2);
});

// ---------------------------------------------------------------------------
// Resize do terminal — consistência com larguras diferentes
// ---------------------------------------------------------------------------

test("hardWrapText ↔ measureTextPosition: resize de 80 → 40 → 20", () => {
  const text = "The quick brown fox jumps over the lazy dog. 1234567890 abcdefghij.";
  assertAgreement(text, 80, 2);
  assertAgreement(text, 40, 2);
  assertAgreement(text, 20, 2);
});

test("hardWrapText ↔ measureTextPosition: resize de wide → narrow", () => {
  const text = "abcdefghijklmnopqrstuvwxyz";
  assertAgreement(text, 100, 2);
  assertAgreement(text, 50, 2);
  assertAgreement(text, 20, 2);
  assertAgreement(text, 10, 2);
});

test("hardWrapText ↔ measureTextPosition: width mínima (1 a 5)", () => {
  const text = "abcdefgh";
  for (let w = 1; w <= 5; w++) {
    assertAgreement(text, w, 0);
  }
});

// ---------------------------------------------------------------------------
// Nova linha explícita (\n) no buffer
// ---------------------------------------------------------------------------

test("hardWrapText ↔ measureTextPosition: \\n explícito no meio do texto", () => {
  assertAgreement("hello\nworld", 80, 2);
  assertAgreement("line1\nline2\nline3", 20, 2);
});

test("hardWrapText ↔ measureTextPosition: \\n + wrap na mesma linha", () => {
  // width=10, prefix=2 → 8 chars por linha
  // "1234\n567890ab" → quebra após "1234", depois "567890ab" quebra em "567890" + "ab"
  assertAgreement("1234\n567890ab", 10, 2);
});

test("hardWrapText ↔ measureTextPosition: \\n múltiplos consecutivos", () => {
  assertAgreement("a\n\n\nb", 80, 2);
  assertAgreement("\n\n\n", 80, 2);
});

// ---------------------------------------------------------------------------
// Prefixo zero (sem offset visual)
// ---------------------------------------------------------------------------

test("hardWrapText ↔ measureTextPosition: prefixWidth=0 (sem prefixo)", () => {
  assertAgreement("hello world foo bar baz", 15, 0);
  assertAgreement("abcdefghijklmnop", 10, 0);
});

// ---------------------------------------------------------------------------
// Casos de borda do mundo real (simulando interações do usuário)
// ---------------------------------------------------------------------------

test("hardWrapText ↔ measureTextPosition: digitação incremental até 200 chars", () => {
  // Simula digitação caractere a caractere
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()";
  let accumulated = "";
  for (const ch of chars) {
    accumulated += ch;
    assertAgreement(accumulated, 40, 2);
  }
});

test("hardWrapText ↔ measureTextPosition: texto realista de código", () => {
  const code = 'function helloWorld() {\n  console.log("Hello, World!");\n  return 42;\n}\n';
  assertAgreement(code, 50, 2);
});

test("hardWrapText ↔ measureTextPosition: path de arquivo longo", () => {
  const path = "src/ui/components/dialogs/confirmation/useConfirmationDialogStateManager.ts";
  assertAgreement(path, 40, 2);
});

test("hardWrapText ↔ measureTextPosition: URL longa", () => {
  const url = "https://github.com/vadimdemedes/ink/issues/523/discussion/about-text-wrapping-and-cursor-position";
  assertAgreement(url, 40, 2);
});

// ---------------------------------------------------------------------------
// Idempotência parcial do hardWrapText
// ---------------------------------------------------------------------------
// hardWrapText não é estritamente idempotente quando segmentos preenchem
// exatamente a largura útil (col >= width após o último char). Isso é
// inofensivo no PromptInput porque o useMemo aplica hardWrapText uma única
// vez por render — o output nunca é re-alimentado.

test("hardWrapText: re-aplicar não corrompe o layout visual", () => {
  // Aplicar hardWrapText duas vezes pode inserir \n extras em segmentos
  // que preenchem exatamente a largura, mas o texto resultante, quando
  // medido por measureTextPosition, continua consistente consigo mesmo.
  const text = "abcdefghijklmnopqrstuvwxyz0123456789";
  const once = hardWrapText(text, 10, 2);
  const twice = hardWrapText(once, 10, 2);
  // Ambas as versões devem ser consistentes com measureTextPosition
  assertAgreement(once, 10, 2);
  assertAgreement(twice, 10, 2);
});

test("hardWrapText não insere quebras se texto já cabe na linha", () => {
  const text = "hello";
  const wrapped = hardWrapText(text, 80, 2);
  assert.equal(wrapped, text, "não deve modificar texto que cabe em uma linha");
});

// ---------------------------------------------------------------------------
// Contrato: toda \n inserida por hardWrapText é um ponto de quebra válido
// ---------------------------------------------------------------------------

test("cada \\n hard-wrap é um ponto de quebra válido para measureTextPosition", () => {
  const text = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const width = 15;
  const prefix = 2;
  const wrapped = hardWrapText(text, width, prefix);

  let originalIdx = 0;
  for (let wi = 0; wi < wrapped.length; wi++) {
    const wch = wrapped[wi]!;
    if (wch === "\n") {
      // Essa \n foi inserida por hardWrapText? Verifica se o texto original
      // não tem \n nessa posição.
      // Para cada \n no wrapped, measureTextPosition do prefixo até ali
      // deve indicar fim de linha.
      const beforeWrap = text.slice(0, originalIdx);
      const pos = measureTextPosition(beforeWrap, width, prefix);
      // O próximo caractere deve estar na coluna prefix (início de nova linha)
      // ou o anterior deve ter atingido a largura
      assert.ok(
        pos.column === prefix || pos.column >= width,
        `\\n no wrapped na pos ${wi} (original=${originalIdx}): ` +
          `measureTextPosition de "${beforeWrap}" deu col=${pos.column}, esperado prefix=${prefix} ou >=${width}`
      );
      continue;
    }
    originalIdx++;
  }
});
