# PROMPT DE CORREÇÃO — dscode PermissionPrompt com reset infinito

## OBJETIVO

Corrigir o bug em que o componente `PermissionPrompt` entra em loop de reset, pedindo autorização repetidamente a cada 5 segundos e não permitindo que o usuário responda.

## CONTEXTO DO PROBLEMA

No dscode, quando o LLM gera tool calls que exigem permissão (ex: bash com sideEffects=["network"]), o sistema deve exibir um prompt interativo para o usuário aprovar ou negar. O que está acontecendo:

- O prompt aparece por um breve instante
- Antes que o usuário possa selecionar uma opção (usando setas ou números) e pressionar Enter, o prompt desaparece e reaparece imediatamente (reset)
- Isso se repete indefinidamente, efetivamente travando a interação
- O intervalo de ~5 segundos corresponde ao tempo que o LLM leva para reprocessar quando a permissão é submetida automaticamente por engano

## DIAGNÓSTICO DETALHADO

Após análise profunda do código, identifiquei **três causas interligadas**:

### Causa 1: Submissão automática prematura (CRÍTICA)

**Arquivo:** `src/ui/views/PermissionPrompt.tsx`

O componente tem um `useEffect` que submete automaticamente quando `prompt` é `null`:

```typescript
useEffect(() => {
  if (!prompt) {
    onSubmit(buildResult(requests, decisions, alwaysAllows));
  }
}, [alwaysAllows, decisions, onSubmit, prompt, requests]);
```

Esse efeito é acionado na montagem inicial do componente se, por qualquer razão, `prompt` for `null`. Como `prompt` é derivado de `effectiveIndex >= prompts.length`, e `effectiveIndex` usa `findNextPromptIndex`, se `alwaysAllows` já contiver os scopes necessários (mesmo que por um estado residual), `prompt` será `null` e o `onSubmit` será chamado imediatamente.

Além disso, `buildResult` com `decisions` vazio (`{}`) e `alwaysAllows` vazio (`[]`) gera:
```json
{
  "permissions": [{ "toolCallId": "...", "permission": "allow" }],
  "alwaysAllows": [],
  "hasDeny": false
}
```

Isso faz `handlePermissionResult` (em `App.tsx`) chamar `handleSubmit` com `/continue` e permissões `allow` para todas as tool calls — ou seja, **aprova automaticamente tudo sem o usuário interagir**. Isso dispara o processamento, o LLM executa as ferramentas e pode gerar novas tool calls com permissões, recriando o prompt. Resultado: loop infinito.

### Causa 2: Reset de estado por mudança de referência de array

**Arquivo:** `src/ui/views/PermissionPrompt.tsx`

O `useEffect` abaixo reseta todo o estado interno (index, cursor, decisions, alwaysAllows) sempre que `requests` muda:

```typescript
useEffect(() => {
  setIndex(0);
  setCursor(0);
  setDecisions({});
  setAlwaysAllows([]);
}, [requests]);
```

`requests` é um array. Em JavaScript, arrays são comparados por referência. Se o componente pai (`App.tsx`) re-renderizar e `activeAskPermissions` for um novo array (mesmo que com exatamente o mesmo conteúdo), `requests` será uma nova referência, disparando o reset.

Isso pode acontecer quando:
- `onSessionEntryUpdated` é chamado múltiplas vezes com o mesmo array, mas recriado a cada chamada
- O contexto re-renderiza por outros motivos (ex: `busy` oscilando, `nowTick`)

### Causa 3: Possível conflito de hooks de input

**Arquivo:** `src/ui/views/App.tsx`

O componente `App` tem um `useInput` para o overlay de boas-vindas:

```typescript
useInput(
  (_input, key) => {
    if (key.return) { /* ... */ }
  },
  { isActive: shouldShowWelcomeOverlay }
);
```

Se `shouldShowWelcomeOverlay` for `true` enquanto o `PermissionPrompt` estiver tentando renderizar, o `useInput` do overlay pode capturar as teclas, impedindo o `PermissionPrompt` de receber input. Embora o código retorne o overlay quando `shouldShowWelcomeOverlay` é `true`, se houver uma condição de corrida, ambos os hooks podem estar ativos simultaneamente.

## ARQUIVOS A MODIFICAR

### 1. `src/ui/views/PermissionPrompt.tsx` (PRINCIPAL)

#### Correção A: Substituir o `useEffect` de submissão automática

**Remover completamente** o `useEffect` que chama `onSubmit` quando `prompt` é null. Em vez disso, submeter apenas quando o usuário pressionar Enter e não houver mais prompts a responder.

**Antes (remover):**
```typescript
useEffect(() => {
  if (!prompt) {
    onSubmit(buildResult(requests, decisions, alwaysAllows));
  }
}, [alwaysAllows, decisions, onSubmit, prompt, requests]);
```

**Depois (adicionar lógica no `commit`):** Modificar a função `commit` para detectar quando todas as perguntas foram respondidas e chamar `onSubmit` apenas nesse momento, e somente se houver pelo menos uma decisão tomada.

```typescript
function commit(kind: "allow" | "always" | "deny"): void {
  if (!prompt) return;

  const nextDecisions = { ...decisions };

  if (kind === "always" && isAlwaysAllowedScope(prompt.scope)) {
    const scope = prompt.scope;
    setAlwaysAllows((prev) => (prev.includes(scope) ? prev : [...prev, scope]));
    nextDecisions[prompt.request.toolCallId] = 
      nextDecisions[prompt.request.toolCallId] === "deny" ? "deny" : "allow";
  } else {
    nextDecisions[prompt.request.toolCallId] = 
      kind === "deny" ? "deny" : (nextDecisions[prompt.request.toolCallId] === "deny" ? "deny" : "allow");
  }

  setDecisions(nextDecisions);

  // Avança para o próximo prompt
  const nextIndex = findNextPromptIndex(prompts, effectiveIndex + 1, alwaysAllows);
  
  if (nextIndex >= prompts.length) {
    // Todas as perguntas respondidas — submeter
    // Só submete se pelo menos uma decisão foi tomada
    if (Object.keys(nextDecisions).length > 0) {
      onSubmit(buildResult(requests, nextDecisions, alwaysAllows));
    }
  } else {
    setIndex(nextIndex);
    setCursor(0);
  }
}
```

#### Correção B: Estabilizar o reset de estado

**Substituir o `useEffect` de reset por uma comparação profunda (deep compare) do conteúdo de `requests`.**

**Antes:**
```typescript
useEffect(() => {
  setIndex(0);
  setCursor(0);
  setDecisions({});
  setAlwaysAllows([]);
}, [requests]);
```

**Depois:**
```typescript
// Referência estável para detectar mudanças reais no conteúdo
const requestsKey = useMemo(() => JSON.stringify(requests), [requests]);

useEffect(() => {
  setIndex(0);
  setCursor(0);
  setDecisions({});
  setAlwaysAllows([]);
}, [requestsKey]); // Depende de string, não de referência do array
```

Isso garante que o reset só ocorra quando o conteúdo semântico de `requests` realmente mudar, não em toda re-renderização que crie um novo array.

#### Correção C: Remover import não utilizado

Se após as alterações o `useEffect` de submissão for removido, pode sobrar imports não utilizados. Limpe-os.

---

### 2. `src/ui/views/App.tsx`

#### Correção D: Estabilizar callbacks passados para PermissionPrompt

Os callbacks `handlePermissionResult` e `handlePermissionCancel` são recriados a cada renderização. Use `useCallback` com dependências corretas para evitar que o `PermissionPrompt` re-renderize desnecessariamente.

**Verifique as dependências de `handlePermissionResult` e `handlePermissionCancel`.** Elas já usam `useCallback`, mas certifique-se de que as dependências estão corretas e não mudam a cada render.

Adicionalmente, **memoize o array `activeAskPermissions`** antes de passá-lo:

```typescript
const stableAskPermissions = useMemo(
  () => activeAskPermissions,
  [JSON.stringify(activeAskPermissions)]
);
```

Depois passe `stableAskPermissions` para o `PermissionPrompt`:

```jsx
<PermissionPrompt
  requests={stableAskPermissions ?? []}
  onSubmit={handlePermissionResult}
  onCancel={handlePermissionCancel}
/>
```

**Nota:** Se `activeAskPermissions` for `undefined`, use array vazio para evitar que o componente monte com `undefined` e depois com array, causando reset.

---

### 3. `src/ui/contexts/AppStateContext.tsx`

#### Correção E: Limpar `askPermissions` ao sair do estado `ask_permission`

No callback `onSessionEntryUpdated`, quando o status não for mais `ask_permission`, limpe `activeAskPermissions` para `undefined`. Isso evita que um array de permissões antigo fique "sujo" e cause re-renderizações com conteúdo desatualizado.

**Modificar `onSessionEntryUpdated`:**

```typescript
onSessionEntryUpdated: (entry) => {
  setStatusLine(buildStatusLine(entry));
  setLastBashCommand(entry.lastBashCommand);
  setSessionCwd(entry.cwd);
  setRunningProcesses(entry.processes);
  setActiveStatus(entry.status);
  
  // Só mantém askPermissions se o status for ask_permission
  if (entry.status === "ask_permission") {
    setActiveAskPermissions(entry.askPermissions);
  } else {
    setActiveAskPermissions(undefined);
  }
},
```

Isso garante que `activeAskPermissions` seja limpo quando o status mudar, evitando que o prompt de permissão permaneça "fantasma".

---

### 4. `src/session.ts` (AJUSTE COMPLEMENTAR)

#### Correção F: Limpar `askPermissions` do entry quando não mais necessário

Em `updateSessionEntry`, sempre que o status for alterado para algo diferente de `ask_permission`, o campo `askPermissions` deve ser explicitamente setado como `undefined`. Isso evita que o array de permissões antigo persista no entry e seja reenviado em atualizações futuras.

**Encontre todos os updaters que mudam o status para "processing", "completed", "waiting_for_user", etc., e adicione `askPermissions: undefined`.** Por exemplo:

```typescript
this.updateSessionEntry(sessionId, (entry) => ({
  ...entry,
  status: "processing",
  askPermissions: undefined,  // limpar explicitamente
  updateTime: new Date().toISOString(),
}));
```

**Localizações a modificar:**
- No início de `activateSession`, onde seta `status: "processing"`
- Após processar tool calls, onde seta `status: "processing"` ou `"completed"`
- Em `compactSession`, `interruptSession`, `denySessionPermission`

---

## CHECKLIST DE VALIDAÇÃO

Após implementar as correções, execute os seguintes cenários para confirmar que o bug foi resolvido:

1. **Cenário feliz:** Inicie o dscode, envie um prompt que exija permissão (ex: comando que usa rede). O prompt de permissão deve aparecer **uma única vez** e aguardar o input do usuário. O usuário consegue usar setas e Enter para selecionar uma opção.

2. **Aprovar:** Selecione "Yes" e pressione Enter. O processamento deve continuar sem pedir a mesma permissão novamente.

3. **Aprovar sempre:** Selecione "Yes, and always allow". O scope deve ser adicionado às configurações do projeto e não deve pedir permissão novamente para o mesmo scope.

4. **Negar:** Selecione "No". O sistema deve negar a permissão e permitir que o usuário adicione uma mensagem antes de continuar.

5. **Múltiplas permissões:** Se várias tool calls exigirem permissão, o prompt deve apresentar cada uma sequencialmente, sem reset.

6. **Sem loop:** Monitore o log e a interface; não deve haver submissão automática nem reaparecimento do prompt sem interação do usuário.

7. **Testes automatizados:** Execute `npm test` e certifique-se de que `permission-prompt.test.ts` e `permissions.test.ts` continuam passando.

---

## NOTAS IMPORTANTES

- **Não altere** a lógica de `computeToolCallPermissions` ou `buildScopePrompts`, pois elas estão corretas.
- **Não introduza** novos estados globais ou contextos; mantenha as mudanças localizadas nos arquivos mencionados.
- **Mantenha** a compatibilidade com o fluxo de negação de permissão (`handlePermissionResult` com `hasDeny`).
- **Preserve** a experiência do usuário: o prompt deve ser claro, responsivo e não deve "piscar".
- **Teste em todos os ambientes:** Certifique-se de que as mudanças funcionam em Windows, Linux e macOS (os testes serão executados no CI).

## ENTREGÁVEIS

1. Modificações nos arquivos conforme especificado acima.
2. Confirmação de que os testes existentes passam.
3. Descrição breve das mudanças realizadas para documentação.
