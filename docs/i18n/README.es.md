<div align="center">

**🌐 Idioma:** [Português](../../README.md) | [English](README.en.md) | Español | [简体中文](README.zh-Hans.md) | [हिन्दी](README.hi.md)

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

**Asistente de programación con IA en tu terminal.**

<br/>
</div>

**DsCode** es un asistente de programación con IA que se ejecuta directamente en la terminal. Conversas con un modelo de IA (como DeepSeek V4) y este analiza, sugiere, revisa y escribe código en tu proyecto. Funciona en Windows, Linux y macOS.

DsCode deriva de [DeepCode (lessweb/deepcode-cli)](https://github.com/lessweb/deepcode-cli), pero tiene evolución propia, mantenido por [André Campos](https://github.com/andrelncampos).

---

## Para quién es DsCode

DsCode es útil para:

- **Desarrolladoras y desarrolladores** que quieren ayuda de la IA en tareas diarias.
- **Tech leads** que necesitan revisar o entender bases de código rápidamente.
- **Personas que ya usan IA para programar** y quieren un flujo rápido integrado en la terminal.
- **Equipos que quieren estandarizar** prompts, skills y agentes para mantener consistencia.
- **Usuarios de DeepSeek V4** que quieren aprovechar el thinking mode, reasoning effort y KV Cache.

---

## Qué ayuda a hacer DsCode

| Tarea | Cómo ayuda DsCode |
|---|---|
| **Analizar una base de código** | Pregunta "Explica la arquitectura de este proyecto" y la IA lee los archivos y responde. |
| **Revisar código** | Pregunta "Revisa los cambios de este diff antes de hacer commit". |
| **Implementar funcionalidades** | Describe lo que necesitas y la IA genera o edita archivos. |
| **Refactorizar** | Pide "Simplifica esta función sin cambiar su comportamiento". |
| **Investigar bugs** | Pega un stack trace y pide ayuda para encontrar la causa. |
| **Crear o usar skills** | Las skills son guías que enseñan a la IA a trabajar de una forma específica. |
| **Trabajar con Git** | La IA sugiere ramas, mensajes de commit y hace cambios versionados. |
| **Configurar razonamiento** | Activa el *thinking mode* para tareas difíciles — la IA "piensa" antes de responder. |
| **Integrar herramientas externas** | Con MCP, conecta bases de datos, navegadores, APIs y otras herramientas. |

---

## Instalación

### Vía npm (recomendado)

```bash
npm install -g @andrelncampos/dscode
```

**Prerrequisito**: [Node.js](https://nodejs.org) versión **22** o superior.

Verifica la instalación:

```bash
dscode --version
```

**Actualización:**

```bash
npm update -g @andrelncampos/dscode
```

**Desinstalación:**

```bash
npm uninstall -g @andrelncampos/dscode
```

### Vía binario (futuro)

> ⚠️ **Aún no hay releases publicadas.** Las instrucciones a continuación muestran cómo será el formato cuando se publique la primera release. Mientras tanto, usa la instalación vía npm arriba.

Descarga el binario de la [página de Releases en GitHub](https://github.com/andrelncampos/dscode/releases). No requiere Node.js — el binario es autosuficiente.

| Sistema operativo | Archivo |
|---|---|
| Windows (x64) | `dscode-windows-x64.zip` |
| Linux (x64) | `dscode-linux-x64.tar.gz` |
| macOS (Intel x64) | `dscode-macos-x64.tar.gz` |
| macOS (Apple Silicon / ARM64) | `dscode-macos-arm64.tar.gz` |

Cada release incluye un `checksums.txt` con hashes SHA256.

### Instalación desde el código fuente

```bash
git clone https://github.com/andrelncampos/dscode.git
cd dscode
npm ci
npm run build
npm link
dscode --version
```

---

## Configuración inicial

DsCode lee su configuración de `~/.dscode/settings.json` (tu carpeta de usuario). También puedes tener un `.dscode/settings.json` dentro de un proyecto específico para configuraciones locales.

### Creando tu primera configuración

Crea `~/.dscode/settings.json`:

```json
{
  "env": {
    "MODEL": "deepseek-v4-pro",
    "BASE_URL": "https://api.deepseek.com",
    "API_KEY": "pon_tu_clave_aqui"
  },
  "thinkingEnabled": true,
  "reasoningEffort": "max"
}
```

### Dónde obtener tu clave de API

| Proveedor | Dónde obtener la clave |
|---|---|
| **DeepSeek** | [platform.deepseek.com](https://platform.deepseek.com) → API Keys |
| **OpenAI** | [platform.openai.com](https://platform.openai.com) → API Keys |
| **Anthropic** | [console.anthropic.com](https://console.anthropic.com) → API Keys |

### Configurando con variables de entorno

Como alternativa al `settings.json`, puedes usar variables de entorno. DsCode reconoce cualquier variable con prefijo `DEEPCODE_`:

```bash
# Linux / macOS
export DEEPCODE_MODEL="deepseek-v4-pro"
export DEEPCODE_API_KEY="pon_tu_clave_aqui"

# Windows PowerShell
$env:DEEPCODE_MODEL = "deepseek-v4-pro"
$env:DEEPCODE_API_KEY = "pon_tu_clave_aqui"
```

### Opciones de configuración disponibles

| Campo | Tipo | Descripción | Predeterminado |
|---|---|---|---|
| `env.MODEL` | string | Modelo de IA a usar | `deepseek-v4-pro` |
| `env.BASE_URL` | string | URL base de la API del proveedor | `https://api.deepseek.com` |
| `env.API_KEY` | string | Clave de API del proveedor | *(obligatorio)* |
| `thinkingEnabled` | boolean | Activa modo de razonamiento | `true` para DeepSeek |
| `reasoningEffort` | string | Intensidad del razonamiento: `"high"` o `"max"` | `"max"` para V4 Pro |
| `temperature` | number | Creatividad de las respuestas (0 a 2) | *(predeterminado del proveedor)* |
| `maxTokens` | number | Límite de tokens por respuesta | 65536 (Pro) / 32768 (Flash) |
| `debugLogEnabled` | boolean | Guarda logs de depuración en `~/.dscode/logs/` | `false` |
| `telemetryEnabled` | boolean | Envía estadísticas anónimas de uso | `false` |
| `permissions` | object | Control fino de permisos | *(todo permitido)* |
| `mcpServers` | object | Configuración de servidores MCP | *(ninguno)* |
| `notify` | string | Script ejecutado al final de cada tarea | *(ninguno)* |
| `webSearchTool` | string | Script personalizado de búsqueda web | *(usa integrado)* |

⚠️ **Seguridad**: Nunca compartas tu `settings.json` con otras personas. Contiene tu clave de API. El `.gitignore` del proyecto ya excluye `*.log` y `settings.json`.

---

## Primer uso en 5 minutos

### Paso 1: Instala

```bash
npm install -g @andrelncampos/dscode
```

### Paso 2: Configura tu clave

Crea `~/.dscode/settings.json` con tu clave de API y modelo preferido (consulta la sección de Configuración arriba).

### Paso 3: Abre una carpeta de proyecto

```bash
cd /ruta/de/tu/proyecto
```

Puede ser cualquier proyecto: un repo Git, un proyecto personal, incluso una carpeta vacía.

### Paso 4: Inicia DsCode

```bash
dscode
```

Verás una pantalla de bienvenida con un campo de texto. El asistente está listo.

**Consejo:** Escribe `@` para buscar y mencionar archivos del proyecto — la IA puede leer y editar los archivos que referencies.

### Paso 5: Pide algo simple

Escribe en el campo de prompt:

```
Explica la estructura de este proyecto en 3 frases.
```

Presiona **Enter**. La IA analizará los archivos del proyecto y responderá.

### Paso 6: Pide un análisis útil

```
Analiza el código fuente y señala posibles mejoras, sin cambiar nada.
```

La IA examinará la base de código y sugerirá mejoras. Usa `Ctrl+O` para expandir el output o ver procesos en ejecución.

### Paso 7: Revisión y commit

Cuando la IA haga cambios en archivos, **revisa cada diff** antes de hacer commit. DsCode muestra lo que se cambió y tú decides si aceptarlo.

> 💡 **Consejo**: Haz un commit (`git commit`) antes de pedir tareas grandes. Si algo sale mal, puedes deshacer con `git reset --hard`.

---

## Comandos y atajos

### Comandos slash

Escribe `/` en el prompt para abrir el menú de comandos:

| Comando | Acción |
|---|---|
| `/model` | Seleccionar modelo, thinking mode y reasoning effort |
| `/new` | Iniciar una nueva conversación (limpia el contexto) |
| `/init` | Crear archivo `AGENTS.md` con instrucciones para la IA en el proyecto |
| `/resume` | Retomar una conversación anterior |
| `/continue` | Continuar la conversación activa (o retomar si está vacía) |
| `/undo` | Restaurar código o conversación a un punto anterior |
| `/mcp` | Mostrar estado de servidores MCP y herramientas disponibles |
| `/raw` | Alternar modo de visualización del razonamiento (completo, resumido, oculto) |
| `/exit` | Salir de DsCode |

### Atajos de teclado

| Atajo | Acción |
|---|---|
| `Enter` | Enviar el prompt |
| `Shift+Enter` | Insertar salto de línea |
| `@` | Buscar y mencionar archivos del proyecto |
| `Tab` | Autocompletar (comandos y menciones de archivo) |
| `/` | Abrir menú de comandos slash |
| `Ctrl+O` | Expandir output / ver procesos en ejecución |
| `Ctrl+V` | Pegar imagen del portapapeles |
| `Ctrl+X` | Limpiar imágenes pegadas |
| `Ctrl+C` | Cancelar prompt / interrumpir la IA |
| `Esc` | Cerrar modales / interrumpir |
| `Ctrl+Z` | Deshacer última edición en el prompt |
| `Ctrl+Shift+Z` | Rehacer edición en el prompt |
| `Ctrl+W` | Borrar palabra anterior |
| `Ctrl+A` | Ir al inicio de la línea |
| `Ctrl+E` | Ir al final de la línea |
| `Ctrl+K` | Borrar desde el cursor hasta el final de la línea |
| `Alt+←/→` | Navegar por palabra |
| `↑/↓` | Navegar historial (con prompt vacío) o menús |
| `PageUp/PageDown` | Desplazar historial de mensajes |
| `?` | Abrir/cerrar pantalla de ayuda con todos los atajos |

---

## Ejemplos prácticos de uso

Cada ejemplo a continuación es algo que puedes escribir en el campo de prompt de DsCode.

| Tarea | Qué escribir |
|---|---|
| **Entender la arquitectura** | "Explica la arquitectura de este proyecto, cuáles son los módulos principales y cómo se comunican." |
| **Encontrar bugs** | "Analiza src/ en busca de posibles bugs. Solo señálalos, no cambies nada." |
| **Sugerir mejoras** | "Sugiere mejoras de rendimiento y legibilidad para el código en src/." |
| **Implementar feature** | "Agrega validación de email al formulario de registro en src/form.ts." |
| **Refactorizar** | "Refactoriza la función processData() en src/utils.ts para que sea más clara, sin cambiar el comportamiento." |
| **Revisar diff** | "Revisa los cambios del último commit y señala problemas." |
| **Crear tests** | "Crea tests unitarios para la función validateUser() en src/validators.ts." |
| **Usar una skill** | "Usa la skill de revisión de seguridad para auditar este código." |
| **Iniciar un AGENTS.md** | Escribe `/init` para crear un archivo con instrucciones que la IA seguirá en el proyecto. |

DsCode funciona de forma **conversacional**: escribes lo que necesitas, la IA responde y usa herramientas. Puedes confirmar o rechazar cada acción.

---

## Conceptos esenciales

| Concepto | Qué es | Cuándo importa |
|---|---|---|
| **Sesión** | Una conversación continua entre tú y la IA. Cada `/new` inicia una sesión limpia. | Comienza una nueva sesión al cambiar de tarea para no mezclar contextos. |
| **Contexto** | Todo el historial de la conversación que la IA "recuerda". Incluye tus mensajes, respuestas y archivos leídos. | Contextos muy largos gastan más tokens. Usa `/new` para reiniciar. |
| **Skills** | Guías escritas en Markdown que enseñan a la IA a seguir reglas específicas. | Crea una skill para estandarizar revisiones, estilo de código o procesos del equipo. |
| **Tools** | Herramientas que la IA usa: `bash` (shell), `read`/`write`/`edit` (archivos), `glob`/`grep` (búsqueda), `WebSearch`/`WebFetch` (web), `AskUserQuestion` (preguntas), `UpdatePlan` (tareas). | La IA decide cuáles usar. Puedes bloquear las peligrosas vía `permissions`. |
| **Menciones `@`** | Escribe `@` en el prompt para buscar y referenciar archivos del proyecto. | Usa para dirigir a la IA: "Analiza @src/utils.ts" — ya sabe qué archivo leer. |
| **Provider** | La empresa que proporciona el modelo de IA (DeepSeek, OpenAI, Anthropic, etc.). | Elige el proveedor según costo, calidad y privacidad. |
| **Modelo** | El modelo específico de IA (ej: `deepseek-v4-pro`, `gpt-4o`). | Diferentes modelos tienen calidad, velocidad y costo diferentes. |
| **Thinking mode** | La IA "piensa" (razona) antes de responder, generando tokens internos que puedes ver o no. | Actívalo para tareas complejas (debug, arquitectura). Desactívalo para agilidad. |
| **Reasoning effort** | Controla la profundidad del razonamiento: `"high"` (bueno, más rápido) o `"max"` (mejor, más lento). | Usa `"max"` para problemas difíciles y `"high"` para el día a día. |
| **Prompt cache** | DeepSeek almacena partes repetidas del contexto para cobrar menos tokens (KV Cache). | Sucede automáticamente. Mantén prompts estables para ahorrar. |
| **Logs** | Archivos de depuración en `~/.dscode/logs/` que registran las llamadas de API. | Activa `debugLogEnabled` solo para diagnosticar problemas. |
| **Permisos** | Control de lo que la IA puede hacer: leer archivos, escribir, acceder a la red, ejecutar comandos. | Configura permisos restrictivos si quieres revisar cada acción antes de ejecutarla. |
| **Workspace** | La carpeta raíz donde DsCode se está ejecutando. La IA solo ve archivos en esta carpeta (a menos que autorices acceso externo). | Abre DsCode en la raíz del proyecto en el que quieres trabajar. |
| **Compactación** | Cuando la conversación se vuelve muy larga, DsCode resume el historial para ajustarse al límite de tokens. | Automática. Puedes forzar una nueva sesión con `/new` si lo prefieres. |

---

## Cómo usar con DeepSeek

DsCode está optimizado para los modelos DeepSeek V4.

### Modelos soportados

| Modelo | Mejor para | Velocidad | Costo |
|---|---|---|---|
| `deepseek-v4-pro` | Tareas complejas, arquitectura, debug, razonamiento profundo | Normal | Mayor |
| `deepseek-v4-flash` | Tareas simples, refactorización, revisión rápida | Rápido | Menor |

### Configuración para DeepSeek

```json
{
  "env": {
    "MODEL": "deepseek-v4-pro",
    "BASE_URL": "https://api.deepseek.com",
    "API_KEY": "pon_tu_clave_aqui"
  },
  "thinkingEnabled": true,
  "reasoningEffort": "max"
}
```

### Thinking mode

El *thinking mode* permite que la IA razone antes de responder. Los tokens de razonamiento aparecen (dependiendo del modo de visualización) y puedes ver cómo la IA llegó a la conclusión.

- **Cuándo usar**: Tareas que requieren análisis profundo (arquitectura, debug complejo, decisiones de diseño).
- **Cuándo desactivar**: Tareas simples y rápidas (refactorización menor, dudas puntuales).
- **Control de visualización**: Usa `/raw` para alternar entre ver el razonamiento completo, resumido u oculto.

### Reasoning effort

- **`"max"`**: Razonamiento más profundo. Ideal para V4 Pro en tareas complejas. Gasta más tokens.
- **`"high"`**: Buen equilibrio. Suficiente para la mayoría de las tareas diarias.

### KV Cache (ahorro automático)

DeepSeek almacena partes repetidas del contexto en cache (KV Cache) y **no cobra** por los tokens cacheados. Para aprovecharlo:

- Mantén estable el inicio de las conversaciones (system prompt, instrucciones iniciales).
- Evita reiniciar la sesión sin necesidad — mantener la conversación reduce el costo.
- DsCode gestiona el cache automáticamente; no necesitas hacer nada.

### Cuidados con el costo

- V4 Pro gasta más tokens por respuesta. Úsalo para tareas que realmente lo necesiten.
- V4 Flash es más barato y rápido. Úsalo para revisiones, refactorizaciones y tareas cotidianas.
- Monitorea tu consumo en la [plataforma DeepSeek](https://platform.deepseek.com).

### Buenas prácticas para DeepSeek

1. Usa `deepseek-v4-pro` para tareas estratégicas y `deepseek-v4-flash` para el día a día.
2. Mantén `thinkingEnabled: true` — el razonamiento mejora significativamente la calidad.
3. Si la respuesta se trunca, escribe "continúa" — la IA retoma desde donde paró.
4. Evita prompts gigantescos. Sé específico sobre qué archivos analizar.

---

## Buenas prácticas de seguridad

| Qué hacer | Por qué |
|---|---|
| **Nunca pegues claves de API en issues de GitHub** | Las issues son públicas. Las claves expuestas pueden ser usadas por otros y generar cobros. |
| **Nunca hagas commit del archivo `settings.json`** | Contiene tu clave de API. El `.gitignore` del proyecto ya lo excluye, pero verifícalo. |
| **Revisa comandos antes de permitir** | La IA puede sugerir comandos shell. Lee antes de confirmar, especialmente si involucran `rm`, `sudo` o red. |
| **Haz commit antes de pedir cambios grandes** | Si la IA hace algo incorrecto, `git reset --hard` deshace todo. Sin commit previo, esto no es posible. |
| **Lee los diffs antes de aceptar** | DsCode muestra cada cambio. Revisa — la IA puede cometer errores. |
| **No pegues datos sensibles en los prompts** | Información como contraseñas, tokens o datos de clientes pueden aparecer en logs o respuestas. |
| **Sanitiza los logs antes de pedir ayuda** | Los logs en `~/.dscode/logs/` pueden contener fragmentos de tu código. Elimina información confidencial antes de compartir. |
| **Usa una rama separada para experimentos** | Crea `git checkout -b experimento-ia` antes de pedir cambios grandes. Si algo sale mal, descarta la rama. |

---

## Buenas prácticas para ahorrar tokens/créditos

| Práctica | Explicación |
|---|---|
| **Pide análisis antes de implementación** | "Analiza este código y sugiere mejoras" gasta menos tokens que "Implementa X" sin contexto. |
| **Limita el alcance** | En lugar de "Mejora todo el proyecto", di "Mejora la función `procesar()` en `src/utils.ts`". |
| **Informa los archivos relevantes** | Di "Analiza solo los archivos en `src/api/`" — la IA lee menos archivos, gasta menos tokens. |
| **Usa Flash para tareas simples** | `deepseek-v4-flash` es mucho más barato. Úsalo para tareas rutinarias. |
| **Usa Pro con moderación** | Reserva `deepseek-v4-pro` para tareas que realmente necesiten razonamiento profundo. |
| **Mantén los prompts objetivos** | Prompts largos con información innecesaria gastan tokens de más. |
| **Reinicia la sesión con `/new` para tareas nuevas** | Sesiones muy largas acumulan contexto y cada mensaje posterior cuesta más caro. |

---

## Troubleshooting

| Problema | Causa probable | Cómo resolver |
|---|---|---|
| **`dscode: comando no encontrado`** | npm global no está en PATH | Reabre la terminal. En Windows, verifica `%APPDATA%\npm`. En Linux/macOS, verifica `~/.npm-global/bin`. |
| **`Node.js version not supported`** | Node inferior a la versión 22 | Instala o actualiza a [Node.js 22+](https://nodejs.org). |
| **`npm ci` falló** | Dependencias inconsistentes | Elimina `node_modules` y `package-lock.json`, luego ejecuta `npm install`. |
| **Error 401 (Unauthorized)** | Clave de API ausente o inválida | Verifica que `API_KEY` esté correcto en `~/.dscode/settings.json` o en la variable de entorno. |
| **Error 429 (Too Many Requests)** | Límite de solicitudes del proveedor excedido | Espera unos segundos y vuelve a intentar. Verifica tu plan en la plataforma del proveedor. |
| **Respuesta truncada** | Límite de tokens alcanzado | Aumenta `maxTokens` en `settings.json` o escribe "continúa" para retomar. |
| **Timeout / demora excesiva** | Servidor del proveedor sobrecargado o problema de red | Espera. Si persiste, cambia de modelo: usa Flash en lugar de Pro temporalmente. |
| **Error de permiso en Windows** | npm sin permiso de escritura | Ejecuta PowerShell como administrador o configura el prefijo de npm. |
| **Error de permiso en Linux/macOS (EACCES)** | npm global sin permiso | Configura el prefijo de npm a un directorio local o usa `sudo npm install -g`. |
| **`npm run build` falló** | Error de typecheck o lint | Ejecuta los comandos por separado para identificar el error: `npm run typecheck`, `npm run lint`, `npm run bundle`. |
| **No aparecen logs** | `debugLogEnabled` está `false` (predeterminado) | Activa `"debugLogEnabled": true` en `settings.json`. Los logs aparecen en `~/.dscode/logs/debug.log`. |
| **Modelo no reconocido** | Nombre del modelo incorrecto | Usa los nombres exactos: `deepseek-v4-pro`, `deepseek-v4-flash`, o un modelo compatible con OpenAI. |
| **Consumo de tokens muy alto** | Contexto largo o tareas muy amplias | Usa `/new` para reiniciar la sesión. Sé específico sobre archivos y alcance. |
| **Error en repositorios grandes** | Archivos ignorados no se están omitiendo | DsCode respeta `.gitignore`. Verifica que tu `.gitignore` sea correcto. |

---

## Cómo pedir ayuda

Si encuentras un problema, abre una [issue en GitHub](https://github.com/andrelncampos/dscode/issues).

Al reportar un problema, incluye:

- **Versión de DsCode**: `dscode --version`
- **Sistema operativo**: Windows 11, Ubuntu 24.04, macOS 15, etc.
- **Node.js**: `node --version`
- **Modelo usado**: `deepseek-v4-pro`, `deepseek-v4-flash`, etc.
- **Comando ejecutado** y el error completo
- **Logs sanitizados**, si son relevantes (elimina claves, tokens y datos privados)

⚠️ **Nunca envíes**:
- Claves de API o tokens
- Tus prompts privados o datos de proyecto confidenciales
- Archivos `.env` o `settings.json` completos
- Logs completos sin revisión (contienen fragmentos de tu código)

Para vulnerabilidades de seguridad, sigue las instrucciones en [SECURITY.md](../../SECURITY.md). **No abras issues públicas para fallos de seguridad.**

---

## Contribución

¡Las contribuciones son bienvenidas! Consulta la guía completa en [CONTRIBUTING.md](../../CONTRIBUTING.md).

Resumen rápido:

1. **Issues** son bienvenidas para bugs, features y dudas.
2. **Pull requests** pasan por CI obligatorio (typecheck + lint + format + tests + build).
3. **PRs de seguridad** o cambios en áreas sensibles pasan por revisión más rigurosa.
4. Los contribuidores declaran tener el derecho de contribuir el código enviado.

---

## Seguridad

Consulta [SECURITY.md](../../SECURITY.md) para la política completa.

- Reporta vulnerabilidades de forma privada (no abras una issue pública).
- DsCode enmascara datos sensibles en logs de depuración, pero siempre revisa antes de compartir.
- Mantén tu clave de API segura: usa variables de entorno o `settings.json` con permisos restringidos (`chmod 600`).

---

## Licencia y origen

DsCode está licenciado bajo la **Licencia MIT**.

Este proyecto deriva de [DeepCode (lessweb/deepcode-cli)](https://github.com/lessweb/deepcode-cli), originalmente licenciado bajo MIT. El aviso de copyright original se conserva en [LICENSE](../../LICENSE) y en [NOTICE](../../NOTICE).

Las dependencias de terceros mantienen sus propias licencias. Consulta [NOTICE](../../NOTICE) para la lista de dependencias y sus licencias.

---

## Canales oficiales

| Canal | Link |
|---|---|
| **GitHub** | [github.com/andrelncampos/dscode](https://github.com/andrelncampos/dscode) |
| **Releases** | [github.com/andrelncampos/dscode/releases](https://github.com/andrelncampos/dscode/releases) |
| **npm** | `npm install -g @andrelncampos/dscode` |
| **Issues** | [github.com/andrelncampos/dscode/issues](https://github.com/andrelncampos/dscode/issues) |

⚠️ Instala DsCode **solo** desde los canales oficiales mencionados. No confíes en versiones publicadas en sitios de terceros o enlaces no verificados.

---

<!-- LINK GROUP -->

[github-license-link]: https://github.com/andrelncampos/dscode/blob/main/LICENSE
[github-license-shield]: https://img.shields.io/github/license/andrelncampos/dscode?color=4d6BFE&labelColor=black&style=flat-square&cacheSeconds=1800
