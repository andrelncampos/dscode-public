# Translation Guide (Guia de Tradução)

## Source language

The primary (source) document is [`README.md`](../../README.md) in **Brazilian Portuguese (pt-BR)**.

All translations must maintain:
- The same section structure
- The same commands and code blocks
- The same security warnings
- The same file names and links
- The same conceptual content

## Translation rules

1. **Do not translate**:
   - Command names (`dscode`, `npm install`, `git clone`)
   - Environment variable names (`DEEPCODE_MODEL`, `DEEPCODE_API_KEY`)
   - Model names (`deepseek-v4-pro`, `deepseek-v4-flash`)
   - Field names in JSON (`MODEL`, `BASE_URL`, `API_KEY`)
   - Technical identifiers (`settings.json`, `.deepcode/`, `AGENTS.md`)
   - File paths or URLs
   - Proper names (DsCode, DeepSeek, OpenAI, Anthropic, DeepCode)

2. **Translate naturally**:
   - Explanatory text
   - Section titles and descriptions
   - Table content (except technical terms)
   - Tips, warnings, and notes
   - Troubleshooting descriptions

3. **When a technical term has no standard translation**, keep it in English and explain it in the target language.

4. **Never reduce content**. All sections present in pt-BR must be present in every translation.

5. **Never add promises, features, or information** that are not in the original pt-BR version.

6. **Language selector** at the top of each file must link to all other languages.

## Standardized terminology

| English | Português (pt-BR) | Español | 简体中文 (zh-Hans) | हिन्दी (hi) |
|---|---|---|---|---|
| provider | provedor | proveedor | 提供商 | प्रदाता |
| model | modelo | modelo | 模型 | मॉडल |
| skill | skill | skill | skill | skill |
| agent | agente | agente | agent | agent |
| workspace | workspace | workspace | workspace | workspace |
| context | contexto | contexto | 上下文 | कॉन्टेक्स्ट |
| thinking mode | modo de raciocínio | modo de razonamiento | 推理模式 | thinking mode |
| reasoning effort | esforço de raciocínio | esfuerzo de razonamiento | 推理深度 | reasoning effort |
| prompt cache | cache de prompt | cache de prompt | prompt cache | prompt cache |
| API key | chave de API | clave de API | API 密钥 | API की |
| release | release | release | release | release |
| binary | binário | binario | 二进制文件 | बाइनरी |
| PATH | PATH | PATH | PATH | PATH |
| session | sessão | sesión | 会话 | सेशन |
| tool | ferramenta | herramienta | 工具 | टूल |
| log | log | log | 日志 | लॉग |
| permission | permissão | permiso | 权限 | अनुमति |
| token | token | token | token | टोकन |
| prompt | prompt | prompt | prompt | प्रॉम्प्ट |
| commit | commit | commit | commit | कमिट |
| branch | branch (ramo) | branch (rama) | 分支 | ब्रांच |

## Adding a new language

1. Copy `README.md` (pt-BR) as the base.
2. Translate explanatory text, keeping technical terms intact.
3. Add the language to the selector at the top of **every** README file.
4. Update this `TRANSLATION_GUIDE.md` with the new standardized terms.

## File structure

```
README.md                  ← Primary (pt-BR)
docs/
├── i18n/
│   ├── README.en.md       ← English
│   ├── README.es.md       ← Spanish
│   ├── README.zh-Hans.md  ← Simplified Chinese
│   ├── README.hi.md       ← Hindi
│   └── TRANSLATION_GUIDE.md ← This file
```

## Review checklist

Before submitting a translated README:

- [ ] All sections are present and in the same order as pt-BR
- [ ] All commands are verbatim (not translated)
- [ ] All security warnings are present
- [ ] All placeholder values are the same (`"coloque_sua_chave_aqui"` may be translated)
- [ ] Language selector links are correct
- [ ] No technical terms are mistranslated
- [ ] No new features or promises were added
- [ ] Links to LICENSE, NOTICE, SECURITY.md, CONTRIBUTING.md use correct relative paths
