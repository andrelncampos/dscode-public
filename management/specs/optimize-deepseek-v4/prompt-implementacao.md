# PROMPT PARA MOTOR DEEPSEEK V4 PRO — Otimização da Integração DeepSeek V4

> **Instruções**: Você deve implementar todas as alterações descritas abaixo, uma a uma, na ordem especificada. Ao final, execute `npm run check && npm test` e corrija quaisquer erros encontrados (desde que a correção não viole a spec). Não altere nada além do especificado. Preserve a indentação existente (2 espaços). Use aspas duplas para strings (consistente com o resto do código). Adicione `@ts-expect-error` (comentário) apenas onde o compilador legítimamente reclamar de algo intencional.

---

## Tarefa 1: Remover nomes de modelos depreciados

### 1.1 — `src/common/model-capabilities.ts`

**Remover** `"deepseek-chat"` e `"deepseek-reasoner"` do `Set` `NON_MULTIMODAL_MODELS`.

Estado atual:
```typescript
export const NON_MULTIMODAL_MODELS = new Set([
  "deepseek-v4-pro",
  "deepseek-v4-flash",
  "deepseek-chat",
  "deepseek-reasoner",
]);
```

Estado desejado:
```typescript
export const NON_MULTIMODAL_MODELS = new Set([
  "deepseek-v4-pro",
  "deepseek-v4-flash",
]);
```

### 1.2 — Atualizar os arquivos de teste

Substituir todas as ocorrências de `"deepseek-chat"` e `"deepseek-reasoner"` que aparecem como literais de string de modelo por `"deepseek-v4-flash"` (ou `"deepseek-v4-pro"` quando o contexto for de reasoning/teste de thinking) nos arquivos:

- `src/tests/openai-message-converter.test.ts` (linha 107)
- `src/tests/session.test.ts` (linhas 159, 162, 187)
- `src/tests/prompt.test.ts` (linha 178)

Para cada caso, leia o contexto do teste e decida: se o teste é sobre comportamento NON_MULTIMODAL (filtragem de imagem), use `"deepseek-v4-flash"`; se é sobre thinking/reasoning, use `"deepseek-v4-pro"`. Se houver ambiguidade, use `"deepseek-v4-pro"`.

---

## Tarefa 2: Corrigir heurística de estimativa de tokens

### 2.1 — `src/session.ts` — método `estimateContextTokens`

**Motivo**: A heurística `Math.ceil(total / 4)` subestima tokens (equivale a 0.25 token/caractere). A documentação da DeepSeek indica ~0.3 token/caractere para inglês e ~0.6 para chinês. O método `estimateStreamTokens` já usa 0.3/0.6 por caractere. Vamos unificar.

Estado atual (linhas ~170-177):
```typescript
private estimateContextTokens(messages: SessionMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    if (msg.compacted) continue;
    total += msg.content?.length ?? 0;
    if (msg.messageParams) {
      total += JSON.stringify(msg.messageParams).length;
    }
  }
  return Math.ceil(total / 4);
}
```

Estado desejado:
```typescript
private estimateContextTokens(messages: SessionMessage[]): number {
  let estimatedTokens = 0;
  for (const msg of messages) {
    if (msg.compacted) continue;
    if (msg.content) {
      estimatedTokens += this.estimateStreamTokens(msg.content);
    }
    if (msg.messageParams) {
      estimatedTokens += this.estimateStreamTokens(JSON.stringify(msg.messageParams));
    }
  }
  return Math.ceil(estimatedTokens);
}
```

**Explicação**: Reutilizamos `estimateStreamTokens` (que pesa 0.3 para ASCII/Latim e 0.6 para CJK) em vez de `chars / 4`. Isso é mais preciso e consistente internamente.

### 2.2 — Reduzir o threshold de compactação para compensar a estimativa mais realista

**Motivo**: Com a estimativa corrigida (mais alta), o threshold atual de 512K "estimados" pode corresponder a ~800K-1M tokens reais em cenários com texto CJK. Para segurança com a janela de 1M, reduzimos o threshold para 384K *estimados* (que corresponderá a aproximadamente 500-650K tokens reais, deixando margem para o output de 384K tokens).

Em `src/session.ts`, mude a constante na linha 75:

Estado atual:
```typescript
const DEEPSEEK_V4_COMPACT_PROMPT_TOKEN_THRESHOLD = 512 * 1024;
```

Estado desejado:
```typescript
const DEEPSEEK_V4_COMPACT_PROMPT_TOKEN_THRESHOLD = 384 * 1024;
```

---

## Tarefa 3: Adicionar `max_tokens` configurável e enviá-lo nas chamadas à API

### 3.1 — `src/settings.ts` — Adicionar campos

Adicione ao tipo `DeepcodingEnv` (depois de `TELEMETRY_ENABLED`):
```typescript
MAX_TOKENS?: string;
```

Adicione ao tipo `DeepcodingSettings` (depois de `telemetryEnabled`):
```typescript
maxTokens?: number;
```

Adicione ao tipo `ResolvedDeepcodingSettings` (depois de `telemetryEnabled`):
```typescript
maxTokens: number;
```

Adicione a função auxiliar `parseMaxTokens` (antes de `resolveSettingsSources`):
```typescript
function parseMaxTokens(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 1 ? Math.round(value) : undefined;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 1 ? Math.round(parsed) : undefined;
  }
  return undefined;
}
```

### 3.2 — `src/settings.ts` — Resolver `maxTokens` em `resolveSettingsSources`

Adicione, após a resolução de `telemetryEnabled`, o seguinte bloco:

```typescript
const maxTokens =
  parseMaxTokens(systemEnv.MAX_TOKENS) ??
  parseMaxTokens(projectSettings?.maxTokens) ??
  parseMaxTokens(projectEnv.MAX_TOKENS) ??
  parseMaxTokens(userSettings?.maxTokens) ??
  parseMaxTokens(userEnv.MAX_TOKENS) ??
  (DEEPSEEK_V4_MODELS.has(model) ? 32768 : 0);
```

E adicione `maxTokens` ao objeto retornado (após `telemetryEnabled`):
```typescript
maxTokens,
```

**Default**: 32768 tokens para V4, 0 (ilimitado / não enviar) para outros modelos.

### 3.3 — `src/common/openai-client.ts` — Propagar `maxTokens`

Adicione `maxTokens: number` ao tipo de retorno de `createOpenAIClient` (após `telemetryEnabled`). No objeto retornado, adicione:
```typescript
maxTokens: settings.maxTokens,
```

### 3.4 — `src/session.ts` — Enviar `max_tokens` na chamada à API

Em `activateSession`, na chamada a `createChatCompletionStream`, adicione `max_tokens` ao objeto `request` **quando `maxTokens > 0`**. Faça isso no bloco onde o request é construído (linha ~780).

Extraia `maxTokens` da desestruturação de `createOpenAIClient()`.

Adicione ao objeto passado como primeiro argumento de `createChatCompletionStream`:

```typescript
...(maxTokens > 0 ? { max_tokens: maxTokens } : {}),
```

antes de `tools: cachedTools`.

---

## Tarefa 4: Mudar default de `reasoningEffort` de `"max"` para `"high"`

### 4.1 — `src/common/openai-thinking.ts`

Estado atual (linha 23):
```typescript
reasoningEffort: ReasoningEffort = "max"
```

Estado desejado:
```typescript
reasoningEffort: ReasoningEffort = "high"
```

### 4.2 — `src/settings.ts`

Na função `resolveSettingsSources`, o fallback atual é `"max"` (linha ~302). Mude para `"high"`:

Estado atual:
```typescript
??
"max";
```

Estado desejado:
```typescript
??
"high";
```

### 4.3 — `src/common/reasoning-effort-manager.ts`

O estado inicial do manager (`currentEffort`) deve começar em `"high"`, não `"max"`. Já está correto (`"high"` na linha 62). Não alterar.

---

## Tarefa 5: Timeout de API por modelo

### 5.1 — `src/common/api-timeout.ts`

Substituir a constante fixa por uma função que recebe o modelo.

Estado atual:
```typescript
export const DEFAULT_API_TIMEOUT_MS = 120_000;
```

Estado desejado:
```typescript
export const DEFAULT_API_TIMEOUT_MS = 180_000;
export const FLASH_API_TIMEOUT_MS = 180_000;
export const PRO_API_TIMEOUT_MS = 300_000;
```

Adicione a importação no topo:
```typescript
import { DEEPSEEK_V4_MODELS } from "./model-capabilities";
```

Substitua `resolveApiTimeoutMs()` por:

```typescript
export function resolveApiTimeoutMs(model?: string): number {
  const raw = process.env.DEEPCODE_API_TIMEOUT_MS;
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= MIN_API_TIMEOUT_MS) {
      return Math.round(parsed);
    }
  }

  if (model) {
    if (model === "deepseek-v4-pro") {
      return PRO_API_TIMEOUT_MS;
    }
    if (model === "deepseek-v4-flash") {
      return FLASH_API_TIMEOUT_MS;
    }
    if (DEEPSEEK_V4_MODELS.has(model)) {
      return PRO_API_TIMEOUT_MS;
    }
  }

  return DEFAULT_API_TIMEOUT_MS;
}
```

### 5.2 — `src/session.ts` — Passar modelo para `resolveApiTimeoutMs`

No método `createChatCompletionStream`, localize a chamada `resolveApiTimeoutMs()` (linha ~480). Altere para:

```typescript
const timeoutMs = resolveApiTimeoutMs(typeof request.model === "string" ? request.model : undefined);
```

---

## Tarefa 6: Não enviar `temperature` em thinking mode

### 6.1 — `src/session.ts` — `activateSession`

Localize a construção do objeto `request` passado para `createChatCompletionStream`. A linha atual é:

```typescript
...(temperature !== undefined ? { temperature } : {}),
```

Altere para:

```typescript
...(temperature !== undefined && !thinkingEnabled ? { temperature } : {}),
```

**Motivo**: Em thinking mode, a DeepSeek ignora `temperature`. Enviá-lo é inofensivo mas desnecessário. Ao suprimir, deixamos o comportamento mais previsível e o código mais autoconsciente.

---

## Tarefa 7: Snapshots de teste

Atualize as snapshots de teste para refletir as novas constantes. Execute:

```bash
npm test
```

Se houver falhas em testes que comparam valores literais antigos (ex: timeout, threshold), atualize os valores esperados nos arquivos de teste. **Não enfraqueça os testes** — apenas ajuste os números para os novos defaults.

---

## Tarefa 8: Verificação final

Após todas as alterações, execute:

```bash
npm run check && npm test
```

Corrija erros de typecheck, lint ou formatação. Erros de teste devem ser corrigidos ajustando as expectativas (não removendo testes).

---

## Resumo dos defaults finais (para referência)

| Configuração | Antes | Depois |
|---|---|---|
| Modelos depreciados | Incluídos | Removidos |
| Token estimation | `chars / 4` | `estimateStreamTokens` (0.3/0.6 por char) |
| Compact threshold | 512K | 384K |
| `max_tokens` | Não enviado | 32768 (V4), 0 (outros) |
| `reasoning_effort` default | `"max"` | `"high"` |
| API timeout Pro | 120s | 300s |
| API timeout Flash | 120s | 180s |
| `temperature` em thinking mode | Enviado | Suprimido |
