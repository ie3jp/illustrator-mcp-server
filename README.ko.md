[🇺🇸 English](README.md) | [🇯🇵 日本語](README.ja.md) | [🇨🇳 简体中文](README.zh-CN.md) | **🇰🇷 한국어** | [🇪🇸 Español](README.es.md) | [🇩🇪 Deutsch](README.de.md) | [🇫🇷 Français](README.fr.md) | [🇵🇹 Português (BR)](README.pt-BR.md)

# Illustrator MCP Server

[![npm](https://img.shields.io/npm/v/illustrator-mcp-server.svg?style=flat-square&colorA=18181B&colorB=18181B)](https://www.npmjs.com/package/illustrator-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-18181B.svg?style=flat-square&colorA=18181B)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-18181B.svg?style=flat-square&colorA=18181B)]()
[![Illustrator](https://img.shields.io/badge/Illustrator-CC%202024%2B-18181B.svg?style=flat-square&colorA=18181B)](https://www.adobe.com/products/illustrator.html)
[![MCP](https://img.shields.io/badge/MCP-Compatible-18181B.svg?style=flat-square&colorA=18181B)](https://modelcontextprotocol.io/)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-FF5E5B?style=flat&logo=ko-fi&logoColor=white)](https://ko-fi.com/cyocun)

Adobe Illustrator의 디자인 데이터를 읽고, 조작하고, 내보내기 위한 [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) 서버 — 66개의 내장 도구 제공.

Claude와 같은 AI 어시스턴트에서 Illustrator를 직접 제어 — 웹 구현을 위한 디자인 정보 추출, 인쇄 납품용 데이터 검증, 에셋 내보내기까지.

Adobe 공식 Illustrator MCP(Beta)가 할 수 있는 것은 전부, 그리고 그 이상까지. 자세한 내용은 [비교표](#-adobe-공식-illustrator-mcp와의-비교)를 참고하세요.

[![illustrator mcp server MCP server](https://glama.ai/mcp/servers/ie3jp/illustrator-mcp-server/badges/card.svg)](https://glama.ai/mcp/servers/ie3jp/illustrator-mcp-server)

> [!NOTE]
> Claude의 확장 기능 디렉터리와 플러그인 마켓플레이스에서는 **Design Bridge by IE3**라는 이름으로 등록되어 있습니다. Anthropic 디렉터리에서는 다른 회사의 브랜드명을 등록 이름에 쓸 수 없어 이름이 다르지만, 같은 프로젝트이며 npm 패키지 이름도 그대로 `illustrator-mcp-server`입니다. 이전 이름(`illustrator@ie3jp-illustrator`)으로 Claude Code 플러그인을 설치했다면 [Claude Code](#-빠른-시작) 안내에 따라 다시 설치하세요.

---

## 🎨 갤러리

아래의 모든 아트워크는 Claude가 자연어 대화만으로 전부 제작했습니다 — Illustrator의 수동 조작은 일체 없었습니다.

<table>
<tr>
<td align="center"><img src="docs/images/example-event-poster.png" width="300" alt="이벤트 포스터 — SYNC TOKYO 2026" /><br><b>이벤트 포스터</b></td>
<td align="center"><img src="docs/images/example-logo-concepts.png" width="300" alt="로고 컨셉 — Slow Drip Coffee Co." /><br><b>로고 컨셉</b></td>
</tr>
<tr>
<td align="center"><img src="docs/images/example-business-card.png" width="300" alt="명함 — KUMO Studio" /><br><b>명함</b></td>
<td align="center"><img src="docs/images/example-twilight-geometry.png" width="300" alt="Twilight Geometry — 추상적 기하학적 풍경" /><br><b>Twilight Geometry</b></td>
</tr>
</table>

> 프롬프트, 도구 사용, 아트보드 구성에 대한 [자세한 분석](#예시-smpte-테스트-패턴)은 아래를 참고하세요.

---

> [!TIP]
> 이 도구를 개발하고 유지관리하는 데는 시간과 리소스가 필요합니다.
> 여러분의 워크플로우에 도움이 된다면, 후원은 큰 힘이 됩니다 — [☕ 커피 한 잔 사주기!](https://ko-fi.com/cyocun)

---

## 🚀 빠른 시작

### 🛠️ Claude Code

[Node.js 20+](https://nodejs.org/)가 필요합니다.

```bash
claude mcp add illustrator-mcp -- npx illustrator-mcp-server
```

플러그인으로 설치할 수도 있습니다. MCP 서버와 인쇄 전 점검(프리플라이트) 스킬이 함께 들어 있습니다(Claude Cowork에서도 사용 가능).

```
/plugin install ie3-design-bridge --marketplace ie3jp/illustrator-mcp-server
```

Claude Code v2.1.275 이전 버전에서는 먼저 마켓플레이스를 추가합니다.

```
/plugin marketplace add ie3jp/illustrator-mcp-server
/plugin install ie3-design-bridge@ie3
```

이미 `claude mcp add`로 서버를 등록했다면, 두 번 실행되지 않도록 먼저 `claude mcp remove illustrator-mcp`로 제거하세요.

### 🖥️ Claude Desktop

1. [GitHub Releases](https://github.com/ie3jp/illustrator-mcp-server/releases/latest)에서 **`illustrator-mcp-server.mcpb`** 를 다운로드
2. Claude Desktop 열기 → **Settings** → **Extensions**
3. `.mcpb` 파일을 Extensions 패널에 드래그 앤 드롭
4. **Install** 버튼 클릭

<details>
<summary><strong>대안: 수동 설정 (npx를 통해 항상 최신 상태 유지)</strong></summary>

> [!NOTE]
> `.mcpb` 확장은 자동 업데이트되지 않습니다. 업데이트하려면 새 버전을 다운로드하여 재설치하세요. 자동 업데이트를 선호한다면 아래의 npx 방식을 대신 사용하세요.

[Node.js 20+](https://nodejs.org/)가 필요합니다. 설정 파일을 열고 연결 설정을 추가하세요.

#### 1. 설정 파일 열기

Claude Desktop 메뉴 바에서:

**Claude** → **Settings...** → **Developer** (좌측 사이드바) → **Edit Config** 버튼 클릭

#### 2. 설정 추가

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
> 버전 관리자(nvm, mise, fnm 등)로 Node.js를 설치한 경우, Claude Desktop이 `npx`를 찾지 못할 수 있습니다. 이 경우 전체 경로를 사용하세요:
> ```json
> "command": "/full/path/to/npx"
> ```
> 터미널에서 `which npx`를 실행하여 경로를 확인하세요.

#### 3. 저장 및 재시작

1. 파일을 저장하고 텍스트 에디터를 닫습니다
2. Claude Desktop을 **완전히 종료**(⌘Q / Ctrl+Q)한 후 다시 엽니다

</details>

> [!CAUTION]
> AI는 실수할 수 있습니다. 출력에 과도하게 의존하지 말고 — **납품 데이터는 반드시 사람이 최종 확인해야 합니다**. 결과에 대한 책임은 사용자에게 있습니다.

> [!NOTE]
> **macOS:** 처음 실행 시, 시스템 설정 > 개인정보 보호 및 보안 > 자동화에서 자동화 접근 권한을 허용하세요.

> [!NOTE]
> 대부분의 수정 도구는 실행 중에 Illustrator를 전면으로 가져옵니다. 읽기 도구와 `export`는 앱을 전환하지 않고 실행되며, `export_pdf`는 일본식 재단선을 그릴 때만 Illustrator를 전면으로 가져옵니다.

> [!NOTE]
> **파일은 기본적으로 보호됩니다.** `close_document`는 명시적으로 지정하지 않는 한(`save: false`) 저장하지 않은 변경 사항을 버리지 않으며, `export`, `export_pdf`, `save_document`(다른 이름으로 저장), `extract_design_tokens`는 `overwrite: true`를 지정하지 않는 한 기존 파일을 덮어쓰지 않습니다. 그렇게 하고 싶다면 Claude에게 "저장하지 않고 닫아줘" 또는 "파일을 덮어써줘"라고 말하면 됩니다.

### 여러 Illustrator 버전

여러 버전의 Illustrator가 설치되어 있는 경우, 대화 중에 어떤 버전을 사용할지 Claude에게 알려줄 수 있습니다. "Illustrator 2024를 사용해" 같은 식으로 말하면 `set_illustrator_version` 도구가 해당 버전을 대상으로 합니다.


**지원 버전:** Illustrator 2024(v28) 이상에서 검증했습니다. Illustrator 2020~2023(v24~v27)도 동작할 것으로 예상됩니다 — 이 서버가 사용하는 모든 ExtendScript API는 v24 시점에 이미 존재합니다 — 하지만 **검증되지 않았으므로** 해당 버전에서 실행하면 도구가 경고를 반환합니다. 2020(v24)보다 오래된 버전은 지원하지 않습니다. 검증되지 않은 버전에서 문제가 발생하면 [이슈](https://github.com/ie3jp/illustrator-mcp-server/issues)로 알려주세요.
> [!NOTE]
> Illustrator가 이미 실행 중인 경우, 버전 설정과 관계없이 서버는 실행 중인 인스턴스에 연결됩니다. 이 버전 설정은 Illustrator가 아직 실행되지 않은 상태에서 올바른 버전을 실행하기 위해서만 사용됩니다.

### 환경 변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `ILLUSTRATOR_MCP_TIMEOUT_NORMAL` | `30000` | 일반 도구의 타임아웃(밀리초) |
| `ILLUSTRATOR_MCP_TIMEOUT_HEAVY` | `60000` | 무거운 도구(파일 배치·가져오기, 내보내기, 프리플라이트, 스타일 가이드·컬러 칩, 사이즈 바리에이션)의 타임아웃(밀리초) |

한 번의 호출에 기본값보다 오래 걸리는 경우 늘려 주세요. 예를 들어 `import_svg_as_editable`로 대용량 SVG(객체 100개 이상)를 가져오거나, 큰 문서에서 `get_document_structure` / `export_pdf`를 실행하는 경우입니다.

값은 밀리초 단위의 양의 정수여야 합니다. 그 외의 값(`0`, 음수, 숫자가 아닌 문자열, 2147483647을 초과하는 값)은 기본값으로 돌아갑니다. 값은 서버 시작 시 한 번만 읽습니다.

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

## 🎬 할 수 있는 것들

```
당신:   이 문서의 모든 텍스트 정보를 보여줘
Claude:  → list_text_frames → get_text_frame_detail
         문서에 12개의 텍스트 프레임이 있습니다.
         헤딩 "My Design"은 Noto Sans JP Bold 48px, 컬러 #333333 사용 중...
```

```
당신:   인쇄 전 프리플라이트 체크를 실행해줘
Claude:  → preflight_check
         ⚠ 경고 2건:
         - 저해상도 이미지: image_01.jpg (150dpi) — 300dpi 이상 권장
         - 윤곽선화되지 않은 폰트: 텍스트 프레임 3건
```

```
당신:   텍스트 일관성을 확인해줘
Claude:  → check_text_consistency
         📝 일관성 리포트:
         ⚠ "Contact Us" vs "Contact us" — 대소문자 불일치
         ❌ "Lorem ipsum" (2군데) — 자리표시 텍스트 잔존
```

```
당신:   이 A4 전단지로부터 배너 사이즈 바리에이션을 만들어줘
Claude:  → get_document_info → resize_for_variation
         3개의 사이즈 바리에이션을 생성했습니다:
         - 728×90 / 300×250 / 160×600
```

---

## 🆚 Adobe 공식 Illustrator MCP와의 비교

**요점: 공식 MCP가 할 수 있는 것은 본 프로젝트에서도 전부 가능하며, 그 이상까지 제공합니다.** Adobe는 **Illustrator Beta**(30.4 이상, 2026년 8월 기준 여전히 Beta 한정)에 MCP 서버를 내장하고 있으며, 기존 문서의 분석과 일괄 처리에 특화되어 있습니다. 본 프로젝트는 동일한 워크플로우 — 분석, 일괄 리컬러, 바리에이션 생성, 여러 아트보드 일괄 내보내기, 폰트 / 링크 누락 검사 — 를 모두 지원하면서, 공식에 없는 **제로부터의 제작, 문서 저장, 인쇄·입고 검사, 디자인 시스템 기능**을 갖추고 있습니다. 게다가 Beta 버전 없이 안정판 Illustrator에서 동작합니다.

| | 본 프로젝트 | Adobe 공식 MCP (Beta) |
|---|---|---|
| 설치 방법 | npm(`npx illustrator-mcp-server`) 또는 `.mcpb` 원클릭 설치 | Illustrator Beta 내장 — 앱 설정에서 인증 키와 URL을 받아 `mcp-remote`로 연결 |
| 지원 버전 | Illustrator 2024+ 검증됨 / 2020+ 미검증 (macOS / Windows) | Illustrator Beta 30.4+ 한정 |
| 도구 수 | 66 | 약 40 |
| 기존 문서 분석・일괄 처리 | ✅ 구조 / 컬러 / 폰트 분석, 일괄 리컬러, 바리에이션 생성・데이터셋, 전체 아트보드 일괄 내보내기(`artboard:all`), 폰트 / 링크 누락 프리플라이트 | ✅ 주요 포커스 |
| 제로부터 오브젝트 생성 | ✅ 풀셋 — 문서, 도형, 패스, 텍스트 프레임, 패스 문자, 그라디언트 | ❌ 새 오브젝트・텍스트 프레임・문서 생성 불가 \* |
| 문서 저장 | ✅ `save_document` (저장 / 다른 이름으로 저장) | ❌ 내보내기만 가능 \* |
| 인쇄・출판(DTP) 기능 | ✅ 재단선, 프리플라이트, 오버프린트 / 분판 정보, 아웃라인 변환, 컬러 프로파일 | — |
| 디자인 시스템 기능 | ✅ 디자인 토큰, WCAG 대비 검사, 스타일 가이드, 텍스트 일관성 검사 | — |

\* 2026년 4월(Beta) 시점의 사용자 보고에 기반합니다. 공식 서버는 활발히 개발 중입니다 — 최신 상태는 [Adobe 공식 문서](https://helpx.adobe.com/illustrator/desktop/connect-with-other-apps-and-tools/about-using-ai-tools-with-illustrator.html)를 참조하세요.

---

## 📖 레시피

<details>
<summary><b>CSS용 컬러와 폰트 추출</b></summary>

```
당신:   이 디자인의 컬러와 타이포그래피를 요약해줘

Claude:  → get_colors → list_text_frames → get_text_frame_detail

         ■ 컬러 팔레트
         - Primary: #1A73E8 (CMYK: 85,50,0,0)
         - Secondary: #34A853
         - Text: #202124
         - Background: #FFFFFF

         ■ 타이포그래피
         - 헤딩: Noto Sans JP Bold / 32px
         - 본문: Noto Sans JP Regular / 16px / line-height: 1.75
         - 캡션: Noto Sans JP Medium / 12px
```

</details>

<details>
<summary><b>아트보드를 SVG / PNG로 내보내기</b></summary>

```
당신:   모든 아트보드를 텍스트 윤곽선화하여 SVG로 내보내줘

Claude:  → get_artboards → convert_to_outlines → export (반복)

         4개의 아트보드를 내보냈습니다:
         - /output/header.svg
         - /output/hero.svg
         - /output/feature.svg
         - /output/footer.svg
```

</details>

<details>
<summary><b>납품 전 PDF/X-1a 준수 여부 확인</b></summary>

```
당신:   이 문서가 PDF/X-1a를 준수하는지 확인해줘

Claude:  → preflight_check (target_pdf_profile: "x1a")

         ❌ PDF/X-1a 준수 오류:
         - 객체 3개에 투명도 사용 (X-1a는 투명도 금지)
         - RGB 컬러 2군데 발견 (X-1a는 CMYK/별색만 허용)

         ⚠ 경고:
         - 윤곽선화되지 않은 폰트 5개 (임베드 권장)
         - 이미지 "photo_02.jpg" 150dpi (300dpi 권장)
```

</details>

<details>
<summary><b>인쇄용 이미지 품질 체크</b></summary>

```
당신:   배치된 이미지의 인쇄 품질을 확인해줘

Claude:  → get_images (include_print_info: true)

         ■ 이미지 품질 리포트:
         ✅ hero.psd — CMYK, 유효 350ppi
         ⚠ icon_set.png — RGB (CMYK 문서와 불일치), 유효 300ppi
         ❌ photo_bg.jpg — CMYK, 유효 72ppi (과도한 확대)
           → 실제 크기 기준 300dpi 이상의 이미지로 교체 필요
```

</details>

<details>
<summary><b>WCAG 컬러 대비율 체크</b></summary>

```
당신:   텍스트 대비율을 확인해줘

Claude:  → check_contrast (auto_detect: true)

         ■ WCAG 대비율 리포트:
         ❌ "Caption" on "light gray" — 2.8:1 (AA 불합격)
         ⚠ "Subheading" on "white" — 4.2:1 (AA Large 합격, AA Normal 불합격)
         ✅ "Body text" on "white" — 12.1:1 (AAA 합격)
```

</details>

---

## 워크플로우 템플릿

Claude Desktop의 프롬프트 피커에서 사용할 수 있는 사전 구축된 워크플로우 템플릿입니다.

| 템플릿 | 설명 |
|----------|-------------|
| `quick-layout` | 텍스트 콘텐츠를 붙여넣으면 Claude가 아트보드 위에 헤딩, 본문, 캡션으로 배치합니다 |
| `print-preflight-workflow` | 포괄적인 7단계 인쇄 전 체크 (문서 → 프리플라이트 → 오버프린트 → 색분리 → 이미지 → 컬러 → 텍스트) |

---

## 도구 레퍼런스

### 읽기 도구 (21)

<details>
<summary>클릭하여 펼치기</summary>

| 도구 | 설명 |
|---|---|
| `get_document_info` | 문서 메타데이터 (크기, 컬러 모드, 프로파일 등) |
| `get_artboards` | 아트보드 정보 (위치, 크기, 방향) |
| `get_layers` | 레이어 구조를 트리 형태로 반환 |
| `get_document_structure` | 전체 트리: 레이어 → 그룹 → 객체를 한 번의 호출로 |
| `list_text_frames` | 텍스트 프레임 목록 (폰트, 크기, 스타일명) |
| `get_text_frame_detail` | 특정 텍스트 프레임의 모든 속성 (커닝, 단락 설정 등) |
| `get_colors` | 사용 중인 컬러 정보 (스와치, 그라디언트, 별색. 사용 색상은 중복 없이 사용 횟수와 함께 표시). `include_diagnostics`로 인쇄 분석 가능 |
| `get_path_items` | 패스/셰이프 데이터 (채우기, 선, 고정점) |
| `get_groups` | 그룹, 클리핑 마스크, 컴파운드 패스 구조 |
| `get_effects` | 효과 및 어피어런스 정보 (불투명도, 블렌드 모드) |
| `get_images` | 임베디드/링크 이미지 정보 (해상도, 링크 끊김 감지). `include_print_info`로 축별 유효 해상도 및 색공간 불일치 확인 |
| `get_symbols` | 심볼 정의 및 인스턴스 |
| `get_guidelines` | 가이드 정보 |
| `get_overprint_info` | 패스·텍스트·래스터 이미지의 오버프린트 설정 + K100/리치 블랙 감지. 색상 값만으로 추정한 휴리스틱 분류 (제작 의도까지는 판단 불가) |
| `get_separation_info` | 색분리 정보 (실제로 사용된 프로세스 판·별색 판과 사용 횟수. 사용이 감지되지 않은 잉크는 별도로 표시) |
| `get_selection` | 현재 선택된 객체의 상세 정보 |
| `find_objects` | 조건으로 검색 (이름, 타입, 컬러, 폰트 등) |
| `check_contrast` | WCAG 컬러 대비율 체크 (수동 또는 겹치는 쌍 자동 감지) |
| `extract_design_tokens` | 디자인 토큰을 CSS 커스텀 속성, JSON, Tailwind 설정으로 추출 (파일로 저장할 때 `overwrite: true` 없이는 기존 파일을 덮어쓰지 않음) |
| `list_fonts` | Illustrator에서 사용 가능한 폰트 목록 (문서 불필요) |
| `convert_coordinate` | 아트보드와 문서 좌표계 사이의 좌표 변환 |

</details>

### 수정 도구 (39)

<details>
<summary>클릭하여 펼치기</summary>

| 도구 | 설명 |
|---|---|
| `create_rectangle` | 사각형 생성 (둥근 모서리 지원) |
| `create_ellipse` | 타원 생성 |
| `create_line` | 선 생성 |
| `create_text_frame` | 텍스트 프레임 생성 (포인트 또는 영역 타입). 자간(트래킹)·행간·단락 정렬 지정 가능. `font_name`은 `list_fonts`의 이름과 정확히 일치해야 함 (찾지 못하면 기본 폰트로 대체하지 않고 오류) |
| `create_path` | 커스텀 패스 생성 (베지어 핸들 포함) |
| `place_image` | 래스터/PDF 이미지 파일을 링크 또는 임베드로 배치 (SVG는 거부됨 — `import_svg_as_editable` 사용) |
| `import_svg_as_editable` | SVG 파일을 편집 가능한 Illustrator 패스/텍스트/그룹으로 가져오기 (링크 이미지가 아님) |
| `modify_object` | 기존 객체의 속성 수정 (텍스트 자간·행간·정렬 포함). 그룹이나 컴파운드 패스에 칠/선을 지정하면 내부의 모든 패스와 텍스트에 적용 |
| `convert_to_outlines` | 텍스트를 윤곽선화 |
| `create_document` | 새 문서 생성 (크기, 컬러 모드) |
| `close_document` | 활성 문서 닫기 (저장하지 않은 변경 사항이 있으면 `save`를 지정하지 않는 한 닫지 않음) |
| `resize_for_variation` | 소스 아트보드에서 사이즈 바리에이션 생성 (비례 스케일링) |
| `align_objects` | 여러 객체의 정렬 및 분포 |
| `replace_color` | 문서 전체에서 컬러를 찾아 치환 (허용 오차 포함) |
| `manage_layers` | 레이어 추가, 이름 변경, 표시/숨기기, 잠금/해제, 순서 변경, 삭제 |
| `place_color_chips` | 고유 컬러를 추출하여 아트보드 외부에 컬러 칩 스와치 배치 |
| `save_document` | 활성 문서 저장 또는 다른 이름으로 저장 (다른 이름으로 저장 시 `overwrite: true` 없이는 기존 파일을 덮어쓰지 않음) |
| `open_document` | 파일 경로로부터 문서 열기 |
| `group_objects` | 객체 그룹화 (클리핑 마스크 지원) |
| `ungroup_objects` | 그룹 해제 및 자식 요소 분리 |
| `duplicate_objects` | 객체 복제 (오프셋 옵션 포함) |
| `set_z_order` | 겹침 순서 변경 (앞/뒤) |
| `move_to_layer` | 객체를 다른 레이어로 이동 |
| `delete_objects` | UUID로 객체 삭제 (잠긴 객체는 `force_unlock` 필요. `undo`로 되돌릴 수도 있지만 단위는 MCP 호출이 아니라 Illustrator 작업 내역) |
| `manage_artboards` | 아트보드 추가, 제거, 크기 조정, 이름 변경, 재배치 |
| `manage_swatches` | 스와치 추가, 업데이트, 삭제 |
| `manage_linked_images` | 배치된 이미지의 재링크 또는 임베드 |
| `manage_datasets` | 데이터셋 목록/적용/생성, 변수 가져오기/내보내기 |
| `apply_graphic_style` | 객체에 그래픽 스타일 적용 |
| `list_graphic_styles` | 문서 내 모든 그래픽 스타일 목록 |
| `apply_text_style` | 텍스트에 문자 또는 단락 스타일 적용 |
| `list_text_styles` | 모든 문자 및 단락 스타일 목록 |
| `create_gradient` | 그라디언트 생성 및 객체에 적용 |
| `create_path_text` | 패스를 따르는 텍스트 생성 (자간·정렬 지정 가능. `font_name`은 `create_text_frame`과 마찬가지로 정확히 일치해야 함) |
| `place_symbol` | 심볼 인스턴스 배치 또는 교체 |
| `select_objects` | UUID로 객체 선택 (다중 선택 지원) |
| `create_crop_marks` | 로케일 기반 스타일 자동 감지로 재단선(크롭 마크) 생성 (일본식 더블 라인 / 서양식 싱글 라인) |
| `place_style_guide` | 비주얼 스타일 가이드를 아트보드 외부의 인쇄되지 않는 레이어에 배치 (컬러, 폰트, 간격, 여백, 가이드 간격). 아트보드 위 측정 표시는 `annotate_artboard` 지정 시에만 |
| `undo` | 실행 취소/재실행 (여러 단계) |

</details>

### 내보내기 도구 (2)

<details>
<summary>클릭하여 펼치기</summary>

| 도구 | 설명 |
|---|---|
| `export` | SVG / PNG / JPG 내보내기 (아트보드, 선택, 또는 UUID 단위. 선택·UUID 지정 시 해당 객체만 내보냄. `overwrite: true` 없이는 기존 파일을 덮어쓰지 않음) |
| `export_pdf` | 인쇄 납품용 PDF 내보내기 (재단선, 도련, 선택적 다운샘플링, 출력 인텐트) |

</details>

### 유틸리티 (4)

<details>
<summary>클릭하여 펼치기</summary>

| 도구 | 설명 |
|---|---|
| `preflight_check` | 인쇄 전 체크 (RGB 혼재, 링크 끊김, 저해상도, 흰색 오버프린트, 투명도+오버프린트 상호작용, PDF/X 준수 등). 각 검사가 완료되었는지 일부만 수행되었는지 `coverage`로 보고 |
| `check_text_consistency` | 텍스트 일관성 체크 (자리표시 감지, 표기 편차 패턴, LLM 분석용 전체 텍스트 리스팅) |
| `set_workflow` | 워크플로우 모드 설정 (web/print)으로 자동 감지된 좌표계 재정의 |
| `set_illustrator_version` | 여러 버전이 설치된 경우 사용할 Illustrator 버전 지정 |

</details>

---

## 좌표계

서버는 문서로부터 좌표계를 자동으로 감지합니다:

| 문서 유형 | 좌표계 | 원점 | Y축 |
|---|---|---|---|
| CMYK / 인쇄 | `document` | 좌하단 | 위로 |
| RGB / 웹 | `artboard-web` | 아트보드 좌상단 | 아래로 |

- **CMYK 문서**는 Illustrator의 네이티브 좌표계를 사용하며, 인쇄 디자이너의 기대와 일치합니다
- **RGB 문서**는 AI가 다루기 쉬운 웹 스타일 좌표계를 사용합니다
- 필요하면 `set_workflow`로 자동 감지된 좌표계를 재정의할 수 있습니다
- 모든 도구 응답에는 활성 좌표계를 나타내는 `coordinateSystem` 필드가 포함됩니다
- 자동 감지에 실패하면 추측하지 않고 오류를 반환합니다. `coordinate_system`을 명시하거나 `set_workflow`를 사용하세요

---

## 예시: SMPTE 테스트 패턴

1920×1080 SMPTE 컬러 바 테스트 패턴 — Claude에게 자연어로 지시하여 전부 제작되었습니다.

**프롬프트:**

> Make a 1920x1080 video test pattern

**결과:**

<img src="docs/images/example-smpte-test-pattern.png" width="720" alt="illustrator-mcp-server를 통해 Claude가 생성한 SMPTE 컬러 바 테스트 패턴" />

**아트보드 구조** (`get_document_structure`로 확인):

<details>
<summary>클릭하여 펼치기</summary>

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

> 사용된 도구: `create_document`, `manage_layers`, `create_rectangle` ×23, `create_line` ×2, `create_ellipse`, `create_text_frame` ×6, `modify_object` ×4, `save_document`, `export`

---

## 예시: Twilight Geometry

추상적인 기하학적 풍경 아트워크 — "원하는 아트를 만들어줘"라는 지시 외에 사람의 디자인 디렉션 없이 Claude가 전부 제작했습니다.

**프롬프트:**

> Make an art piece of your own imagination in Illustrator. Take your time. Create whatever you like.

**Claude의 과정:**

> "Twilight Geometry"를 만들어보겠습니다 — 기하학적인 천체 요소가 있는 추상적인 풍경. 깊이감 있는 그라디언트 황혼 하늘, 레이어드된 산 실루엣, 장식적인 링이 있는 초승달, 그리고 캔버스 전체에 흩뿌려진 별들.

> 다양한 색상의 다이아몬드 모양 별들 — 따뜻한 화이트, 차가운 블루, 라벤더 퍼플 — 각각이 미묘하게 달라 서로 다른 종류의 별을 암시합니다. 이들을 잇는 별자리 라인. 신비로운 분위기를 위해 하늘에 떠 있는 와이어프레임 삼각형과 육각형.

> 하단에는 수면이 있고 달빛이 일렁이는 물결선으로 반사되어, 아래로 내려갈수록 사라집니다.

**Claude의 소감:**

> 기대보다 더 잘 나왔습니다. 기하학과 자연이 혼재된 세계가 잘 표현되었다고 생각합니다.

**결과:**

<img src="docs/images/example-twilight-geometry.png" width="720" alt="Twilight Geometry — illustrator-mcp-server를 통해 Claude가 생성한 추상적 기하학적 풍경 아트" />

> 사용된 도구: `create_document`, `manage_layers` ×4, `create_rectangle` ×2, `create_gradient` ×2, `create_path` ×11, `create_ellipse` ×14, `create_line` ×4, `create_text_frame` ×2, `modify_object`, `set_z_order`, `export`

---

## 알려진 제약사항

| 제약사항 | 상세 |
|---|---|
| Windows 지원 | Windows는 PowerShell COM 자동화를 사용 (실제 하드웨어에서 아직 테스트되지 않음) |
| 라이브 이펙트 | 드롭 섀도우 등 이펙트 파라미터는 감지 가능하지만 읽을 수는 없음 |
| 컬러 프로파일 | 컬러 프로파일 지정만 가능 — 완전한 변환은 미지원 |
| 도련(Bleed) 설정 | 도련 설정은 읽을 수 없음 (Illustrator API 제한) |
| WebP 내보내기 | 미지원 — PNG 또는 SVG를 대신 사용 |
| 일본식 재단선 | PDF 내보내기 시 TrimMark 명령으로 문서에 재단선을 임시로 생성하고, 내보낸 후 제거. 아트보드가 하나인 문서만 지원 (아트보드가 여러 개면 오류 반환) |
| 폰트 임베딩 | 임베딩 모드(full/subset)를 직접 제어 불가 — PDF 프리셋을 사용 |
| 사이즈 바리에이션 | 비례 스케일링만 지원 — 텍스트는 이후 수동 조정이 필요할 수 있음 |
| SVG 텍스트 글리프 대체 | Illustrator는 `font-family` 목록에서 글리프 단위로 다음 폰트로 대체하지 않습니다. 첫 번째 폰트가 설치되어 있지만 해당 글리프가 없으면 `import_svg_as_editable`은 그 문자를 경고 없이 누락시키고도 성공을 반환합니다. 텍스트 요소마다 `font-family`를 하나만 지정하고, 필요한 글리프가 실제로 포함된 폰트를 선택하세요. *설치되지 않은* 폰트는 Illustrator가 대체 폰트로 바꾸므로 이 문제가 없으며, 그 경우는 `preflight_check`가 검출합니다 |
| 객체 메모 | 도구는 각 객체의 메모(속성 패널)에 저장한 UUID로 객체를 식별합니다. 직접 작성한 메모는 유지되며, 그 앞에 UUID가 추가됩니다 |

---

<br>

# 개발자용

## 아키텍처

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

## 소스에서 빌드하기

```bash
git clone https://github.com/ie3jp/illustrator-mcp-server.git
cd illustrator-mcp-server
npm install
npm run build
claude mcp add illustrator-mcp -- node /path/to/illustrator-mcp-server/dist/index.js
```

### 검증

```bash
npx @modelcontextprotocol/inspector npx illustrator-mcp-server
```

### 테스트

```bash
# 유닛 테스트
npm test

# E2E 스모크 테스트 (Illustrator 실행 필요)
npm run build   # E2E runs dist/index.js
npx tsx test/e2e/e2e-test.ts        # every tool (192 cases)
npx tsx test/e2e/e2e-behaviors.ts   # behavior & regression checks (91 cases)
npx tsx test/e2e/e2e-cmyk-only.ts
npx tsx test/e2e/svg-import-test.ts
```

E2E 스위트는 각자 전용 문서를 만들고, 열려 있는 다른 문서는 건드리지 않으며, 끝나면 저장하지 않고 닫습니다. `e2e-test.ts`는 등록된 모든 도구를 (RGB + CMYK, 좌표계 자동 감지 포함) 실행하고, `e2e-behaviors.ts`는 메모가 지워지지 않는지, 부분 실패를 보고하는지, 파일을 덮어쓰지 않는지, 재단선과 PDF 내보내기가 아트워크를 망가뜨리지 않는지 등 실제 앱에서 지켜져야 할 동작을 확인합니다.

---

## 개인정보처리방침 (Privacy Policy)

illustrator-mcp-server는 사용자의 컴퓨터에서만 동작합니다. 개인 데이터를 수집하지 않고, 텔레메트리가 없으며, 서버 자체적으로 네트워크 연결을 하지 않습니다. 도구 인수와 문서 데이터는 로컬 Illustrator와 도구를 호출한 MCP 클라이언트 사이에서만 오가며, 임시 파일은 호출이 끝날 때마다 삭제됩니다. 자세한 내용은 [개인정보처리방침](https://github.com/ie3jp/illustrator-mcp-server/blob/main/PRIVACY.md)을 참고하세요.

---

## 면책 조항

이 도구는 많은 Illustrator 작업을 자동화하지만, AI는 실수할 수 있습니다. 추출된 데이터, 프리플라이트 결과, 문서 수정은 항상 사람이 검토해야 합니다. **이 도구를 유일한 품질 점검 수단으로 의존하지 마세요.** 본인의 수동 검증과 병행하는 보조 도구로 사용하되, 특히 인쇄 납품 및 클라이언트 전달 데이터에서는 주의하세요. 저자는 본 소프트웨어 또는 그 출력 사용으로 인한 어떠한 손해나 손실에 대해서도 책임지지 않습니다.

---

## 라이선스

[MIT](LICENSE)
