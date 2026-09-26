[🇺🇸 English](README.md) | [🇯🇵 日本語](README.ja.md) | [🇨🇳 简体中文](README.zh-CN.md) | [🇰🇷 한국어](README.ko.md) | **🇪🇸 Español** | [🇩🇪 Deutsch](README.de.md) | [🇫🇷 Français](README.fr.md) | [🇵🇹 Português (BR)](README.pt-BR.md)

# Illustrator MCP Server

[![npm](https://img.shields.io/npm/v/illustrator-mcp-server.svg?style=flat-square&colorA=18181B&colorB=18181B)](https://www.npmjs.com/package/illustrator-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-18181B.svg?style=flat-square&colorA=18181B)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-18181B.svg?style=flat-square&colorA=18181B)]()
[![Illustrator](https://img.shields.io/badge/Illustrator-CC%202024%2B-18181B.svg?style=flat-square&colorA=18181B)](https://www.adobe.com/products/illustrator.html)
[![MCP](https://img.shields.io/badge/MCP-Compatible-18181B.svg?style=flat-square&colorA=18181B)](https://modelcontextprotocol.io/)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-FF5E5B?style=flat&logo=ko-fi&logoColor=white)](https://ko-fi.com/cyocun)

Un servidor [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) para leer, manipular y exportar datos de diseño de Adobe Illustrator — con 66 herramientas integradas.

Controla Illustrator directamente desde asistentes de IA como Claude — extrae información de diseño para implementación web, verifica datos listos para imprenta y exporta recursos.

Todo lo que puede hacer el MCP oficial de Illustrator de Adobe (beta) — y más. Consulta la [comparación](#-comparación-con-el-mcp-oficial-de-illustrator-de-adobe).

[![illustrator mcp server MCP server](https://glama.ai/mcp/servers/ie3jp/illustrator-mcp-server/badges/card.svg)](https://glama.ai/mcp/servers/ie3jp/illustrator-mcp-server)

> [!NOTE]
> En el directorio de extensiones y el marketplace de plugins de Claude, este proyecto aparece como **Design Bridge by IE3**. Los directorios de Anthropic no permiten nombres de marca de otras empresas en el nombre del listado, por eso el nombre es distinto: es el mismo proyecto y el paquete npm sigue siendo `illustrator-mcp-server`. Si instalaste el plugin de Claude Code con su nombre anterior (`illustrator@ie3jp-illustrator`), reinstálalo siguiendo [Claude Code](#-inicio-rápido).

---

## 🎨 Galería

Todo el material gráfico mostrado a continuación fue creado íntegramente por Claude mediante conversación en lenguaje natural — sin ninguna operación manual en Illustrator.

<table>
<tr>
<td align="center"><img src="docs/images/example-event-poster.png" width="300" alt="Póster de evento — SYNC TOKYO 2026" /><br><b>Póster de Evento</b></td>
<td align="center"><img src="docs/images/example-logo-concepts.png" width="300" alt="Conceptos de logotipo — Slow Drip Coffee Co." /><br><b>Conceptos de Logotipo</b></td>
</tr>
<tr>
<td align="center"><img src="docs/images/example-business-card.png" width="300" alt="Tarjeta de presentación — KUMO Studio" /><br><b>Tarjeta de Presentación</b></td>
<td align="center"><img src="docs/images/example-twilight-geometry.png" width="300" alt="Twilight Geometry — paisaje geométrico abstracto" /><br><b>Twilight Geometry</b></td>
</tr>
</table>

> Consulta los [desgloses detallados](#ejemplo-patrón-de-prueba-smpte) más abajo para ver prompts, uso de herramientas y estructura de mesas de trabajo.

---

> [!TIP]
> Desarrollar y mantener esta herramienta requiere tiempo y recursos.
> Si te resulta útil en tu flujo de trabajo, tu apoyo significa mucho — [☕ ¡invítame un café!](https://ko-fi.com/cyocun)

---

## 🚀 Inicio Rápido

### 🛠️ Claude Code

Requiere [Node.js 20+](https://nodejs.org/).

```bash
claude mcp add illustrator-mcp -- npx illustrator-mcp-server
```

O instálalo como plugin, que incluye el servidor MCP y una skill de preflight para preimpresión (también funciona en Claude Cowork):

```
/plugin install ie3-design-bridge --marketplace ie3jp/illustrator-mcp-server
```

En Claude Code anterior a v2.1.275, añade primero el marketplace:

```
/plugin marketplace add ie3jp/illustrator-mcp-server
/plugin install ie3-design-bridge@ie3
```

Si ya añadiste el servidor con `claude mcp add`, quítalo primero (`claude mcp remove illustrator-mcp`) para que no se ejecute dos veces.

### 🖥️ Claude Desktop

1. Descarga **`illustrator-mcp-server.mcpb`** desde [GitHub Releases](https://github.com/ie3jp/illustrator-mcp-server/releases/latest)
2. Abre Claude Desktop → **Ajustes** → **Extensions**
3. Arrastra y suelta el archivo `.mcpb` dentro del panel de Extensions
4. Haz clic en el botón **Install**

<details>
<summary><strong>Alternativa: configuración manual (siempre actualizado vía npx)</strong></summary>

> [!NOTE]
> La extensión `.mcpb` no se actualiza automáticamente. Para actualizar, descarga la nueva versión y reinstala. Si prefieres actualizaciones automáticas, usa el método npx que se describe a continuación.

Requiere [Node.js 20+](https://nodejs.org/). Abre el archivo de configuración y añade los ajustes de conexión.

#### 1. Abrir el archivo de configuración

Desde la barra de menú de Claude Desktop:

**Claude** → **Settings...** → **Developer** (en la barra lateral izquierda) → Haz clic en el botón **Edit Config**

#### 2. Añadir los ajustes

```json
{
  "mcpServers": {
    "illustrator": {
      "command": "npx",
      "args": ["illustrator-mcp-server"]
    }
  }
}
```

> [!NOTE]
> Si instalaste Node.js con un gestor de versiones (nvm, mise, fnm, etc.), es posible que Claude Desktop no encuentre `npx`. En ese caso, usa la ruta completa:
> ```json
> "command": "/full/path/to/npx"
> ```
> Ejecuta `which npx` en tu terminal para localizar la ruta.

#### 3. Guardar y reiniciar

1. Guarda el archivo y cierra el editor de texto
2. **Cierra por completo** Claude Desktop (⌘Q / Ctrl+Q) y vuelve a abrirlo

</details>

> [!CAUTION]
> La IA puede equivocarse. No dependas en exceso del resultado — **siempre haz que una persona revise los datos de entrega finales**. El usuario es responsable de los resultados.

> [!NOTE]
> **macOS:** En la primera ejecución, concede acceso de automatización en Ajustes del Sistema > Privacidad y Seguridad > Automatización.

> [!NOTE]
> La mayoría de las herramientas de modificación traen Illustrator al primer plano durante su ejecución. Las herramientas de lectura y `export` se ejecutan sin cambiar de aplicación; `export_pdf` solo lo trae al frente cuando dibuja marcas de corte japonesas.

> [!NOTE]
> **Tus archivos están protegidos por defecto.** `close_document` no descarta cambios sin guardar a menos que lo indiques explícitamente (`save: false`), y `export`, `export_pdf`, `save_document` (guardar como) y `extract_design_tokens` no reemplazan un archivo existente salvo que se indique `overwrite: true`. Si es lo que quieres, basta con pedirle a Claude que "cierre sin guardar" o que "sobrescriba el archivo".

### Múltiples Versiones de Illustrator

Si tienes varias versiones de Illustrator instaladas, puedes indicarle a Claude cuál utilizar durante la conversación. Basta con decir algo como "Usa Illustrator 2024" y la herramienta `set_illustrator_version` apuntará a esa versión.


**Versiones compatibles:** Illustrator 2024 (v28) y posteriores están verificadas. Se espera que Illustrator 2020–2023 (v24–v27) funcionen —todas las API de ExtendScript que usa este servidor existen desde la v24—, pero **no están verificadas**, por lo que las herramientas devuelven una advertencia al ejecutarse en ellas. Las versiones anteriores a 2020 (v24) no son compatibles. Si algo falla en una versión no verificada, [abre un issue](https://github.com/ie3jp/illustrator-mcp-server/issues).
> [!NOTE]
> Si Illustrator ya está en ejecución, el servidor se conecta a la instancia activa sin importar la configuración de versión. La versión solo se usa para iniciar la versión correcta cuando Illustrator aún no está abierto.

### Variables de Entorno

| Variable | Valor predeterminado | Descripción |
|---|---|---|
| `ILLUSTRATOR_MCP_TIMEOUT_NORMAL` | `30000` | Tiempo de espera en milisegundos para las herramientas normales |
| `ILLUSTRATOR_MCP_TIMEOUT_HEAVY` | `60000` | Tiempo de espera en milisegundos para las herramientas pesadas (colocar o importar archivos, exportación, preflight, guías de estilo y muestras de color, variaciones de tamaño) |

Auméntalos cuando una sola llamada necesite más tiempo que el predeterminado: por ejemplo, al importar un SVG grande con `import_svg_as_editable` (más de 100 objetos) o al ejecutar `get_document_structure` / `export_pdf` en un documento grande.

Los valores deben ser enteros positivos en milisegundos. Cualquier otro valor (`0`, un número negativo, una cadena no numérica o un valor superior a 2147483647) vuelve al predeterminado. Se leen una sola vez al iniciar el servidor.

```json
{
  "mcpServers": {
    "illustrator": {
      "command": "npx",
      "args": ["illustrator-mcp-server"],
      "env": {
        "ILLUSTRATOR_MCP_TIMEOUT_NORMAL": "60000",
        "ILLUSTRATOR_MCP_TIMEOUT_HEAVY": "180000"
      }
    }
  }
}
```

---

## 🎬 Qué Puedes Hacer

```
Tú:    Muéstrame toda la información de texto en este documento
Claude:  → list_text_frames → get_text_frame_detail
         Hay 12 cuadros de texto en el documento.
         El título "My Design" usa Noto Sans JP Bold 48px, color #333333 ...
```

```
Tú:    Ejecuta una verificación preflight para imprenta
Claude:  → preflight_check
         ⚠ 2 advertencias:
         - Imagen de baja resolución: image_01.jpg (150dpi) — se recomienda 300dpi o superior
         - Fuentes sin trazar: 3 cuadros de texto
```

```
Tú:    Revisa el texto en busca de inconsistencias
Claude:  → check_text_consistency
         📝 Informe de Consistencia:
         ⚠ "Contact Us" vs "Contact us" — discrepancia de mayúsculas
         ❌ "Lorem ipsum" (2 lugares) — queda texto de relleno
```

```
Tú:    Crea variaciones de tamaño de banner a partir de este flyer A4
Claude:  → get_document_info → resize_for_variation
         Se crearon 3 variaciones de tamaño:
         - 728×90 / 300×250 / 160×600
```

---

## 🆚 Comparación con el MCP Oficial de Illustrator de Adobe

**En resumen: todo lo que hace el MCP oficial, este proyecto también lo hace — y mucho más.** Adobe incluye un servidor MCP integrado en **Illustrator Beta** (30.4+, todavía exclusivo de la Beta a agosto de 2026), centrado en analizar y procesar por lotes documentos existentes. Este proyecto cubre esos mismos flujos de trabajo — análisis, recoloreado masivo, variaciones, exportación por lotes de mesas de trabajo, comprobación de fuentes / enlaces rotos — y añade lo que el servidor oficial no tiene: **crear obras desde cero, guardar documentos, comprobaciones de impresión y preimpresión, y herramientas de sistemas de diseño**. Y además funciona en la versión estable de Illustrator, sin necesidad de la Beta.

| | Este proyecto | MCP oficial de Adobe (beta) |
|---|---|---|
| Instalación | npm (`npx illustrator-mcp-server`) o instalación en un clic con `.mcpb` | Integrado en Illustrator Beta — obtén una clave de autenticación + URL en los ajustes de la app y conéctate vía `mcp-remote` |
| Versiones compatibles | Illustrator 2024+ verificado / 2020+ sin verificar (macOS / Windows) | Solo Illustrator Beta 30.4+ |
| Número de herramientas | 66 | ~40 |
| Análisis y procesamiento por lotes de documentos existentes | ✅ Análisis de estructura / color / fuentes, recoloreado masivo, variaciones y conjuntos de datos, exportación por lotes de mesas de trabajo (`artboard:all`), preflight de fuentes y enlaces rotos | ✅ Su enfoque principal |
| Creación de objetos desde cero | ✅ Conjunto completo — documentos, formas, trazados, marcos de texto, texto en trazado, degradados | ❌ Sin nuevos objetos, marcos de texto ni documentos \* |
| Guardar documentos | ✅ `save_document` (guardar / guardar como) | ❌ Solo exportación \* |
| Impresión y preimpresión | ✅ Marcas de corte, preflight, sobreimpresión / separaciones, contornos, perfiles de color | — |
| Sistema de diseño | ✅ Tokens de diseño, comprobación de contraste WCAG, guías de estilo, consistencia de texto | — |

\* Basado en informes de usuarios a abril de 2026 (beta). El servidor oficial está en desarrollo activo — consulta la [documentación de Adobe](https://helpx.adobe.com/illustrator/desktop/connect-with-other-apps-and-tools/about-using-ai-tools-with-illustrator.html) para el estado más reciente.

---

## 📖 Recetas

<details>
<summary><b>Extraer colores y fuentes para CSS</b></summary>

```
Tú:    Resume los colores y la tipografía de este diseño

Claude:  → get_colors → list_text_frames → get_text_frame_detail

         ■ Paleta de Colores
         - Primario: #1A73E8 (CMYK: 85,50,0,0)
         - Secundario: #34A853
         - Texto: #202124
         - Fondo: #FFFFFF

         ■ Tipografía
         - Títulos: Noto Sans JP Bold / 32px
         - Cuerpo: Noto Sans JP Regular / 16px / line-height: 1.75
         - Pies de foto: Noto Sans JP Medium / 12px
```

</details>

<details>
<summary><b>Exportar mesas de trabajo como SVG / PNG</b></summary>

```
Tú:    Exporta todas las mesas de trabajo como SVG con el texto trazado

Claude:  → get_artboards → convert_to_outlines → export (repetido)

         Se exportaron 4 mesas de trabajo:
         - /output/header.svg
         - /output/hero.svg
         - /output/feature.svg
         - /output/footer.svg
```

</details>

<details>
<summary><b>Verificar el cumplimiento PDF/X-1a antes de la entrega</b></summary>

```
Tú:    Comprueba si este documento cumple con PDF/X-1a

Claude:  → preflight_check (target_pdf_profile: "x1a")

         ❌ Errores de cumplimiento PDF/X-1a:
         - Transparencia en 3 objetos (X-1a prohíbe la transparencia)
         - Colores RGB encontrados en 2 lugares (X-1a requiere CMYK/spot solamente)

         ⚠ Advertencias:
         - 5 fuentes sin trazar (se recomienda incrustarlas)
         - Imagen "photo_02.jpg" a 150dpi (se recomienda 300dpi)
```

</details>

<details>
<summary><b>Revisar la calidad de imagen para impresión</b></summary>

```
Tú:    Revisa la calidad de las imágenes colocadas para impresión

Claude:  → get_images (include_print_info: true)

         ■ Informe de Calidad de Imágenes:
         ✅ hero.psd — CMYK, 350ppi efectivos
         ⚠ icon_set.png — RGB (no coincide con documento CMYK), 300ppi efectivos
         ❌ photo_bg.jpg — CMYK, 72ppi efectivos (sobreampliada)
           → Sustituir por una imagen de 300dpi+ al tamaño real
```

</details>

<details>
<summary><b>Verificar ratios de contraste de color WCAG</b></summary>

```
Tú:    Revisa los ratios de contraste del texto

Claude:  → check_contrast (auto_detect: true)

         ■ Informe de Contraste WCAG:
         ❌ "Caption" sobre "gris claro" — 2.8:1 (falla AA)
         ⚠ "Subheading" sobre "blanco" — 4.2:1 (AA Large OK, AA Normal falla)
         ✅ "Body text" sobre "blanco" — 12.1:1 (pasa AAA)
```

</details>

---

## Plantillas de Flujo de Trabajo

Plantillas de flujo de trabajo preconstruidas disponibles en el selector de prompts de Claude Desktop.

| Plantilla | Descripción |
|----------|-------------|
| `quick-layout` | Pega contenido de texto y Claude lo organiza en la mesa de trabajo como títulos, cuerpo y pies de foto |
| `print-preflight-workflow` | Verificación preflight para imprenta completa en 7 pasos (documento → preflight → sobreimpresión → separaciones → imágenes → colores → texto) |

---

## Referencia de Herramientas

### Herramientas de Lectura (21)

<details>
<summary>Haz clic para expandir</summary>

| Herramienta | Descripción |
|---|---|
| `get_document_info` | Metadatos del documento (dimensiones, modo de color, perfil, etc.) |
| `get_artboards` | Información de las mesas de trabajo (posición, tamaño, orientación) |
| `get_layers` | Estructura de capas en forma de árbol |
| `get_document_structure` | Árbol completo: capas → grupos → objetos en una sola llamada |
| `list_text_frames` | Lista de cuadros de texto (fuente, tamaño, nombre de estilo) |
| `get_text_frame_detail` | Todos los atributos de un cuadro de texto específico (kerning, ajustes de párrafo, etc.) |
| `get_colors` | Información de color en uso (muestras, degradados, colores directos; cada color usado aparece una vez con su número de usos). `include_diagnostics` para análisis de impresión |
| `get_path_items` | Datos de trazos/formas (relleno, contorno, puntos de ancla) |
| `get_groups` | Grupos, máscaras de recorte y estructura de trazados compuestos |
| `get_effects` | Información de efectos y apariencia (opacidad, modo de fusión) |
| `get_images` | Información de imágenes incrustadas/enlazadas (resolución, detección de enlaces rotos). `include_print_info` para resolución efectiva por eje y discrepancia de espacio de color |
| `get_symbols` | Definiciones e instancias de símbolos |
| `get_guidelines` | Información de guías |
| `get_overprint_info` | Ajustes de sobreimpresión en trazados, texto e imágenes rasterizadas + detección de K100/negro enriquecido, con una etiqueta heurística inferida solo de los colores (no puede conocer la intención) |
| `get_separation_info` | Información de separación de colores (planchas de proceso y de tintas directas realmente usadas, con conteo de uso; las tintas sin uso detectado se listan aparte) |
| `get_selection` | Detalles de los objetos actualmente seleccionados |
| `find_objects` | Búsqueda por criterios (nombre, tipo, color, fuente, etc.) |
| `check_contrast` | Verificación de ratio de contraste de color WCAG (manual o detección automática de pares superpuestos) |
| `extract_design_tokens` | Extrae tokens de diseño como propiedades personalizadas CSS, JSON o configuración de Tailwind (al guardar en un archivo, nunca reemplaza uno existente sin `overwrite: true`) |
| `list_fonts` | Lista las fuentes disponibles en Illustrator (no requiere documento) |
| `convert_coordinate` | Convierte puntos entre los sistemas de coordenadas de la mesa de trabajo y del documento |

</details>

### Herramientas de Modificación (39)

<details>
<summary>Haz clic para expandir</summary>

| Herramienta | Descripción |
|---|---|
| `create_rectangle` | Crea un rectángulo (admite esquinas redondeadas) |
| `create_ellipse` | Crea una elipse |
| `create_line` | Crea una línea |
| `create_text_frame` | Crea un cuadro de texto (texto de punto o de área) con tracking, interlineado y alineación de párrafo opcionales. `font_name` debe ser el nombre exacto de `list_fonts`: una fuente desconocida da error en lugar de sustituirse en silencio |
| `create_path` | Crea un trazado personalizado (con manejadores Bézier) |
| `place_image` | Coloca un archivo de imagen raster/PDF como enlazado o incrustado (SVG se rechaza: usa `import_svg_as_editable`) |
| `import_svg_as_editable` | Importa un archivo SVG como trazados/textos/grupos editables de Illustrator (no como imagen enlazada) |
| `modify_object` | Modifica propiedades de un objeto existente (incluidos tracking, interlineado y alineación del texto). El relleno/trazo en un grupo o trazado compuesto se aplica a todos los trazados y textos que contiene |
| `convert_to_outlines` | Convierte texto a contornos (trazar texto) |
| `create_document` | Crea un documento nuevo (tamaño, modo de color) |
| `close_document` | Cierra el documento activo (si hay cambios sin guardar, no lo cierra a menos que se indique `save`) |
| `resize_for_variation` | Crea variaciones de tamaño a partir de una mesa de trabajo origen (escalado proporcional) |
| `align_objects` | Alinea y distribuye múltiples objetos |
| `replace_color` | Busca y reemplaza colores en todo el documento (con tolerancia) |
| `manage_layers` | Añade, renombra, muestra/oculta, bloquea/desbloquea, reordena o elimina capas |
| `place_color_chips` | Extrae los colores únicos y coloca muestras de color fuera de la mesa de trabajo |
| `save_document` | Guarda o guarda como el documento activo (guardar como no reemplaza un archivo existente sin `overwrite: true`) |
| `open_document` | Abre un documento desde una ruta de archivo |
| `group_objects` | Agrupa objetos (admite máscaras de recorte) |
| `ungroup_objects` | Desagrupa un grupo, liberando los hijos |
| `duplicate_objects` | Duplica objetos con desplazamiento opcional |
| `set_z_order` | Cambia el orden de apilamiento (traer al frente/enviar atrás) |
| `move_to_layer` | Mueve objetos a una capa diferente |
| `delete_objects` | Elimina objetos por UUID (los bloqueados requieren `force_unlock`; `undo` puede revertirlo, pero sus pasos siguen el historial de Illustrator, no las llamadas MCP) |
| `manage_artboards` | Añade, elimina, redimensiona, renombra y reorganiza mesas de trabajo |
| `manage_swatches` | Añade, actualiza o elimina muestras |
| `manage_linked_images` | Revincula o incrusta imágenes colocadas |
| `manage_datasets` | Lista/aplica/crea conjuntos de datos, importa/exporta variables |
| `apply_graphic_style` | Aplica un estilo gráfico a los objetos |
| `list_graphic_styles` | Lista todos los estilos gráficos del documento |
| `apply_text_style` | Aplica estilo de carácter o de párrafo al texto |
| `list_text_styles` | Lista todos los estilos de carácter y de párrafo |
| `create_gradient` | Crea degradados y los aplica a objetos |
| `create_path_text` | Crea texto en trazado (tracking y alineación opcionales; `font_name` sigue la misma regla de nombre exacto que `create_text_frame`) |
| `place_symbol` | Coloca o sustituye instancias de símbolo |
| `select_objects` | Selecciona objetos por UUID (admite selección múltiple) |
| `create_crop_marks` | Crea marcas de corte con detección automática de estilo por locale (doble línea japonesa / línea simple occidental) |
| `place_style_guide` | Coloca una guía de estilo visual fuera de la mesa de trabajo en una capa no imprimible (colores, fuentes, espaciado, márgenes, separación de guías). Las marcas de medida sobre la propia mesa de trabajo son opcionales (`annotate_artboard`) |
| `undo` | Operaciones de deshacer/rehacer (multinivel) |

</details>

### Herramientas de Exportación (2)

<details>
<summary>Haz clic para expandir</summary>

| Herramienta | Descripción |
|---|---|
| `export` | Exportación SVG / PNG / JPG (por mesa de trabajo, selección o UUID; con selección/UUID solo se exporta ese objeto; no reemplaza un archivo existente sin `overwrite: true`) |
| `export_pdf` | Exportación a PDF listo para imprenta (marcas de corte, sangrado, reducción de muestreo selectiva, output intent) |

</details>

### Utilidades (4)

<details>
<summary>Haz clic para expandir</summary>

| Herramienta | Descripción |
|---|---|
| `preflight_check` | Verificación preflight para imprenta (mezcla RGB, enlaces rotos, baja resolución, sobreimpresión de blanco, interacción transparencia+sobreimpresión, cumplimiento PDF/X, etc.). Indica qué comprobaciones fueron completas o solo parciales (`coverage`) |
| `check_text_consistency` | Verificación de consistencia de texto (detección de texto de relleno, patrones de variación de notación, listado completo de texto para análisis por LLM) |
| `set_workflow` | Establece el modo de flujo de trabajo (web/print) para sobrescribir el sistema de coordenadas autodetectado |
| `set_illustrator_version` | Elige qué versión de Illustrator usar cuando hay varias instaladas |

</details>

---

## Sistema de Coordenadas

El servidor detecta automáticamente el sistema de coordenadas a partir del documento:

| Tipo de documento | Sistema de coordenadas | Origen | Eje Y |
|---|---|---|---|
| CMYK / Imprenta | `document` | Inferior izquierdo | Hacia arriba |
| RGB / Web | `artboard-web` | Superior izquierdo de la mesa de trabajo | Hacia abajo |

- Los **documentos CMYK** utilizan el sistema de coordenadas nativo de Illustrator, acorde con lo que esperan los diseñadores de imprenta
- Los **documentos RGB** utilizan un sistema de coordenadas estilo web, más fácil de manejar por la IA
- Usa `set_workflow` para sobrescribir el sistema de coordenadas autodetectado si lo necesitas
- Todas las respuestas de las herramientas incluyen un campo `coordinateSystem` que indica qué sistema está activo
- Si la detección automática falla, las herramientas devuelven un error en lugar de suponer: indica `coordinate_system` explícitamente o usa `set_workflow`

---

## Ejemplo: Patrón de Prueba SMPTE

Un patrón de prueba de barras de color SMPTE de 1920×1080, creado íntegramente mediante instrucciones en lenguaje natural a Claude.

**Prompt:**

> Make a 1920x1080 video test pattern

**Resultado:**

<img src="docs/images/example-smpte-test-pattern.png" width="720" alt="Patrón de prueba de barras de color SMPTE generado por Claude vía illustrator-mcp-server" />

**Estructura de la mesa de trabajo** (vía `get_document_structure`):

<details>
<summary>Haz clic para expandir</summary>

```
Labels
├── title-safe-label        (text)    — "TITLE SAFE (10%)"
├── action-safe-label       (text)    — "ACTION SAFE (5%)"
├── credit-label            (text)    — "Generated by illustrator-mcp-server"
├── test-label              (text)    — "SMPTE COLOR BARS — TEST PATTERN"
├── format-label            (text)    — "Full HD — 16:9"
└── resolution-label        (text)    — "1920 x 1080"

Center Cross
├── title-safe              (path)    — 1536×864 stroke rectangle
├── action-safe             (path)    — 1728×972 stroke rectangle
├── cross-circle            (path)    — 150×150 center circle
├── cross-v                 (path)    — vertical crosshair
└── cross-h                 (path)    — horizontal crosshair

Color Bars
├── pluge-black … pluge-navy   (path ×9)  — PLUGE / grayscale bottom strip
├── rev-white … rev-blue       (path ×7)  — reverse color middle strip
└── bar-white … bar-blue       (path ×7)  — 75% SMPTE color bars
```

</details>

> Herramientas utilizadas: `create_document`, `manage_layers`, `create_rectangle` ×23, `create_line` ×2, `create_ellipse`, `create_text_frame` ×6, `modify_object` ×4, `save_document`, `export`

---

## Ejemplo: Twilight Geometry

Una obra de paisaje geométrico abstracto — creada íntegramente por Claude, sin más dirección humana de diseño que "haz el arte que quieras".

**Prompt:**

> Make an art piece of your own imagination in Illustrator. Take your time. Create whatever you like.

**Proceso de Claude:**

> Voy a crear "Twilight Geometry" — un paisaje abstracto con elementos celestes geométricos. Un cielo crepuscular con un degradado profundo, siluetas de montañas superpuestas, una luna creciente con anillos decorativos y estrellas esparcidas por todo el lienzo.

> Estrellas en forma de diamante en distintos colores — blancos cálidos, azules fríos, morados lavanda — cada una sutilmente distinta para sugerir diferentes tipos de estrellas. Líneas de constelación conectándolas. Triángulos alámbricos y un hexágono flotando en el cielo para una atmósfera mística.

> Una superficie de agua en la parte inferior con la luz de la luna reflejada como líneas onduladas brillantes, desvaneciéndose a medida que descienden.

**Reflexión de Claude:**

> Salió mejor de lo que esperaba. Creo que el mundo híbrido entre geometría y naturaleza quedó bien logrado.

**Resultado:**

<img src="docs/images/example-twilight-geometry.png" width="720" alt="Twilight Geometry — arte de paisaje geométrico abstracto generado por Claude vía illustrator-mcp-server" />

> Herramientas utilizadas: `create_document`, `manage_layers` ×4, `create_rectangle` ×2, `create_gradient` ×2, `create_path` ×11, `create_ellipse` ×14, `create_line` ×4, `create_text_frame` ×2, `modify_object`, `set_z_order`, `export`

---

## Limitaciones Conocidas

| Limitación | Detalles |
|---|---|
| Soporte para Windows | Windows utiliza automatización COM vía PowerShell (aún no probado en hardware real) |
| Efectos en vivo | Los parámetros de sombra paralela y otros efectos pueden detectarse pero no leerse |
| Perfiles de color | Solo asignación de perfil de color — la conversión completa no está disponible |
| Ajustes de sangrado | No se pueden leer los ajustes de sangrado (limitación de la API de Illustrator) |
| Exportación WebP | No compatible — usa PNG o SVG en su lugar |
| Marcas de corte japonesas | La exportación a PDF genera temporalmente las marcas en el documento con el comando TrimMark, exporta y luego las elimina. Solo para documentos con una mesa de trabajo: con varias mesas de trabajo se devuelve un error |
| Incrustación de fuentes | El modo de incrustación (full/subset) no se puede controlar directamente — usa presets de PDF |
| Variaciones de tamaño | Solo escalado proporcional — es posible que el texto requiera ajuste manual después |
| Sustitución de glifos en texto SVG | Illustrator no recurre glifo a glifo a la siguiente fuente de una lista `font-family`. Si la primera familia está instalada pero no contiene un glifo, `import_svg_as_editable` descarta ese carácter sin avisar y aun así informa éxito. Usa una sola `font-family` por elemento de texto y elige una que contenga los glifos que necesitas. Una familia *no instalada* se sustituye y no se ve afectada; `preflight_check` cubre ese otro caso |
| Notas de objetos | Las herramientas identifican los objetos mediante un UUID guardado en la nota de cada objeto (panel Atributos). Si escribiste una nota, se conserva: el UUID se añade delante |

---

<br>

# Para Desarrolladores

## Arquitectura

```mermaid
flowchart LR
    Claude <-->|MCP Protocol| Server["MCP Server\n(TypeScript/Node.js)"]

    Server -.->|generate| Runner["run-{uuid}.scpt / .ps1"]
    Server -.->|generate| JSX["script-{uuid}.jsx\n(BOM UTF-8)"]
    Server -.->|write| PF["params-{uuid}.json"]

    Runner -->|execFile| osascript
    Runner -->|execFile| PS["powershell.exe"]

    osascript -->|do javascript| AI["Adobe Illustrator\n(ExtendScript/JSX)"]
    PS -->|DoJavaScript| AI

    JSX -.->|execute| AI
    PF -.->|read| AI
    AI -.->|write| RF["result-{uuid}.json"]
    RF -.->|read| Server
```

---

## Compilar desde el Código Fuente

```bash
git clone https://github.com/ie3jp/illustrator-mcp-server.git
cd illustrator-mcp-server
npm install
npm run build
claude mcp add illustrator-mcp -- node /path/to/illustrator-mcp-server/dist/index.js
```

### Verificar

```bash
npx @modelcontextprotocol/inspector npx illustrator-mcp-server
```

### Pruebas

```bash
# Pruebas unitarias
npm test

# Prueba de humo E2E (requiere Illustrator en ejecución)
npm run build   # E2E runs dist/index.js
npx tsx test/e2e/e2e-test.ts        # every tool (192 cases)
npx tsx test/e2e/e2e-behaviors.ts   # behavior & regression checks (91 cases)
npx tsx test/e2e/e2e-cmyk-only.ts
npx tsx test/e2e/svg-import-test.ts
```

Las suites E2E crean sus propios documentos, no tocan otros documentos abiertos y los cierran sin guardar. `e2e-test.ts` ejecuta todas las herramientas registradas (RGB + CMYK, detección automática del sistema de coordenadas); `e2e-behaviors.ts` comprueba comportamientos que deben cumplirse en la aplicación real: las notas se conservan, los fallos parciales se informan, los archivos no se sobrescriben y las marcas de corte y la exportación a PDF no alteran tu ilustración.

---

## Política de privacidad (Privacy Policy)

illustrator-mcp-server se ejecuta por completo en tu ordenador. No recopila datos personales, no incluye telemetría y no realiza conexiones de red propias. Los parámetros de las herramientas y los datos del documento solo van a tu Illustrator local y vuelven al cliente MCP que llamó a la herramienta; los archivos temporales se eliminan tras cada llamada. Consulta la [política de privacidad completa](https://github.com/ie3jp/illustrator-mcp-server/blob/main/PRIVACY.md).

---

## Aviso Legal

Esta herramienta automatiza muchas operaciones de Illustrator, pero la IA puede cometer errores. Los datos extraídos, los resultados del preflight y las modificaciones al documento deben ser revisados siempre por una persona. **No dependas de esta herramienta como tu único control de calidad.** Úsala como asistente junto con tu propia verificación manual, especialmente para entregas de imprenta y materiales para clientes. Los autores no se hacen responsables de daños o pérdidas derivados del uso de este software o de sus resultados.

---

## Licencia

[MIT](LICENSE)
