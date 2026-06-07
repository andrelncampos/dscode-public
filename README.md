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

## Para quem é o DsCode

O DsCode é útil para:

- **Desenvolvedoras e desenvolvedores** que querem ajuda da IA para tarefas do dia a dia.
- **Tech leads** que precisam revisar ou entender bases de código rapidamente.
- **Quem já usa IA para programar** e quer um fluxo rápido, integrado ao terminal.
- **Equipes que querem padronizar** o uso de prompts, skills e agentes para manter consistência.
- **Pessoas que usam DeepSeek V4** e querem tirar proveito de thinking mode, reasoning effort e KV Cache.

---

## O que o DsCode ajuda a fazer

| Tarefa | Como o DsCode ajuda |
|---|---|
| **Analisar uma codebase** | Peça "Explique a arquitetura deste projeto" e a IA lê os arquivos e responde. |
| **Revisar código** | Peça "Revise as alterações deste diff antes de commitar". |
| **Implementar funcionalidades** | Descreva o que precisa e a IA gera ou edita os arquivos. |
| **Refatorar** | Peça "Simplifique esta função sem mudar o comportamento". |
| **Investigar bugs** | Cole a stack trace e peça ajuda para encontrar a causa. |
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

Verifique a instalação:

```bash
dscode --version
```

**Atualização:**

```bash
npm update -g @andrelncampos/dscode
```

**Desinstalação:**

```bash
npm uninstall -g @andrelncampos/dscode
```

### Via binário (futuro)

> ⚠️ **Ainda não há releases publicadas.** As instruções abaixo mostram como será o formato quando a primeira release for publicada. Enquanto isso, use a instalação via npm acima.

Baixe o binário da [página de Releases do GitHub](https://github.com/andrelncampos/dscode/releases). Não requer Node.js — o binário é autossuficiente.

| Sistema operacional | Arquivo |
|---|---|
| Windows (x64) | `dscode-windows-x64.zip` |
| Linux (x64) | `dscode-linux-x64.tar.gz` |
| macOS (Intel x64) | `dscode-macos-x64.tar.gz` |
| macOS (Apple Silicon / ARM64) | `dscode-macos-arm64.tar.gz` |

Cada release inclui um `checksums.txt` com hashes SHA256.

### Instalação a partir do código-fonte

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

O DsCode lê suas configurações de `~/.dscode/settings.json` (pasta do usuário). Também é possível ter um `.dscode/settings.json` dentro de um projeto específico para configurações locais.

### Criando sua primeira configuração

Crie `~/.dscode/settings.json`:

```json
{
  "env": {
    "MODEL": "deepseek-v4-pro",
    "BASE_URL": "https://api.deepseek.com",
    "API_KEY": "coloque_sua_chave_aqui"
  },
  "thinkingEnabled": true,
  "reasoningEffort": "max"
}
```

### Onde conseguir sua chave de API

| Provedor | Onde obter |
|---|---|
| **DeepSeek** | [platform.deepseek.com](https://platform.deepseek.com) → API Keys |
| **OpenAI** | [platform.openai.com](https://platform.openai.com) → API Keys |
| **Anthropic** | [console.anthropic.com](https://console.anthropic.com) → API Keys |

### Configurando com variáveis de ambiente

Como alternativa ao `settings.json`, use variáveis com prefixo `DEEPCODE_`:

```bash
# Linux / macOS
export DEEPCODE_MODEL="deepseek-v4-pro"
export DEEPCODE_API_KEY="coloque_sua_chave_aqui"

# Windows PowerShell
$env:DEEPCODE_MODEL = "deepseek-v4-pro"
$env:DEEPCODE_API_KEY = "coloque_sua_chave_aqui"
```

### Opções de configuração disponíveis

| Campo | Tipo | Descrição | Padrão |
|---|---|---|---|
| `env.MODEL` | string | Modelo de IA a usar | `deepseek-v4-pro` |
| `env.BASE_URL` | string | URL base da API do provedor | `https://api.deepseek.com` |
| `env.API_KEY` | string | Chave de API do provedor | *(obrigatório)* |
| `thinkingEnabled` | boolean | Ativa modo de raciocínio | `true` para DeepSeek |
| `reasoningEffort` | string | Intensidade do raciocínio: `"high"` ou `"max"` | `"max"` para V4 Pro |
| `temperature` | number | Criatividade das respostas (0 a 2) | *(provedor define)* |
| `maxTokens` | number | Limite de tokens por resposta | 65536 (Pro) / 32768 (Flash) |
| `debugLogEnabled` | boolean | Salva logs de depuração em `~/.dscode/logs/` | `false` |
| `telemetryEnabled` | boolean | Envia estatísticas anônimas de uso | `false` |
| `permissions` | object | Controle fino de permissões | *(tudo permitido)* |
| `mcpServers` | object | Configuração de servidores MCP | *(nenhum)* |
| `notify` | string | Script executado ao final de cada tarefa | *(nenhum)* |
| `webSearchTool` | string | Script customizado de busca web | *(usa built-in)* |

⚠️ **Segurança**: Nunca compartilhe seu `settings.json`. Ele contém sua chave de API. O `.gitignore` do DsCode já exclui `*.log` e `settings.json`.

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

Pode ser qualquer projeto: um repo Git, um projeto pessoal, até uma pasta vazia.

### Passo 4: Inicie o DsCode

```bash
dscode
```

Você verá uma tela de boas-vindas com um campo de texto. O assistente está pronto.

**Dica:** Digite `@` para buscar e mencionar arquivos do projeto — a IA consegue ler e editar os arquivos que você referenciar.

### Passo 5: Peça algo simples

Digite no campo de texto:

```
Explique a estrutura deste projeto em 3 frases.
```

Pressione **Enter**. A IA analisará os arquivos do projeto e responderá.

### Passo 6: Peça uma análise útil

```
Analise o código-fonte e aponte possíveis melhorias, sem alterar nada.
```

A IA examinará a base de código e sugerirá melhorias. Use `Ctrl+O` para expandir o output ou visualizar processos em execução.

### Passo 7: Revisão e commit

Quando a IA fizer alterações em arquivos, **revise cada diff** antes de commitar. O DsCode mostra o que foi alterado e você decide se aceita ou não.

> 💡 **Dica**: Faça um commit (`git commit`) antes de pedir tarefas grandes. Se algo sair errado, você pode desfazer com `git reset --hard`.

---

## Comandos e atalhos

### Comandos slash

Digite `/` no prompt para abrir o menu de comandos:

| Comando | Ação |
|---|---|
| `/model` | Selecionar modelo, thinking mode e reasoning effort |
| `/new` | Iniciar uma nova conversa (zera o contexto) |
| `/init` | Criar arquivo `AGENTS.md` com instruções para a IA no projeto |
| `/resume` | Retomar uma conversa anterior |
| `/continue` | Continuar a conversa ativa (ou retomar se vazia) |
| `/undo` | Restaurar código ou conversa para um ponto anterior |
| `/mcp` | Mostrar status dos servidores MCP e ferramentas disponíveis |
| `/raw` | Alternar modo de exibição do raciocínio (completo, resumido, oculto) |
| `/exit` | Sair do DsCode |

### Atalhos de teclado

| Atalho | Ação |
|---|---|
| `Enter` | Enviar o prompt |
| `Shift+Enter` | Inserir quebra de linha |
| `@` | Buscar e mencionar arquivos do projeto |
| `Tab` | Autocompletar (comandos e menções de arquivo) |
| `/` | Abrir menu de comandos slash |
| `Ctrl+O` | Expandir output / ver processos em execução |
| `Ctrl+V` | Colar imagem do clipboard |
| `Ctrl+X` | Limpar imagens coladas |
| `Ctrl+C` | Cancelar prompt / interromper a IA |
| `Esc` | Fechar modais / interromper |
| `Ctrl+Z` | Desfazer última edição no prompt |
| `Ctrl+Shift+Z` | Refazer edição no prompt |
| `Ctrl+W` | Apagar palavra anterior |
| `Ctrl+A` | Ir para o início da linha |
| `Ctrl+E` | Ir para o fim da linha |
| `Ctrl+K` | Apagar da posição do cursor até o fim da linha |
| `Alt+←/→` | Navegar por palavra |
| `↑/↓` | Navegar histórico (com prompt vazio) ou menus |
| `PageUp/PageDown` | Rolar histórico de mensagens |
| `?` | Abrir/fechar tela de ajuda com todos os atalhos |

---

## Exemplos práticos de uso

Cada exemplo abaixo é algo que você pode digitar no campo de prompt do DsCode.

| Tarefa | O que digitar |
|---|---|
| **Entender a arquitetura** | "Explique a arquitetura deste projeto, quais são os módulos principais e como se comunicam." |
| **Encontrar bugs** | "Analise src/ em busca de possíveis bugs. Apenas aponte, não altere nada." |
| **Sugerir melhorias** | "Sugira melhorias de performance e legibilidade para o código em src/." |
| **Implementar feature** | "Adicione validação de email no formulário de cadastro em src/form.ts." |
| **Refatorar** | "Refatore a função processData() em src/utils.ts para ficar mais clara, sem mudar o comportamento." |
| **Revisar diff** | "Revise as alterações do último commit e aponte problemas." |
| **Criar testes** | "Crie testes unitários para a função validateUser() em src/validators.ts." |
| **Usar uma skill** | "Use a skill de revisão de segurança para auditar este código." |
| **Iniciar um AGENTS.md** | Digite `/init` para criar um arquivo com instruções que a IA seguirá no projeto. |

O DsCode funciona de forma **conversacional**: você digita o que precisa, a IA responde e executa ferramentas. Você pode confirmar ou rejeitar cada ação.

---

## Conceitos essenciais

| Conceito | O que é | Quando importa |
|---|---|---|
| **Sessão** | Uma conversa contínua entre você e a IA. Cada `/new` inicia uma sessão limpa. | Comece uma nova sessão quando mudar de tarefa para não misturar contextos. |
| **Contexto** | Todo o histórico da conversa que a IA "lembra". Inclui suas mensagens, respostas e arquivos lidos. | Contextos muito longos gastam mais tokens. Use `/new` para resetar. |
| **Skills** | Guias escritos em Markdown que ensinam a IA a seguir regras específicas. | Crie uma skill para padronizar revisões, estilo de código ou processos da sua equipe. |
| **Tools** | Ferramentas que a IA usa: `bash` (shell), `read`/`write`/`edit` (arquivos), `glob`/`grep` (busca), `WebSearch`/`WebFetch` (web), `AskUserQuestion` (perguntas), `UpdatePlan` (tarefas). | A IA decide quais usar. Você pode bloquear as perigosas via `permissions`. |
| **Menções `@`** | Digite `@` no prompt para buscar arquivos do projeto e referenciá-los. | Use para direcionar a IA: "Analise @src/utils.ts" — ela já sabe qual arquivo ler. |
| **Provider** | A empresa que fornece o modelo de IA (DeepSeek, OpenAI, Anthropic etc.). | Escolha o provedor com base em custo, qualidade e privacidade. |
| **Modelo** | O modelo específico de IA (ex: `deepseek-v4-pro`, `gpt-4o`). | Modelos diferentes têm qualidade, velocidade e custo diferentes. |
| **Thinking mode** | A IA "pensa" (raciocina) antes de responder, gerando tokens internos que você pode ou não ver. | Ative para tarefas complexas (debug, arquitetura). Desative para agilidade. |
| **Reasoning effort** | Controla a profundidade do raciocínio: `"high"` (bom, mais rápido) ou `"max"` (melhor, mais lento). | Use `"max"` para problemas difíceis e `"high"` para o dia a dia. |
| **Prompt cache** | O DeepSeek armazena partes repetidas do contexto para cobrar menos tokens (KV Cache). | Acontece automaticamente. Mantenha prompts estáveis para economizar. |
| **Logs** | Arquivos de depuração em `~/.dscode/logs/` que registram as chamadas de API. | Ative `debugLogEnabled` apenas para diagnosticar problemas. |
| **Permissões** | Controle do que a IA pode fazer: ler arquivos, escrever, acessar rede, executar comandos. | Configure permissões restritas se quiser revisar cada ação antes de executar. |
| **Workspace** | A pasta raiz onde o DsCode está rodando. A IA só vê arquivos nessa pasta (a menos que você autorize acesso externo). | Abra o DsCode na raiz do projeto que você quer trabalhar. |
| **Compactação** | Quando a conversa fica muito longa, o DsCode resume o histórico para caber no limite de tokens. | Automática. Você pode forçar uma sessão nova com `/new` se preferir. |

---

## Como usar com DeepSeek

O DsCode é otimizado para os modelos DeepSeek V4.

### Modelos suportados

| Modelo | Melhor para | Velocidade | Custo |
|---|---|---|---|
| `deepseek-v4-pro` | Tarefas complexas, arquitetura, debug, raciocínio profundo | Normal | Maior |
| `deepseek-v4-flash` | Tarefas simples, refatoração, revisão rápida | Rápido | Menor |

### Configuração para DeepSeek

```json
{
  "env": {
    "MODEL": "deepseek-v4-pro",
    "BASE_URL": "https://api.deepseek.com",
    "API_KEY": "coloque_sua_chave_aqui"
  },
  "thinkingEnabled": true,
  "reasoningEffort": "max"
}
```

### Thinking mode

O *thinking mode* permite que a IA raciocine antes de responder. Os tokens de raciocínio aparecem (dependendo do modo de exibição) e você pode ver como a IA chegou à conclusão.

- **Quando usar**: Tarefas que exigem análise profunda (arquitetura, debug complexo, decisões de design).
- **Quando desativar**: Tarefas simples e rápidas (refatoração pequena, responder dúvidas pontuais).
- **Controle de exibição**: Use `/raw` para alternar entre ver o raciocínio completo, resumido ou oculto.

### Reasoning effort

- **`"max"`**: Raciocínio mais profundo. Ideal para o V4 Pro em tarefas complexas. Gasta mais tokens.
- **`"high"`**: Bom equilíbrio. Suficiente para a maioria das tarefas do dia a dia.

### KV Cache (economia automática)

O DeepSeek armazena partes repetidas do contexto em cache (KV Cache) e **não cobra** pelos tokens cacheados. Para aproveitar:

- Mantenha o início das conversas estável (system prompt, instruções iniciais).
- Evite reiniciar a sessão sem necessidade — manter a conversa reduz custo.
- O DsCode gerencia o cache automaticamente; você não precisa fazer nada.

### Cuidados com custo

- O V4 Pro gasta mais tokens por resposta. Use para tarefas que realmente precisam.
- O V4 Flash é mais barato e rápido. Use para revisões, refatorações e tarefas cotidianas.
- Monitore seu consumo na [plataforma DeepSeek](https://platform.deepseek.com).

### Boas práticas para DeepSeek

1. Use `deepseek-v4-pro` para tarefas estratégicas e `deepseek-v4-flash` para o dia a dia.
2. Mantenha `thinkingEnabled: true` — o raciocínio melhora significativamente a qualidade.
3. Se a resposta for truncada, peça "continue" — a IA retoma de onde parou.
4. Evite prompts gigantescos. Seja específico sobre quais arquivos analisar.

---

## Boas práticas de segurança

| O que fazer | Por quê |
|---|---|
| **Nunca cole API keys em issues do GitHub** | Issues são públicas. Chaves expostas podem ser usadas por outras pessoas e gerar cobrança. |
| **Nunca faça commit do arquivo `settings.json`** | Ele contém sua chave de API. O `.gitignore` do projeto já o exclui, mas confira. |
| **Revise comandos antes de permitir** | A IA pode sugerir comandos shell. Leia antes de confirmar, especialmente se envolver `rm`, `sudo` ou rede. |
| **Faça commit antes de pedir alterações grandes** | Se a IA fizer algo errado, `git reset --hard` desfaz tudo. Sem commit prévio, isso não é possível. |
| **Leia diffs antes de aceitar** | O DsCode mostra cada alteração. Revise — a IA pode cometer erros. |
| **Não cole dados sensíveis nos prompts** | Informações como senhas, CPF, tokens ou dados de clientes podem aparecer em logs ou na resposta. |
| **Sanitize logs antes de pedir ajuda** | Logs em `~/.dscode/logs/` podem conter trechos do seu código. Remova informações confidenciais antes de compartilhar. |
| **Use uma branch separada para experimentos** | Crie `git checkout -b experimento-ia` antes de pedir alterações grandes. Se algo der errado, descarte a branch. |

---

## Boas práticas para economizar tokens e créditos

| Prática | Explicação |
|---|---|
| **Peça análise antes de implementação** | "Analise este código e sugira o que melhorar" gasta menos tokens do que "Implemente X" sem contexto. |
| **Limite o escopo** | Em vez de "Melhore o projeto inteiro", diga "Melhore a função `processar()` em `src/utils.ts`". |
| **Informe os arquivos relevantes** | Diga "Analise apenas os arquivos em `src/api/`" — a IA lê menos arquivos, gasta menos tokens. |
| **Use Flash para tarefas simples** | O `deepseek-v4-flash` é muito mais barato. Use para tarefas rotineiras. |
| **Use Pro com moderação** | Reserve o `deepseek-v4-pro` para tarefas que realmente exigem raciocínio profundo. |
| **Mantenha prompts objetivos** | Prompts longos com informações desnecessárias gastam tokens à toa. |
| **Reinicie a sessão com `/new` para tarefas novas** | Sessões muito longas acumulam contexto e cada mensagem subsequente custa mais caro. |

---

## Troubleshooting

| Problema | Causa provável | Como resolver |
|---|---|---|
| **`dscode: comando não encontrado`** | O npm global não está no PATH | Reabra o terminal. No Windows, verifique `%APPDATA%\npm`. No Linux/macOS, verifique `~/.npm-global/bin`. |
| **`Node.js version not supported`** | Node inferior à versão 22 | Instale ou atualize o [Node.js 22+](https://nodejs.org). |
| **`npm ci` falhou** | Dependências inconsistentes | Delete `node_modules` e `package-lock.json`, depois rode `npm install`. |
| **Erro 401 (Unauthorized)** | API key ausente ou inválida | Verifique se `API_KEY` está correto em `~/.dscode/settings.json` ou na variável de ambiente. |
| **Erro 429 (Too Many Requests)** | Limite de requisições do provedor excedido | Aguarde alguns segundos e tente novamente. Verifique seu plano na plataforma do provedor. |
| **Resposta truncada** | Limite de tokens atingido | Aumente `maxTokens` em `settings.json` ou digite "continue" para a IA retomar. |
| **Timeout / demora excessiva** | Servidor do provedor sobrecarregado ou problema de rede | Aguarde. Se persistir, troque o modelo: use Flash em vez de Pro temporariamente. |
| **Erro de permissão no Windows** | npm sem permissão de escrita | Execute o PowerShell como administrador ou configure o prefixo do npm. |
| **Erro de permissão no Linux/macOS (EACCES)** | npm global sem permissão | Configure o prefixo do npm para um diretório local ou use `sudo npm install -g`. |
| **`npm run build` falhou** | Erro de typecheck ou lint | Rode os comandos separadamente para identificar o erro: `npm run typecheck`, `npm run lint`, `npm run bundle`. |
| **Logs não estão aparecendo** | `debugLogEnabled` está `false` (padrão) | Ative `"debugLogEnabled": true` em `settings.json`. Logs aparecem em `~/.dscode/logs/debug.log`. |
| **Modelo não reconhecido** | Nome do modelo incorreto | Use os nomes exatos: `deepseek-v4-pro`, `deepseek-v4-flash`, ou um modelo OpenAI-compatible válido. |
| **Consumo de tokens muito alto** | Contexto longo ou tarefas muito amplas | Use `/new` para resetar a sessão. Seja específico sobre arquivos e escopo. |
| **Erro em repositórios grandes** | Arquivos ignorados não estão sendo pulados | O DsCode respeita `.gitignore`. Verifique se seu `.gitignore` está correto. |

---

## Como pedir ajuda

Se você encontrar um problema, abra uma [issue no GitHub](https://github.com/andrelncampos/dscode/issues).

Ao relatar um problema, inclua:

- **Versão do DsCode**: `dscode --version`
- **Sistema operacional**: Windows 11, Ubuntu 24.04, macOS 15, etc.
- **Node.js**: `node --version`
- **Modelo usado**: `deepseek-v4-pro`, `deepseek-v4-flash`, etc.
- **Comando executado** e o erro completo
- **Logs sanitizados**, se relevante (remova chaves, tokens e dados privados)

⚠️ **Nunca envie**:
- Chaves de API ou tokens
- Seus prompts privados ou dados de projeto confidenciais
- Arquivos `.env` ou `settings.json` completos
- Logs completos sem revisão (contêm trechos do seu código)

Para vulnerabilidades de segurança, siga as instruções em [SECURITY.md](./SECURITY.md). **Não abra issues públicas para falhas de segurança.**

---

## Contribuição

Contribuições são bem-vindas! Veja o guia completo em [CONTRIBUTING.md](./CONTRIBUTING.md).

Resumo rápido:

1. **Issues** são bem-vindas para bugs, features e dúvidas.
2. **Pull requests** passam por CI obrigatório (typecheck + lint + format + tests + build).
3. **PRs de segurança** ou mudanças em áreas sensíveis passam por revisão rigorosa.
4. Contribuidores declaram ter o direito de contribuir com o código enviado.

---

## Segurança

Veja [SECURITY.md](./SECURITY.md) para a política completa.

- Reporte vulnerabilidades privadamente (não abra issue pública).
- O DsCode mascara dados sensíveis em logs de depuração, mas revise sempre antes de compartilhar.
- Mantenha sua chave de API segura: use variáveis de ambiente ou `settings.json` com permissões restritas (`chmod 600`).

---

## Licença e origem

O DsCode é licenciado sob a **Licença MIT**.

Este projeto deriva do [DeepCode (lessweb/deepcode-cli)](https://github.com/lessweb/deepcode-cli), originalmente licenciado sob MIT. O aviso de copyright original está preservado no arquivo [LICENSE](./LICENSE) e em [NOTICE](./NOTICE).

Dependências de terceiros mantêm suas próprias licenças. Consulte [NOTICE](./NOTICE) para a lista de dependências e suas licenças.

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
