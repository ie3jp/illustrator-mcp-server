[🇺🇸 English](README.md) | [🇯🇵 日本語](README.ja.md) | [🇨🇳 简体中文](README.zh-CN.md) | [🇰🇷 한국어](README.ko.md) | [🇪🇸 Español](README.es.md) | [🇩🇪 Deutsch](README.de.md) | [🇫🇷 Français](README.fr.md) | **🇵🇹 Português (BR)**

# Illustrator MCP Server

[![npm](https://img.shields.io/npm/v/illustrator-mcp-server.svg?style=flat-square&colorA=18181B&colorB=18181B)](https://www.npmjs.com/package/illustrator-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-18181B.svg?style=flat-square&colorA=18181B)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-18181B.svg?style=flat-square&colorA=18181B)]()
[![Illustrator](https://img.shields.io/badge/Illustrator-CC%202024%2B-18181B.svg?style=flat-square&colorA=18181B)](https://www.adobe.com/products/illustrator.html)
[![MCP](https://img.shields.io/badge/MCP-Compatible-18181B.svg?style=flat-square&colorA=18181B)](https://modelcontextprotocol.io/)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-FF5E5B?style=flat&logo=ko-fi&logoColor=white)](https://ko-fi.com/cyocun)

Um servidor [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) para ler, manipular e exportar dados de design do Adobe Illustrator — com 67 ferramentas integradas.

Controle o Illustrator diretamente a partir de assistentes de IA como o Claude — extraia informações de design para implementação web, verifique dados prontos para impressão e exporte assets.

Tudo o que o MCP oficial do Illustrator da Adobe (beta) faz — e muito mais. Veja a [comparação](#-comparação-com-o-mcp-oficial-do-illustrator-da-adobe).

[![illustrator mcp server MCP server](https://glama.ai/mcp/servers/ie3jp/illustrator-mcp-server/badges/card.svg)](https://glama.ai/mcp/servers/ie3jp/illustrator-mcp-server)

---

## 🎨 Galeria

Todas as artes abaixo foram criadas inteiramente pelo Claude por meio de conversa em linguagem natural — sem qualquer operação manual no Illustrator.

<table>
<tr>
<td align="center"><img src="docs/images/example-event-poster.png" width="300" alt="Pôster de evento — SYNC TOKYO 2026" /><br><b>Pôster de Evento</b></td>
<td align="center"><img src="docs/images/example-logo-concepts.png" width="300" alt="Conceitos de logo — Slow Drip Coffee Co." /><br><b>Conceitos de Logo</b></td>
</tr>
<tr>
<td align="center"><img src="docs/images/example-business-card.png" width="300" alt="Cartão de visita — KUMO Studio" /><br><b>Cartão de Visita</b></td>
<td align="center"><img src="docs/images/example-twilight-geometry.png" width="300" alt="Twilight Geometry — paisagem geométrica abstrata" /><br><b>Twilight Geometry</b></td>
</tr>
</table>

> Veja os [detalhamentos completos](#exemplo-padrão-de-teste-smpte) abaixo para prompts, uso de ferramentas e estrutura de pranchetas.

---

> [!TIP]
> Desenvolver e manter esta ferramenta consome tempo e recursos.
> Se ela ajuda no seu fluxo de trabalho, seu apoio significa muito — [☕ me pague um café!](https://ko-fi.com/cyocun)

---

## 🚀 Início Rápido

### 🛠️ Claude Code

Requer [Node.js 20+](https://nodejs.org/).

```bash
claude mcp add illustrator-mcp -- npx illustrator-mcp-server
```

### 🖥️ Claude Desktop

1. Baixe o **`illustrator-mcp-server.mcpb`** em [GitHub Releases](https://github.com/ie3jp/illustrator-mcp-server/releases/latest)
2. Abra o Claude Desktop → **Settings** → **Extensions**
3. Arraste e solte o arquivo `.mcpb` no painel de Extensions
4. Clique no botão **Install**

<details>
<summary><strong>Alternativa: configuração manual (sempre atualizada via npx)</strong></summary>

> [!NOTE]
> A extensão `.mcpb` não se atualiza automaticamente. Para atualizar, baixe a nova versão e reinstale. Se preferir atualizações automáticas, use o método npx abaixo.

Requer [Node.js 20+](https://nodejs.org/). Abra o arquivo de configuração e adicione as definições de conexão.

#### 1. Abra o arquivo de configuração

Na barra de menu do Claude Desktop:

**Claude** → **Settings...** → **Developer** (na barra lateral esquerda) → clique no botão **Edit Config**

#### 2. Adicione as configurações

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
> Se você instalou o Node.js por meio de um gerenciador de versões (nvm, mise, fnm, etc.), o Claude Desktop pode não encontrar o `npx`. Nesse caso, use o caminho completo:
> ```json
> "command": "/caminho/completo/ate/npx"
> ```
> Execute `which npx` no terminal para encontrar o caminho.

#### 3. Salve e reinicie

1. Salve o arquivo e feche o editor de texto
2. **Saia completamente** do Claude Desktop (⌘Q / Ctrl+Q) e reabra

</details>

> [!CAUTION]
> A IA pode cometer erros. Não dependa excessivamente do resultado — **sempre tenha uma pessoa fazendo a verificação final dos dados de envio**. O usuário é responsável pelos resultados.

> [!NOTE]
> **macOS:** Na primeira execução, permita o acesso de automação em Ajustes do Sistema > Privacidade e Segurança > Automação.

> [!NOTE]
> A maioria das ferramentas de modificação traz o Illustrator para o primeiro plano durante a execução. As ferramentas de leitura e o `export` rodam sem trocar de aplicativo; o `export_pdf` só traz o Illustrator para a frente ao desenhar marcas de corte japonesas.

> [!NOTE]
> **Seus arquivos são protegidos por padrão.** O `close_document` não descarta alterações não salvas a menos que você peça explicitamente (`save: false`), e `export`, `export_pdf`, `save_document` (salvar como) e `extract_design_tokens` não substituem um arquivo existente sem `overwrite: true`. Se for isso que você quer, basta pedir ao Claude para "fechar sem salvar" ou "sobrescrever o arquivo".

### Múltiplas versões do Illustrator

Se você tem várias versões do Illustrator instaladas, pode dizer ao Claude qual versão usar durante a conversa. Basta dizer algo como "Use o Illustrator 2024" e a ferramenta `set_illustrator_version` direcionará para essa versão.


**Versões suportadas:** Illustrator 2024 (v28) e posteriores são verificadas. Espera-se que o Illustrator 2020–2023 (v24–v27) funcione — todas as APIs do ExtendScript que este servidor usa existem desde a v24 —, mas elas **não são verificadas**, então as ferramentas retornam um aviso ao rodar nelas. Versões anteriores a 2020 (v24) não são suportadas. Se algo quebrar em uma versão não verificada, [abra uma issue](https://github.com/ie3jp/illustrator-mcp-server/issues).
> [!NOTE]
> Se o Illustrator já estiver em execução, o servidor se conecta à instância em execução independentemente da configuração de versão. A versão só é usada para iniciar a versão correta quando o Illustrator ainda não está em execução.

### Variáveis de Ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `ILLUSTRATOR_MCP_TIMEOUT_NORMAL` | `30000` | Tempo limite em milissegundos para ferramentas normais |
| `ILLUSTRATOR_MCP_TIMEOUT_HEAVY` | `60000` | Tempo limite em milissegundos para ferramentas pesadas (inserir ou importar arquivos, exportação, preflight, guias de estilo e amostras de cor, variações de tamanho) |

Aumente esses valores quando uma única chamada precisar de mais tempo que o padrão: por exemplo, ao importar um SVG grande com `import_svg_as_editable` (mais de 100 objetos) ou ao executar `get_document_structure` / `export_pdf` em um documento grande.

Os valores devem ser inteiros positivos em milissegundos. Qualquer outro valor (`0`, um número negativo, uma string não numérica ou um valor acima de 2147483647) volta ao padrão. Eles são lidos uma única vez na inicialização do servidor.

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

## 🎬 O Que Você Pode Fazer

```
Você:    Mostre-me todas as informações de texto deste documento
Claude:  → list_text_frames → get_text_frame_detail
         Existem 12 frames de texto no documento.
         O título "My Design" usa Noto Sans JP Bold 48px, cor #333333 ...
```

```
Você:    Execute uma verificação preflight de pré-impressão
Claude:  → preflight_check
         ⚠ 2 avisos:
         - Imagem de baixa resolução: image_01.jpg (150dpi) — recomendado 300dpi ou mais
         - Fontes não convertidas em curvas: 3 frames de texto
```

```
Você:    Verifique inconsistências no texto
Claude:  → check_text_consistency
         📝 Relatório de Consistência:
         ⚠ "Contact Us" vs "Contact us" — diferença de capitalização
         ❌ "Lorem ipsum" (2 locais) — texto placeholder ainda presente
```

```
Você:    Crie variações de tamanho de banner a partir deste panfleto A4
Claude:  → get_document_info → resize_for_variation
         Criadas 3 variações de tamanho:
         - 728×90 / 300×250 / 160×600
```

---

## 🆚 Comparação com o MCP Oficial do Illustrator da Adobe

**Em resumo: tudo o que o MCP oficial faz, este projeto também faz — e muito mais.** A Adobe inclui um servidor MCP integrado no **Illustrator Beta** (30.4+, ainda restrito ao Beta em agosto de 2026), focado em analisar e processar em lote documentos existentes. Este projeto cobre esses mesmos fluxos de trabalho — análise, recolorização em massa, variações, exportação em lote de pranchetas, verificação de fontes / links quebrados — e adiciona o que o servidor oficial não tem: **criar do zero, salvar documentos, verificações de impressão e pré-impressão, e ferramentas de design system**. E tudo isso rodando no Illustrator estável, sem precisar do Beta.

| | Este projeto | MCP oficial da Adobe (beta) |
|---|---|---|
| Instalação | npm (`npx illustrator-mcp-server`) ou instalação em um clique via `.mcpb` | Integrado ao Illustrator Beta — obtenha a chave de autenticação + URL nas configurações do app e conecte via `mcp-remote` |
| Versões suportadas | Illustrator 2024+ verificado / 2020+ não verificado (macOS / Windows) | Apenas Illustrator Beta 30.4+ |
| Número de ferramentas | 67 | ~40 |
| Análise e processamento em lote de documentos existentes | ✅ Análise de estrutura / cores / fontes, recolorização em massa, variações e conjuntos de dados, exportação em lote de pranchetas (`artboard:all`), preflight de fontes e links quebrados | ✅ Seu foco principal |
| Criação de objetos do zero | ✅ Conjunto completo — documentos, formas, caminhos, quadros de texto, texto em caminho, gradientes | ❌ Sem novos objetos, quadros de texto ou documentos \* |
| Salvar documentos | ✅ `save_document` (salvar / salvar como) | ❌ Apenas exportação \* |
| Impressão e pré-impressão | ✅ Marcas de corte, preflight, informações de sobreimpressão / separação, conversão em contornos, perfis de cor | — |
| Sistema de design | ✅ Tokens de design, verificação de contraste WCAG, guias de estilo, consistência de texto | — |

\* Baseado em relatos de usuários em abril de 2026 (beta). O servidor oficial está em desenvolvimento ativo — veja a [documentação da Adobe](https://helpx.adobe.com/illustrator/desktop/connect-with-other-apps-and-tools/about-using-ai-tools-with-illustrator.html) para o status mais recente.

---

## 📖 Receitas

<details>
<summary><b>Extrair cores e fontes para CSS</b></summary>

```
Você:    Resuma as cores e a tipografia deste design

Claude:  → get_colors → list_text_frames → get_text_frame_detail

         ■ Paleta de Cores
         - Primária: #1A73E8 (CMYK: 85,50,0,0)
         - Secundária: #34A853
         - Texto: #202124
         - Fundo: #FFFFFF

         ■ Tipografia
         - Títulos: Noto Sans JP Bold / 32px
         - Corpo: Noto Sans JP Regular / 16px / line-height: 1.75
         - Legendas: Noto Sans JP Medium / 12px
```

</details>

<details>
<summary><b>Exportar pranchetas como SVG / PNG</b></summary>

```
Você:    Exporte todas as pranchetas como SVG com texto convertido em curvas

Claude:  → get_artboards → convert_to_outlines → export (repetido)

         4 pranchetas exportadas:
         - /output/header.svg
         - /output/hero.svg
         - /output/feature.svg
         - /output/footer.svg
```

</details>

<details>
<summary><b>Verificar conformidade PDF/X-1a antes do envio</b></summary>

```
Você:    Verifique se este documento está em conformidade com PDF/X-1a

Claude:  → preflight_check (target_pdf_profile: "x1a")

         ❌ Erros de conformidade PDF/X-1a:
         - Transparência em 3 objetos (X-1a proíbe transparência)
         - Cores RGB encontradas em 2 locais (X-1a requer apenas CMYK/cores especiais)

         ⚠ Avisos:
         - 5 fontes não convertidas em curvas (incorporação recomendada)
         - Imagem "photo_02.jpg" a 150dpi (300dpi recomendado)
```

</details>

<details>
<summary><b>Verificar qualidade de imagem para impressão</b></summary>

```
Você:    Verifique a qualidade das imagens inseridas para impressão

Claude:  → get_images (include_print_info: true)

         ■ Relatório de Qualidade de Imagem:
         ✅ hero.psd — CMYK, 350ppi efetivos
         ⚠ icon_set.png — RGB (incompatível com documento CMYK), 300ppi efetivos
         ❌ photo_bg.jpg — CMYK, 72ppi efetivos (ampliada em excesso)
           → Substituir por imagem de 300dpi+ em tamanho real
```

</details>

<details>
<summary><b>Verificar razões de contraste de cor WCAG</b></summary>

```
Você:    Verifique as razões de contraste do texto

Claude:  → check_contrast (auto_detect: true)

         ■ Relatório de Contraste WCAG:
         ❌ "Caption" sobre "cinza claro" — 2.8:1 (AA reprovado)
         ⚠ "Subheading" sobre "branco" — 4.2:1 (AA Large OK, AA Normal reprovado)
         ✅ "Body text" sobre "branco" — 12.1:1 (AAA aprovado)
```

</details>

---

## Templates de Fluxo de Trabalho

Templates de fluxo de trabalho pré-construídos, disponíveis no seletor de prompts do Claude Desktop.

| Template | Descrição |
|----------|-----------|
| `quick-layout` | Cole o conteúdo de texto e o Claude o organiza na prancheta como títulos, corpo e legendas |
| `print-preflight-workflow` | Verificação completa de pré-impressão em 7 passos (documento → preflight → sobreimpressão → separações → imagens → cores → texto) |

---

## Referência de Ferramentas

### Ferramentas de Leitura (21)

<details>
<summary>Clique para expandir</summary>

| Ferramenta | Descrição |
|---|---|
| `get_document_info` | Metadados do documento (dimensões, modo de cor, perfil, etc.) |
| `get_artboards` | Informações de pranchetas (posição, tamanho, orientação) |
| `get_layers` | Estrutura de camadas em formato de árvore |
| `get_document_structure` | Árvore completa: camadas → grupos → objetos em uma única chamada |
| `list_text_frames` | Lista de frames de texto (fonte, tamanho, nome do estilo) |
| `get_text_frame_detail` | Todos os atributos de um frame de texto específico (kerning, configurações de parágrafo, etc.) |
| `get_colors` | Informações de cores em uso (amostras, gradientes, cores especiais; cada cor usada aparece uma vez com sua contagem de uso). `include_diagnostics` para análise de impressão |
| `get_path_items` | Dados de paths/formas (preenchimento, traço, pontos de ancoragem) |
| `get_groups` | Grupos, máscaras de recorte e estrutura de paths compostos |
| `get_effects` | Efeitos e informações de aparência (opacidade, modo de mesclagem) |
| `get_images` | Informações de imagens incorporadas/vinculadas (resolução, detecção de links quebrados). `include_print_info` para resolução efetiva por eixo e incompatibilidade de espaço de cor |
| `get_symbols` | Definições e instâncias de símbolos |
| `get_guidelines` | Informações de guias |
| `get_overprint_info` | Configurações de sobreimpressão em paths, texto e imagens raster + detecção de K100/preto rico, com um rótulo heurístico inferido apenas pelas cores (não consegue saber a intenção) |
| `get_separation_info` | Informações de separação de cores (placas de processo e de cores especiais realmente usadas, com contagem de uso; tintas sem uso detectado são listadas à parte) |
| `get_selection` | Detalhes dos objetos atualmente selecionados |
| `find_objects` | Busca por critérios (nome, tipo, cor, fonte, etc.) |
| `check_contrast` | Verificação de razão de contraste de cor WCAG (manual ou detecção automática de pares sobrepostos) |
| `extract_design_tokens` | Extrai design tokens como CSS custom properties, JSON ou configuração do Tailwind (ao gravar em arquivo, nunca substitui um existente sem `overwrite: true`) |
| `list_fonts` | Lista as fontes disponíveis no Illustrator (não requer documento aberto) |
| `convert_coordinate` | Converte pontos entre os sistemas de coordenadas de prancheta e documento |

</details>

### Ferramentas de Modificação (40)

<details>
<summary>Clique para expandir</summary>

| Ferramenta | Descrição |
|---|---|
| `create_rectangle` | Cria um retângulo (suporta cantos arredondados) |
| `create_ellipse` | Cria uma elipse |
| `create_line` | Cria uma linha |
| `create_text_frame` | Cria um frame de texto (ponto ou área) com tracking, entrelinha e alinhamento de parágrafo opcionais. `font_name` deve ser o nome exato de `list_fonts` — uma fonte desconhecida gera erro em vez de ser substituída silenciosamente |
| `create_path` | Cria um path customizado (com alças Bezier) |
| `place_image` | Insere um arquivo de imagem raster/PDF como vinculado ou incorporado (SVG é recusado — use `import_svg_as_editable`) |
| `import_svg_as_editable` | Importa um arquivo SVG como paths/textos/grupos editáveis do Illustrator (não como imagem vinculada) |
| `modify_object` | Modifica propriedades de um objeto existente (incl. tracking, entrelinha e alinhamento de texto). Preenchimento/traçado em um grupo ou path composto é aplicado a todos os paths e textos dentro dele |
| `convert_to_outlines` | Converte texto em curvas |
| `assign_color_profile` | Atribui (marca) um perfil de cor (não converte os valores de cor) |
| `create_document` | Cria um novo documento (tamanho, modo de cor) |
| `close_document` | Fecha o documento ativo (se houver alterações não salvas, não fecha a menos que `save` seja informado) |
| `resize_for_variation` | Cria variações de tamanho a partir de uma prancheta de origem (escala proporcional) |
| `align_objects` | Alinha e distribui múltiplos objetos |
| `replace_color` | Localiza e substitui cores em todo o documento (com tolerância) |
| `manage_layers` | Adiciona, renomeia, mostra/esconde, bloqueia/desbloqueia, reordena ou exclui camadas |
| `place_color_chips` | Extrai cores únicas e posiciona amostras de color chips fora da prancheta |
| `save_document` | Salva ou salva como do documento ativo (salvar como não substitui um arquivo existente sem `overwrite: true`) |
| `open_document` | Abre um documento a partir de um caminho de arquivo |
| `group_objects` | Agrupa objetos (suporta máscaras de recorte) |
| `ungroup_objects` | Desagrupa um grupo, liberando os filhos |
| `duplicate_objects` | Duplica objetos com deslocamento opcional |
| `set_z_order` | Muda a ordem de empilhamento (frente/fundo) |
| `move_to_layer` | Move objetos para outra camada |
| `delete_objects` | Exclui objetos por UUID (objetos bloqueados exigem `force_unlock`; `undo` pode revertê-lo, mas seus passos seguem o histórico do Illustrator, não as chamadas MCP) |
| `manage_artboards` | Adiciona, remove, redimensiona, renomeia, reorganiza pranchetas |
| `manage_swatches` | Adiciona, atualiza ou exclui amostras de cor |
| `manage_linked_images` | Re-vincula ou incorpora imagens inseridas |
| `manage_datasets` | Lista/aplica/cria datasets, importa/exporta variáveis |
| `apply_graphic_style` | Aplica um estilo gráfico aos objetos |
| `list_graphic_styles` | Lista todos os estilos gráficos do documento |
| `apply_text_style` | Aplica estilo de caractere ou parágrafo ao texto |
| `list_text_styles` | Lista todos os estilos de caractere e parágrafo |
| `create_gradient` | Cria gradientes e aplica aos objetos |
| `create_path_text` | Cria texto ao longo de um path (tracking e alinhamento opcionais; `font_name` segue a mesma regra de nome exato do `create_text_frame`) |
| `place_symbol` | Insere ou substitui instâncias de símbolos |
| `select_objects` | Seleciona objetos por UUID (seleção múltipla suportada) |
| `create_crop_marks` | Cria marcas de corte com detecção automática de estilo por locale (linha dupla japonesa / linha única ocidental) |
| `place_style_guide` | Posiciona um guia de estilo visual fora da prancheta em uma camada não imprimível (cores, fontes, espaçamentos, margens, distâncias entre guias). Marcações de medida sobre a própria prancheta são opcionais (`annotate_artboard`) |
| `undo` | Operações de undo/redo (múltiplos passos) |

</details>

### Ferramentas de Exportação (2)

<details>
<summary>Clique para expandir</summary>

| Ferramenta | Descrição |
|---|---|
| `export` | Exportação SVG / PNG / JPG (por prancheta, seleção ou UUID; com seleção/UUID, apenas esse objeto é exportado; não substitui um arquivo existente sem `overwrite: true`) |
| `export_pdf` | Exportação de PDF pronto para impressão (marcas de corte, sangria, downsampling seletivo, output intent) |

</details>

### Utilitários (4)

<details>
<summary>Clique para expandir</summary>

| Ferramenta | Descrição |
|---|---|
| `preflight_check` | Verificação preflight de pré-impressão (mistura de RGB, links quebrados, baixa resolução, sobreimpressão branca, interação transparência+sobreimpressão, conformidade PDF/X, etc.). Informa quais verificações foram completas ou apenas parciais (`coverage`) |
| `check_text_consistency` | Verificação de consistência de texto (detecção de placeholders, padrões de variação de grafia, listagem completa de texto para análise por LLM) |
| `set_workflow` | Define o modo de fluxo de trabalho (web/print) para sobrescrever o sistema de coordenadas detectado automaticamente |
| `set_illustrator_version` | Escolhe qual versão do Illustrator usar quando há várias instaladas |

</details>

---

## Sistema de Coordenadas

O servidor detecta automaticamente o sistema de coordenadas a partir do documento:

| Tipo de documento | Sistema de coordenadas | Origem | Eixo Y |
|---|---|---|---|
| CMYK / Impressão | `document` | Inferior esquerdo | Para cima |
| RGB / Web | `artboard-web` | Superior esquerdo da prancheta | Para baixo |

- **Documentos CMYK** usam o sistema de coordenadas nativo do Illustrator, coincidindo com o que designers de impressão esperam
- **Documentos RGB** usam um sistema de coordenadas estilo web, mais fácil para a IA trabalhar
- Use `set_workflow` para sobrescrever o sistema detectado automaticamente, se necessário
- Todas as respostas das ferramentas incluem um campo `coordinateSystem` indicando qual sistema está ativo
- Se a detecção automática falhar, as ferramentas retornam um erro em vez de adivinhar — informe `coordinate_system` explicitamente ou use `set_workflow`

---

## Exemplo: Padrão de Teste SMPTE

Um padrão de teste de barras de cor SMPTE 1920×1080, criado inteiramente por meio de instruções em linguagem natural ao Claude.

**Prompt:**

> Faça um padrão de teste de vídeo em 1920x1080

**Resultado:**

<img src="docs/images/example-smpte-test-pattern.png" width="720" alt="Padrão de teste de barras de cor SMPTE gerado pelo Claude via illustrator-mcp-server" />

**Estrutura da prancheta** (via `get_document_structure`):

<details>
<summary>Clique para expandir</summary>

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

> Ferramentas utilizadas: `create_document`, `manage_layers`, `create_rectangle` ×23, `create_line` ×2, `create_ellipse`, `create_text_frame` ×6, `modify_object` ×4, `save_document`, `export`

---

## Exemplo: Twilight Geometry

Uma arte de paisagem geométrica abstrata — criada inteiramente pelo Claude, sem qualquer direção de design humana além de "faça a arte que quiser".

**Prompt:**

> Crie uma obra de arte a partir da sua própria imaginação no Illustrator. Não tenha pressa. Faça o que quiser.

**Processo do Claude:**

> Vou criar "Twilight Geometry" — uma paisagem abstrata com elementos celestes geométricos. Um céu crepuscular com gradiente profundo, silhuetas de montanhas em camadas, uma lua crescente com anéis decorativos e estrelas espalhadas pela tela.

> Estrelas em formato de diamante em diferentes cores — brancos quentes, azuis frios, lavandas — cada uma sutilmente diferente para sugerir diferentes tipos de estrelas. Linhas de constelações conectando-as. Triângulos em wireframe e um hexágono flutuando no céu para um clima místico.

> Uma superfície de água na parte inferior com a luz da lua refletida em linhas onduladas cintilantes, que vão se desvanecendo à medida que descem.

**Reflexão do Claude:**

> Ficou melhor do que eu esperava. Acho que o mundo híbrido entre geometria e natureza foi bem transmitido.

**Resultado:**

<img src="docs/images/example-twilight-geometry.png" width="720" alt="Twilight Geometry — arte de paisagem geométrica abstrata gerada pelo Claude via illustrator-mcp-server" />

> Ferramentas utilizadas: `create_document`, `manage_layers` ×4, `create_rectangle` ×2, `create_gradient` ×2, `create_path` ×11, `create_ellipse` ×14, `create_line` ×4, `create_text_frame` ×2, `modify_object`, `set_z_order`, `export`

---

## Limitações Conhecidas

| Limitação | Detalhes |
|---|---|
| Suporte ao Windows | Windows usa automação COM via PowerShell (ainda não testado em hardware real) |
| Live effects | Parâmetros de sombra projetada e outros efeitos podem ser detectados, mas não lidos |
| Perfis de cor | Apenas atribuição de perfil de cor — conversão completa não está disponível |
| Configurações de sangria | Configurações de sangria não podem ser lidas (limitação da API do Illustrator) |
| Exportação WebP | Não suportado — use PNG ou SVG em vez disso |
| Marcas de corte japonesas | A exportação em PDF gera temporariamente as marcas no documento com o comando TrimMark, exporta e depois as remove. Apenas documentos com uma prancheta — com várias pranchetas, retorna um erro |
| Incorporação de fontes | O modo de incorporação (full/subset) não pode ser controlado diretamente — use PDF presets |
| Variações de tamanho | Apenas escala proporcional — o texto pode precisar de ajuste manual posteriormente |
| Fallback de glifos em texto SVG | O Illustrator não faz fallback glifo a glifo entre as fontes de uma lista `font-family`. Se a primeira família estiver instalada mas não tiver um glifo, o `import_svg_as_editable` descarta esse caractere silenciosamente e ainda assim informa sucesso. Use uma única `font-family` por elemento de texto e escolha uma que contenha os glifos necessários. Uma família *não instalada* é substituída e não é afetada; o `preflight_check` cobre esse outro caso |
| Notas de objetos | As ferramentas identificam objetos por um UUID armazenado na nota de cada objeto (painel Atributos). Uma nota escrita por você é mantida — o UUID é adicionado antes dela |

---

<br>

# Para Desenvolvedores

## Arquitetura

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

## Build a partir do código-fonte

```bash
git clone https://github.com/ie3jp/illustrator-mcp-server.git
cd illustrator-mcp-server
npm install
npm run build
claude mcp add illustrator-mcp -- node /path/to/illustrator-mcp-server/dist/index.js
```

### Verificação

```bash
npx @modelcontextprotocol/inspector npx illustrator-mcp-server
```

### Testes

```bash
# Testes unitários
npm test

# Smoke test E2E (requer Illustrator em execução)
npm run build   # E2E runs dist/index.js
npx tsx test/e2e/e2e-test.ts        # every tool (193 cases)
npx tsx test/e2e/e2e-behaviors.ts   # behavior & regression checks (92 cases)
npx tsx test/e2e/e2e-cmyk-only.ts
npx tsx test/e2e/svg-import-test.ts
```

As suítes E2E criam seus próprios documentos, não mexem em outros documentos abertos e os fecham sem salvar. `e2e-test.ts` executa todas as ferramentas registradas (RGB + CMYK, detecção automática do sistema de coordenadas); `e2e-behaviors.ts` verifica comportamentos que precisam valer no app real: notas são preservadas, falhas parciais são informadas, arquivos não são sobrescritos e marcas de corte e exportação em PDF não alteram sua arte.

---

## Aviso Legal

Esta ferramenta automatiza muitas operações do Illustrator, mas a IA pode cometer erros. Dados extraídos, resultados de preflight e modificações de documento devem sempre ser revisados por uma pessoa. **Não confie nesta ferramenta como sua única verificação de qualidade.** Use-a como assistente junto com sua própria verificação manual, especialmente para envios a gráficas e entregas a clientes. Os autores não se responsabilizam por quaisquer danos ou perdas decorrentes do uso deste software ou de seus resultados.

---

## Licença

[MIT](LICENSE)
