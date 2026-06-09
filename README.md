<div align="center">

**🌐 Idioma:** Português | [English](docs/i18n/README.en.md) | [Español](docs/i18n/README.es.md) | [简体中文](docs/i18n/README.zh-Hans.md) | [हिन्दी](docs/i18n/README.hi.md)

</div>

<br/>

<div align="center">
<br/>
<br/>
<p align="center">
  <img src='https://avatars.githubusercontent.com/u/118287711?s=200&v=4' width='100' alt="DsCode"/>
</p>
<h1>DsCode</h1>

[![][github-license-shield]][github-license-link]

**Assistente de programação com IA no seu terminal.**

<br/>
</div>

O **DsCode** é um assistente de programação que roda direto no terminal. Você conversa com um modelo de IA (como o DeepSeek V4) e ele analisa, sugere, revisa e escreve código no seu projeto. Funciona em Windows, Linux e macOS.

O DsCode deriva do [DeepCode (lessweb/deepcode-cli)](https://github.com/lessweb/deepcode-cli), mas tem evolução própria e é mantido por [André Campos](https://github.com/andrelncampos).

---

## Como o DsCode funciona

```mermaid
flowchart TD
    U[👤 Usuário digita um prompt] --> S[🧠 LLM processa o contexto]
    S --> T{🛠️ Precisa de ferramentas?}
    T -->|Sim| F[📂 Lê/escreve arquivos<br/>💻 Executa comandos bash<br/>🔍 Busca com glob/grep<br/>🌐 Acessa web]
    F --> P{🔐 Permissão?}
    P -->|Permitido| S
    P -->|Negado/Perguntar| U
    T -->|Não| R[💬 Resposta no terminal]
    R --> U
```

O DsCode funciona em **sessões**. Cada sessão é uma conversa contínua. A IA usa **ferramentas** (ler arquivos, executar comandos, editar código, buscar na web) para realizar tarefas. Você pode **confirmar, negar ou configurar permissões** para cada tipo de ação.

---

## Para quem é o DsCode

- **Desenvolvedoras e desenvolvedores** que querem ajuda da IA para tarefas do dia a dia.
- **Tech leads** que precisam revisar ou entender bases de código rapidamente.
- **Quem já usa IA para programar** e quer um fluxo rápido, integrado ao terminal.
- **Equipes que querem padronizar** o uso de prompts, skills, agentes e steering.
- **Pessoas que usam DeepSeek V4** e querem tirar proveito de thinking mode, reasoning effort e KV Cache.

---

## O que o DsCode ajuda a fazer

| Tarefa | Como o DsCode ajuda |
|---|---|
| **Analisar uma base de código** | Pergunte "Explique a arquitetura deste projeto" e a IA lê os arquivos e responde. |
| **Revisar código** | Pergunte "Revise as alterações deste diff antes de commitar". |
| **Implementar funcionalidades** | Descreva o que você precisa e a IA gera ou edita arquivos. |
| **Refatorar** | Peça "Simplifique esta função sem mudar o comportamento". |
| **Investigar bugs** | Cole um stack trace e peça ajuda para encontrar a causa. |
| **Criar ou usar skills** | Skills são guias que ensinam a IA a trabalhar de um jeito específico. |
| **Trabalhar com Git** | A IA sugere branches, mensagens de commit e faz alterações versionadas. |
| **Configurar raciocínio** | Ative o *thinking mode* para tarefas difíceis — a IA "pensa" antes de responder. |
| **Integrar ferramentas externas** | Com MCP, conecte bancos de dados, navegadores, APIs e outras ferramentas. |

---

## Instalação

### Via npm (recomendado)

```bash
npm install -g @andrelncampos/dscode
```

**Pré-requisito**: [Node.js](https://nodejs.org) versão **22** ou superior.

```bash
dscode --version   # verifica instalação
npm update -g @andrelncampos/dscode   # atualiza
npm uninstall -g @andrelncampos/dscode   # desinstala
```

### Via binário (futuro)

> ⚠️ **Ainda não há releases publicadas.** As instruções abaixo mostram o formato quando a primeira release for publicada.

| Sistema | Arquivo |
|---|---|
| Windows (x64) | `dscode-windows-x64.zip` |
| Linux (x64) | `dscode-linux-x64.tar.gz` |
| macOS (Intel x64) | `dscode-macos-x64.tar.gz` |
| macOS (Apple Silicon) | `dscode-macos-arm64.tar.gz` |

Cada release inclui `checksums.txt` com hashes SHA256.

### A partir do código-fonte

```bash
git clone https://github.com/andrelncampos/dscode.git
cd dscode
npm ci
npm run build
npm link
dscode --version
```

---

## Configuração inicial

O DsCode lê configurações de `~/.dscode/settings.json` (usuário) e `.dscode/settings.json` (projeto). Variáveis de ambiente com prefixo `DEEPCODE_` também são reconhecidas.

### Exemplo mínimo

```json
{
  "env": {
    "MODEL": "deepseek-v4-pro",
    "BASE_URL": "https://api.deepseek.com",
    "API_KEY": "sua-chave-aqui"
  },
  "thinkingEnabled": true,
  "reasoningEffort": "max"
}
```

### Onde conseguir a chave de API

| Provedor | Link |
|---|---|
| **DeepSeek** | [platform.deepseek.com](https://platform.deepseek.com) → API Keys |
| **OpenAI** | [platform.openai.com](https://platform.openai.com) → API Keys |
| **Anthropic** | [console.anthropic.com](https://console.anthropic.com) → API Keys |

### Opções de configuração

| Campo | Tipo | Descrição | Padrão |
|---|---|---|---|
| `env.MODEL` | string | Modelo de IA | `deepseek-v4-pro` |
| `env.BASE_URL` | string | URL base da API | `https://api.deepseek.com` |
| `env.API_KEY` | string | Chave de API | *(obrigatório)* |
| `thinkingEnabled` | boolean | Modo de raciocínio | `true` (DeepSeek) |
| `reasoningEffort` | string | `"high"` ou `"max"` | `"max"` (V4 Pro) |
| `temperature` | number | Criatividade (0–2) | *(provedor)* |
| `maxTokens` | number | Limite de tokens/resposta | 65536 (Pro) / 32768 (Flash) |
| `debugLogEnabled` | boolean | Logs em `~/.dscode/logs/` | `false` |
| `telemetryEnabled` | boolean | Estatísticas anônimas | `false` |
| `permissions` | object | Controle fino de permissões | *(tudo permitido)* |
| `mcpServers` | object | Servidores MCP | *(nenhum)* |
| `notify` | string | Script pós-tarefa | *(nenhum)* |
| `modelPricing` | object | Preços customizados por modelo | *(preços padrão DeepSeek V4)* |

### Preços de modelo (`modelPricing`)

O DsCode calcula o custo estimado da sessão com base nos tokens usados. Os preços padrão são:

| Modelo | Input (1M tokens) | Output (1M tokens) | Cache Read (1M tokens) |
|---|---|---|---|
| `deepseek-v4-pro` | $0.435 | $0.87 | $0.003625 |
| `deepseek-v4-flash` | $0.14 | $0.28 | $0.0028 |

Para usar preços customizados (ou adicionar um modelo não suportado):

```json
{
  "modelPricing": {
    "meu-modelo": {
      "inputPrice": 0.50,
      "outputPrice": 1.00,
      "cacheReadPrice": 0.05
    }
  }
}
```

O custo aparece no canto superior direito durante a sessão: `⚡ 42.3K 💰 $0.15`.

---

## Arquivos e estrutura

O DsCode organiza seus dados em diretórios `.dscode/` no projeto e no home do usuário:

```
meu-projeto/
├── .dscode/                   # Config e dados do projeto
│   ├── settings.json          # Configurações locais (opcional)
│   ├── AGENTS.md              # Instruções e regras de steering
│   ├── sessions-index.json    # Índice de sessões
│   ├── <session-id>.jsonl     # Mensagens de cada sessão
│   └── specs/                 # Documentos SDD
│       ├── vision.md          # Visão do produto
│       ├── arch.md            # Arquitetura
│       ├── roadmap.md         # Roadmap com status dos specs
│       ├── adr.md             # Decisões de arquitetura
│       └── lessons.md         # Lições aprendidas
│
~/.dscode/                     # Config do usuário
├── settings.json              # Chave de API, modelo padrão
└── logs/debug.log             # Logs de depuração

~/.agents/skills/<skill>/SKILL.md    # Skills do usuário
./.agents/skills/<skill>/SKILL.md    # Skills do projeto
```

⚠️ **Segurança**: Nunca comite `settings.json` (contém a chave de API). O `.gitignore` já o exclui.

---

## Primeiro uso em 5 minutos

### Passo 1: Instale

```bash
npm install -g @andrelncampos/dscode
```

### Passo 2: Configure sua chave

Crie `~/.dscode/settings.json` com sua chave de API e modelo preferido (veja a seção de Configuração acima).

### Passo 3: Abra uma pasta de projeto

```bash
cd /caminho/do/seu/projeto
```

Pode ser qualquer projeto: um repositório Git, um projeto pessoal, até uma pasta vazia.

### Passo 4: Inicie o DsCode

```bash
dscode
```

Você verá uma tela de boas-vindas com um campo de texto. O assistente está pronto.

**Dica:** Digite `@` para buscar e mencionar arquivos do projeto — a IA pode ler e editar os arquivos que você referenciar.

### Passo 5: Pergunte algo simples

Digite no campo de prompt:

```
Explique a estrutura deste projeto em 3 frases.
```

Pressione **Enter**. A IA analisará os arquivos do projeto e responderá.

### Passo 6: Peça uma análise útil

```
Analise o código-fonte e aponte possíveis melhorias, sem alterar nada.
```

A IA examinará o código e sugerirá melhorias. Use `Ctrl+O` para expandir o output ou ver processos em execução.

### Passo 7: Revise e faça commit

Quando a IA fizer alterações em arquivos, **revise cada diff** antes de commitar. O DsCode mostra o que foi alterado e você decide se aceita.

> 💡 **Dica**: Faça um commit (`git commit`) antes de pedir tarefas grandes. Se algo der errado, você pode desfazer com `git reset --hard`.

---

## Todos os comandos slash

Digite `/` no prompt para abrir o menu. São **20 comandos built-in** + skills dinâmicos (`/<skill-name>`):

### Sessão

| Comando | Descrição |
|---|---|
| `/new` | Nova conversa — zera o contexto |
| `/resume` | Retomar uma conversa anterior |
| `/continue` | Continuar a conversa ativa (ou retomar se vazia) |
| `/undo` | Restaurar código e/ou conversa para um checkpoint anterior |

### Modelo e exibição

| Comando | Descrição |
|---|---|
| `/model` | Selecionar modelo, thinking mode e reasoning effort |
| `/raw` | Alternar modo de exibição: `lite` (resumido), `normal` (completo), `raw-scrollback` (scroll) |

### Skills e agentes

| Comando | Descrição |
|---|---|
| `/skills` | Listar todas as skills disponíveis (built-in + custom) |
| `/<skill-name>` | Executar uma skill específica pelo nome |
| `/init` | Criar `AGENTS.md` com instruções para a IA no projeto |
| `/steering-add` | Adicionar regra de steering na seção STEERINGS do `AGENTS.md` |
| `/steering-list` | Listar todas as regras de steering do `AGENTS.md` |

### SDD (Spec-Driven Development)

| Comando | Descrição |
|---|---|
| `/spec-init` | Inicializar estrutura SDD: `vision.md`, `arch.md`, `roadmap.md`, `adr.md`, `lessons.md` |
| `/spec-plan` | Planejar specs a partir de brainstorm, alinhar com visão e atualizar roadmap |
| `/spec-new <n>` | Criar novo spec com requisitos, design e tarefas |
| `/spec-verify <n>` | Verificar completude e alinhamento com a visão |
| `/spec-implement <n>` | Implementar todas as tarefas do spec sequencialmente |
| `/spec-audit <n>` | Auditar qualidade e corretude da implementação |
| `/spec-list` | Listar todos os specs com status do roadmap |
| `/spec-status [n]` | Mostrar status detalhado de um spec específico ou de todos |

### Ferramentas externas

| Comando | Descrição |
|---|---|
| `/mcp` | Mostrar status dos servidores MCP e ferramentas disponíveis |

### Sistema

| Comando | Descrição |
|---|---|
| `/exit` | Sair do DsCode |

---

## Sistema de Steering

O **steering** permite definir regras persistentes que a IA segue em **todas as sessões** do projeto. As regras ficam na seção `STEERINGS` do arquivo `.dscode/AGENTS.md`.

```mermaid
flowchart LR
    U[👤 /steering-add] --> A[✏️ Adiciona regra ao AGENTS.md]
    A --> S[🧠 Próxima sessão carrega a regra]
    S --> B[✅ IA segue a regra automaticamente]
    U2[👤 /steering-list] --> V[📋 Lista regras ativas]
```

**Exemplo:**
```
/steering-add sempre use português para responder
/steering-add nunca faça push sem autorização explícita
```

---

## SDD — Spec-Driven Development

O DsCode implementa um ciclo completo de desenvolvimento orientado a especificações. Todos os arquivos ficam em `.dscode/specs/`.

```mermaid
flowchart TD
    INIT["/spec-init"] --> PLAN["/spec-plan"]
    PLAN --> NEW["/spec-new &lt;n&gt;"]
    NEW --> VERIFY["/spec-verify &lt;n&gt;"]
    VERIFY -->|OK| IMPL["/spec-implement &lt;n&gt;"]
    VERIFY -->|Problemas| NEW
    IMPL --> AUDIT["/spec-audit &lt;n&gt;"]
    AUDIT -->|OK| DONE[✅ Spec concluído]
    AUDIT -->|Problemas| IMPL
```

| Arquivo | Conteúdo |
|---|---|
| `vision.md` | Visão do produto, público-alvo, proposta de valor |
| `arch.md` | Decisões de arquitetura, stack, padrões |
| `roadmap.md` | Lista de specs com status (planned/in-progress/done) |
| `adr.md` | Architecture Decision Records |
| `lessons.md` | Lições aprendidas ao longo do desenvolvimento |

---

## Skills

Skills são guias em Markdown que ensinam a IA a trabalhar de um jeito específico. O DsCode carrega skills de 3 fontes:

| Local | Uso |
|---|---|
| `templates/skills/` (built-in) | 3 skills sempre carregadas |
| `~/.agents/skills/<nome>/SKILL.md` | Skills pessoais do usuário |
| `./.agents/skills/<nome>/SKILL.md` | Skills do projeto |

### Skills built-in

| Skill | Função |
|---|---|
| **agent-drift-guard** | Detecta e corrige desvios de execução |
| **karpathy-guidelines** | Boas práticas para reduzir erros comuns de LLM |
| **plan-and-execute** | Planejamento estruturado com tracking de progresso |

---

## Atalhos de teclado

| Atalho | Ação |
|---|---|
| `Enter` | Enviar prompt |
| `Shift+Enter` | Inserir quebra de linha |
| `@` | Buscar e mencionar arquivos do projeto |
| `Tab` | Autocompletar comandos e menções |
| `/` | Abrir menu de comandos |
| `?` | Tela de ajuda com todos os atalhos |
| `Ctrl+O` | Expandir output / ver processos |
| `Ctrl+V` | Colar imagem do clipboard |
| `Ctrl+X` | Limpar imagens coladas |
| `Ctrl+C` | Cancelar / interromper IA |
| `Esc` | Fechar modais / interromper |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Desfazer / refazer no prompt |
| `Ctrl+W` | Apagar palavra anterior |
| `Ctrl+A` / `Ctrl+E` | Início / fim da linha |
| `Ctrl+K` | Apagar até o fim da linha |
| `Alt+←/→` | Navegar por palavra |
| `↑/↓` | Histórico (prompt vazio) ou menus |
| `PageUp/PageDown` | Rolar mensagens |

---

## Exemplos práticos de uso

Cada exemplo abaixo é algo que você pode digitar no campo de prompt do DsCode.

| Tarefa | O que digitar |
|---|---|
| **Entender a arquitetura** | "Explique a arquitetura deste projeto, quais são os módulos principais e como se comunicam." |
| **Encontrar bugs** | "Analise src/ em busca de possíveis bugs. Apenas aponte, não altere nada." |
| **Sugerir melhorias** | "Sugira melhorias de desempenho e legibilidade para o código em src/." |
| **Implementar uma feature** | "Adicione validação de email ao formulário de cadastro em src/form.ts." |
| **Refatorar** | "Refatore a função processData() em src/utils.ts para ficar mais clara, sem mudar o comportamento." |
| **Revisar um diff** | "Revise as alterações do último commit e aponte problemas." |
| **Criar testes** | "Crie testes unitários para a função validateUser() em src/validators.ts." |
| **Usar uma skill** | "Use a skill de revisão de segurança para auditar este código." |
| **Inicializar AGENTS.md** | Digite `/init` para criar um arquivo com instruções que a IA seguirá no projeto. |

O DsCode funciona de forma **conversacional**: você digita o que precisa, a IA responde e usa ferramentas. Você pode confirmar ou rejeitar cada ação.

---

## Conceitos essenciais

| Conceito | O que é | Quando importa |
|---|---|---|
| **Sessão** | Uma conversa contínua entre você e a IA. Cada `/new` inicia uma sessão limpa. | Comece uma nova sessão ao mudar de tarefa para evitar misturar contextos. |
| **Contexto** | Todo o histórico da conversa que a IA "lembra". Inclui suas mensagens, respostas e arquivos lidos. | Contextos longos gastam mais tokens. Use `/new` para resetar. |
| **Skills** | Guias em Markdown que ensinam a IA a seguir regras específicas. | Crie uma skill para padronizar revisões, estilo de código ou processos da equipe. |
| **Tools** | Ferramentas que a IA usa: `bash` (shell), `read`/`write`/`edit` (arquivos), `glob`/`grep` (busca), `WebSearch`/`WebFetch` (web), `AskUserQuestion` (perguntas), `UpdatePlan` (tarefas). | A IA decide quais usar. Você pode bloquear as perigosas via `permissions`. |
| **Menções `@`** | Digite `@` no prompt para buscar e referenciar arquivos do projeto. | Use para direcionar a IA: "Analise @src/utils.ts" — ela já sabe qual arquivo ler. |
| **Provider** | A empresa que fornece o modelo de IA (DeepSeek, OpenAI, Anthropic, etc.). | Escolha o provedor com base em custo, qualidade e privacidade. |
| **Modelo** | O modelo específico de IA (ex: `deepseek-v4-pro`, `gpt-4o`). | Modelos diferentes têm qualidade, velocidade e custo diferentes. |
| **Thinking mode** | A IA "pensa" (raciocina) antes de responder, gerando tokens internos que você pode ver ou não. | Ative para tarefas complexas (debug, arquitetura). Desative para agilidade. |
| **Reasoning effort** | Controla a profundidade do raciocínio: `"high"` (bom, mais rápido) ou `"max"` (melhor, mais lento). | Use `"max"` para problemas difíceis e `"high"` para o dia a dia. |
| **Prompt cache** | DeepSeek armazena em cache partes repetidas do contexto para cobrar menos tokens (KV Cache). | Acontece automaticamente. Mantenha os prompts estáveis para economizar. |
| **Logs** | Arquivos de depuração em `~/.dscode/logs/` que registram as chamadas de API. | Ative `debugLogEnabled` apenas para diagnosticar problemas. |
| **Permissões** | Controle do que a IA pode fazer: ler arquivos, escrever, acessar rede, executar comandos. | Configure permissões restritivas se quiser revisar cada ação antes da execução. |
| **Workspace** | A pasta raiz onde o DsCode está rodando. A IA só vê arquivos nesta pasta (a menos que você autorize acesso externo). | Abra o DsCode na raiz do projeto em que você quer trabalhar. |
| **Compactação** | Quando a conversa fica muito longa, o DsCode resume o histórico para caber no limite de tokens. | Automática. Você pode forçar uma nova sessão com `/new` se preferir. |

---

## Como usar com DeepSeek

O DsCode é otimizado para DeepSeek V4.

| Modelo | Melhor para | Velocidade | Custo |
|---|---|---|---|
| `deepseek-v4-pro` | Arquitetura, debug, raciocínio profundo | Normal | Maior |
| `deepseek-v4-flash` | Refatoração, revisão, tarefas rotineiras | Rápido | Menor |

### Thinking mode
- **Usar**: Tarefas complexas (debug, arquitetura, design)
- **Desativar**: Tarefas rápidas e simples
- **Exibição**: `/raw` alterna entre completo/resumido/oculto

### KV Cache — o DeepSeek **não cobra** tokens repetidos. Mantenha o system prompt estável.

---

## Como usar com OpenAI

DsCode funciona com qualquer modelo da OpenAI compatível com a API Chat Completions.

### Configuração para OpenAI

```json
{
  "env": {
    "MODEL": "gpt-4o",
    "BASE_URL": "https://api.openai.com/v1",
    "API_KEY": "sk-sua-chave-openai"
  },
  "thinkingEnabled": false
}
```

### O que muda em relação ao DeepSeek

| Funcionalidade | Com OpenAI |
|---|---|
| **Thinking mode** | ⚠️ Deve estar `false`. O reasoning effort é proprietário do DeepSeek |
| **WebSearch built-in** | ❌ Não disponível. Use MCP com servidor de busca ou peça para a IA usar WebFetch em URLs específicas |
| **KV Cache** | ❌ Não disponível (exclusivo do DeepSeek) |
| **Imagens (Ctrl+V)** | ✅ Funciona com modelos de visão (`gpt-5.5`, `gpt-5`, `gpt-4o`) |
| **Modelos suportados** | `gpt-5.5`, `gpt-5.4`, `gpt-5`, `gpt-4.5`, `gpt-4o`, `gpt-4o-mini` — qualquer Chat Completions |

### Exemplo com modelo mais barato

```json
{
  "env": {
    "MODEL": "gpt-4o-mini",
    "BASE_URL": "https://api.openai.com/v1",
    "API_KEY": "sk-sua-chave-openai"
  },
  "thinkingEnabled": false
}
```

---

## Boas práticas de segurança

| O que fazer | Por quê |
|---|---|
| **Nunca cole chaves de API em issues do GitHub** | Issues são públicas. Chaves expostas podem ser usadas por outros e gerar cobranças. |
| **Nunca faça commit do arquivo `settings.json`** | Contém sua chave de API. O `.gitignore` do projeto já o exclui, mas verifique. |
| **Revise comandos antes de permitir** | A IA pode sugerir comandos shell. Leia antes de confirmar, especialmente se envolverem `rm`, `sudo` ou rede. |
| **Faça commit antes de pedir mudanças grandes** | Se a IA fizer algo errado, `git reset --hard` desfaz tudo. Sem um commit prévio, isso não é possível. |
| **Leia os diffs antes de aceitar** | O DsCode mostra cada alteração. Revise — a IA pode cometer erros. |
| **Não cole dados sensíveis nos prompts** | Informações como senhas, tokens ou dados de clientes podem aparecer em logs ou respostas. |
| **Sanitize os logs antes de pedir ajuda** | Os logs em `~/.dscode/logs/` podem conter trechos do seu código. Remova informações confidenciais antes de compartilhar. |
| **Use uma branch separada para experimentos** | Crie `git checkout -b experimento-ia` antes de pedir mudanças grandes. Se algo der errado, descarte a branch. |

---

## Boas práticas para economizar tokens/créditos

| Prática | Explicação |
|---|---|
| **Peça análise antes de implementação** | "Analise este código e sugira melhorias" gasta menos tokens do que "Implemente X" sem contexto. |
| **Limite o escopo** | Em vez de "Melhore o projeto inteiro", diga "Melhore a função `process()` em `src/utils.ts`". |
| **Informe os arquivos relevantes** | Diga "Analise apenas os arquivos em `src/api/`" — a IA lê menos arquivos, gastando menos tokens. |
| **Use Flash para tarefas simples** | `deepseek-v4-flash` é muito mais barato. Use para tarefas rotineiras. |
| **Use Pro com moderação** | Reserve `deepseek-v4-pro` para tarefas que realmente precisam de raciocínio profundo. |
| **Mantenha os prompts concisos** | Prompts longos com informações desnecessárias desperdiçam tokens. |
| **Reinicie a sessão com `/new` para tarefas novas** | Sessões longas acumulam contexto e cada mensagem subsequente custa mais caro. |

---

## Troubleshooting

| Problema | Causa provável | Como resolver |
|---|---|---|
| `dscode: comando não encontrado` | npm global não está no PATH | Reabra o terminal. No Windows, verifique `%APPDATA%\\npm`. No Linux/macOS, verifique `~/.npm-global/bin`. |
| `Node.js version not supported` | Node abaixo da versão 22 | Instale ou atualize para [Node.js 22+](https://nodejs.org). |
| Erro 401 | Chave de API ausente ou inválida | Confira `API_KEY` em `~/.dscode/settings.json` ou na variável de ambiente. |
| Erro 429 | Limite de requisições do provedor excedido | Aguarde alguns segundos e tente novamente. Verifique seu plano na plataforma do provedor. |
| Resposta truncada | Limite de tokens atingido | Aumente `maxTokens` em `settings.json` ou digite "continue" para retomar. |
| Timeout / demora excessiva | Servidor do provedor sobrecarregado ou problema de rede | Aguarde. Se persistir, troque de modelo: use Flash em vez de Pro temporariamente. |
| Erro de permissão no Windows | npm sem permissão de escrita | Execute PowerShell como administrador ou configure o prefixo do npm. |
| Erro de permissão no Linux/macOS (EACCES) | npm global sem permissão | Configure o prefixo do npm para um diretório local ou use `sudo npm install -g`. |
| `npm run build` falhou | Erro de typecheck ou lint | Execute os comandos separadamente para identificar o erro: `npm run typecheck`, `npm run lint`, `npm run bundle`. |
| Logs não aparecem | `debugLogEnabled` está `false` (padrão) | Ative `"debugLogEnabled": true` em `settings.json`. Os logs aparecem em `~/.dscode/logs/debug.log`. |
| Modelo não reconhecido | Nome do modelo incorreto | Use os nomes exatos: `deepseek-v4-pro`, `deepseek-v4-flash`, ou um modelo compatível com OpenAI. |
| Consumo de tokens muito alto | Contexto longo ou tarefas muito amplas | Use `/new` para resetar a sessão. Seja específico sobre arquivos e escopo. |

---

## Como pedir ajuda

Se encontrar um problema, abra uma [issue no GitHub](https://github.com/andrelncampos/dscode/issues).

Ao reportar um problema, inclua:

- **Versão do DsCode**: `dscode --version`
- **Sistema operacional**: Windows 11, Ubuntu 24.04, macOS 15, etc.
- **Node.js**: `node --version`
- **Modelo usado**: `deepseek-v4-pro`, `deepseek-v4-flash`, etc.
- **Comando executado** e o erro completo
- **Logs sanitizados**, se relevante (remova chaves, tokens e dados privados)

⚠️ **Nunca envie**:
- Chaves de API ou tokens
- Seus prompts privados ou dados confidenciais do projeto
- Arquivos `.env` ou `settings.json` completos
- Logs completos sem revisão (contêm trechos do seu código)

Para vulnerabilidades de segurança, siga as instruções em [SECURITY.md](SECURITY.md). **Não abra issues públicas para falhas de segurança.**

---

## Contribuição

Contribuições são bem-vindas! Consulte o guia completo em [CONTRIBUTING.md](CONTRIBUTING.md).

Resumo rápido:

1. **Issues** são bem-vindas para bugs, features e dúvidas.
2. **Pull requests** passam por CI obrigatório (typecheck + lint + format + tests + build).
3. **PRs de segurança** ou mudanças em áreas sensíveis passam por revisão mais rigorosa.
4. Contribuidores declaram ter o direito de contribuir o código enviado.

---

## Segurança

Consulte [SECURITY.md](SECURITY.md) para a política completa.

- Reporte vulnerabilidades de forma privada (não abra uma issue pública).
- O DsCode mascara dados sensíveis nos logs de depuração, mas sempre revise antes de compartilhar.
- Mantenha sua chave de API segura: use variáveis de ambiente ou `settings.json` com permissões restritas (`chmod 600`).

---

## Licença e origem

DsCode está licenciado sob a **Licença MIT**.

Este projeto deriva de [DeepCode (lessweb/deepcode-cli)](https://github.com/lessweb/deepcode-cli), originalmente licenciado sob MIT. O aviso de copyright original é preservado em [LICENSE](LICENSE) e [NOTICE](NOTICE).

Dependências de terceiros mantêm suas próprias licenças. Consulte [NOTICE](NOTICE) para a lista de dependências e licenças.

---

## Canais oficiais

| Canal | Link |
|---|---|
| **GitHub** | [github.com/andrelncampos/dscode](https://github.com/andrelncampos/dscode) |
| **Releases** | [github.com/andrelncampos/dscode/releases](https://github.com/andrelncampos/dscode/releases) |
| **npm** | `npm install -g @andrelncampos/dscode` |
| **Issues** | [github.com/andrelncampos/dscode/issues](https://github.com/andrelncampos/dscode/issues) |

⚠️ Instale o DsCode **apenas** pelos canais oficiais acima. Não confie em versões publicadas em sites de terceiros ou links não verificados.

---

<!-- LINK GROUP -->

[github-license-link]: https://github.com/andrelncampos/dscode/blob/main/LICENSE
[github-license-shield]: https://img.shields.io/github/license/andrelncampos/dscode?color=4d6BFE&labelColor=black&style=flat-square&cacheSeconds=1800
