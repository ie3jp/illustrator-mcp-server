> **⚠️ 注意:** AI は間違えることがあります。出力を過信せず、**入稿データの最終確認は必ず人間が行ってください**。結果についての責任は利用者にあります。

**[English version](README.md)**

# Illustrator MCP Server

[![npm](https://img.shields.io/npm/v/illustrator-mcp-server.svg)](https://www.npmjs.com/package/illustrator-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-lightgrey.svg)]()
[![Illustrator](https://img.shields.io/badge/Illustrator-CC%202024%2B-orange.svg)](https://www.adobe.com/products/illustrator.html)
[![MCP](https://img.shields.io/badge/MCP-Compatible-purple.svg)](https://modelcontextprotocol.io/)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-FF5E5B?style=flat&logo=ko-fi&logoColor=white)](https://ko-fi.com/cyocun)

Adobe Illustrator のデザインデータを読み取り・操作・書き出しする [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) サーバー。

Claude などの AI アシスタントから Illustrator を直接操作し、Web 実装に必要なデザイン情報の取得や、印刷用データの確認・書き出しを行えます。

---

> **☕ サポート:** このツールの開発・維持には費用がかかっています。役に立ったらぜひ応援お願いします — [コーヒー奢ってください!](https://ko-fi.com/cyocun)

---

## 🚀 クイックスタート

**必要なもの:** macOS または Windows / Adobe Illustrator CC 2024+ / [Node.js 20+](https://nodejs.org/)

<details>
<summary><strong>Node.js のインストール方法（初めての方はこちら）</strong></summary>

Node.js は、このツールを動かすために必要なソフトウェアです。
すでにインストール済みの方はスキップしてください。

1. [nodejs.org](https://nodejs.org/) を開く
2. **「LTS」と書かれた緑色のボタン**をクリックしてダウンロード
3. ダウンロードしたファイルを開き、画面の指示に従ってインストール

インストールできたか確認するには、ターミナル（macOS）またはコマンドプロンプト（Windows）を開いて以下を入力します:

```bash
node -v
```

`v20.x.x` のようにバージョン番号が表示されれば OK です。

</details>

### Claude Code

```bash
claude mcp add illustrator-mcp -- npx illustrator-mcp-server
```

### Claude Desktop

1. [GitHub Releases](https://github.com/ie3jp/illustrator-mcp-server/releases/latest) から **`illustrator-mcp-server-x.x.x.mcpb`** をダウンロード
2. Claude Desktop を開き、**設定** → **拡張機能** を開く
3. ダウンロードした `.mcpb` ファイルを拡張機能パネルにドラッグ＆ドロップ
4. **インストール** ボタンをクリック

> **更新について:** `.mcpb` 拡張機能は自動更新されません。更新するには新しいバージョンをダウンロードして再インストールしてください。自動更新が必要な場合は、下記の npx 方式をお使いください。

<details>
<summary><strong>別の方法: 手動設定（npx 経由で常に最新版）</strong></summary>

設定ファイルを開いて、接続情報を書き込みます。

#### 1. 設定ファイルを開く

Claude Desktop のメニューバーから:

**Claude** → **設定** → 左サイドバーの **開発者** → **設定を編集** ボタンをクリック

#### 2. 設定を書き込む

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

> **注意:** nvm / mise / fnm 等のバージョンマネージャで Node.js をインストールした場合、Claude Desktop が `npx` を見つけられないことがあります。その場合はフルパスを指定してください:
> ```json
> "command": "/フルパス/npx"
> ```
> ターミナルで `which npx` を実行するとパスを確認できます。

#### 3. 保存して再起動

1. ファイルを保存（⌘S）してテキストエディタを閉じる
2. Claude Desktop を **完全に終了**（⌘Q）して再度開く

</details>


> **macOS:** 初回実行時にオートメーション権限ダイアログが表示されます。システム設定 > プライバシーとセキュリティ > オートメーション で許可してください。

> **Note:** 操作系・書き出し系ツールの実行時、Illustrator がフォアグラウンドに切り替わります。

---

## 🎬 こんなことができます

```
あなた: このドキュメントのテキスト情報を全部教えて
Claude:  → list_text_frames → get_text_frame_detail
         ドキュメント内に 12 個のテキストフレームがあります。
         見出し「My Design」はフォント Noto Sans JP Bold 48px、色 #333333 ...
```

```
あなた: 印刷入稿前のチェックをして
Claude:  → preflight_check
         ⚠ 2件の警告:
         - 低解像度画像: image_01.jpg (150dpi) — 300dpi 以上を推奨
         - 非アウトラインフォント: 3 個のテキストフレーム
```

```
あなた: テキストの表記揺れをチェックして
Claude:  → check_text_consistency
         📝 表記揺れレポート:
         ⚠ "お問い合わせ" (2箇所) vs "お問合せ" (1箇所)
         ⚠ "〜" vs "～" — 波ダッシュ vs 全角チルダ
         ❌ "テキストが入ります" (2箇所) — ダミーテキスト残存
```

```
あなた: この A4 チラシからバナーサイズ展開を作って
Claude:  → get_document_info → resize_for_variation
         3 サイズのバリエーションを作成しました:
         - 728×90 / 300×250 / 160×600
```

---

## 📖 使い方レシピ集

### Web 実装

<details>
<summary><b>デザインカンプから CSS 用の色・フォント情報を抜き出したい</b></summary>

```
あなた: このデザインの色とフォント情報をまとめて

Claude:  → get_colors → list_text_frames → get_text_frame_detail

         ■ カラーパレット
         - Primary: #1A73E8 (CMYK: 85,50,0,0)
         - Secondary: #34A853
         - Text: #202124
         - Background: #FFFFFF

         ■ フォント
         - 見出し: Noto Sans JP Bold / 32px
         - 本文: Noto Sans JP Regular / 16px / line-height: 1.75
         - キャプション: Noto Sans JP Medium / 12px
```

</details>

<details>
<summary><b>アートボードごとに SVG / PNG を書き出したい</b></summary>

```
あなた: 全アートボードを SVG で書き出して。テキストはアウトライン化して

Claude:  → get_artboards → convert_to_outlines → export (繰り返し)

         4 アートボードを書き出しました:
         - /output/header.svg (アートボード "header")
         - /output/hero.svg (アートボード "hero")
         - /output/feature.svg (アートボード "feature")
         - /output/footer.svg (アートボード "footer")
```

</details>

<details>
<summary><b>特定のオブジェクトのスタイル情報を知りたい</b></summary>

```
あなた: 「CTA ボタン」という名前のオブジェクトの情報を教えて

Claude:  → find_objects (name: "CTA ボタン") → get_path_items → get_effects

         ■ CTA ボタン (uuid: abc-123)
         - サイズ: 200×48px
         - 角丸: 24px
         - 塗り: #1A73E8
         - 線: なし
         - 不透明度: 100%
         - ドロップシャドウ: あり（パラメータは API 制限のため取得不可）
```

</details>

### 印刷・入稿

<details>
<summary><b>入稿データを PDF/X-1a 準拠でチェックしたい</b></summary>

```
あなた: PDF/X-1a で入稿したい。問題ないかチェックして

Claude:  → preflight_check (target_pdf_profile: "x1a")

         ❌ PDF/X-1a 準拠エラー:
         - 透明効果が 3 オブジェクトに存在（X-1a は透明禁止）
         - RGB カラーが 2 箇所に残存（X-1a は CMYK/特色のみ）

         ⚠ 警告:
         - 非アウトラインフォント 5 個（埋め込み推奨）
         - 画像 "photo_02.jpg" が 150dpi（300dpi 以上推奨）

         → 透明を分割統合し、RGB をCMYK に変換してから再チェックしてください。
```

</details>

<details>
<summary><b>オーバープリントの設定を確認して事故を防ぎたい</b></summary>

```
あなた: オーバープリントの状態を確認して

Claude:  → get_overprint_info

         ■ オーバープリント検出: 4 オブジェクト

         ✅ 安全 (K100 オーバープリント — 意図的):
         - テキスト枠 "見出し" (K100, インク総量 100%)
         - パス "罫線" (K100, インク総量 100%)

         ⚠ 要確認 (事故の可能性):
         - パス "背景装飾" (C30 M80 Y0 K0, インク総量 110%)
           → カラーオブジェクトのオーバープリントは意図的ですか？
         - パス "リッチブラック枠" (C40 M40 Y40 K100, インク総量 320%)
           → リッチブラック + オーバープリントは予期しない色被りの原因になります
```

</details>

<details>
<summary><b>色分解（版情報）を確認したい</b></summary>

```
あなた: このドキュメントの色分解情報を教えて

Claude:  → get_separation_info

         ■ 色分解情報 (CMYK ドキュメント)
         - Cyan: 使用箇所 342
         - Magenta: 使用箇所 287
         - Yellow: 使用箇所 301
         - Black: 使用箇所 456
         - DIC 2585 (スポットカラー): 使用箇所 12
           → 5 版での出力になります。スポットカラーが意図的か確認してください。
```

</details>

<details>
<summary><b>印刷用 PDF をトンボ付きで書き出したい</b></summary>

```
あなた: 日本式トンボ付き、裁ち落とし3mm で PDF 書き出して

Claude:  → export_pdf (trim_marks: true, marks_style: "japanese", bleed: true)

         /output/print_ready.pdf に書き出しました。
         - 日本式トンボ (0.125pt)
         - 裁ち落とし 3mm
         - レジストレーションマーク自動付与
```

</details>

<details>
<summary><b>画像の色空間やスケール率を確認して品質を担保したい</b></summary>

```
あなた: 配置画像の印刷品質をチェックして

Claude:  → get_images (include_print_info: true)

         ■ 画像品質レポート:
         ✅ hero.psd — CMYK, 350dpi, スケール 98%
         ⚠ icon_set.png — RGB (CMYK ドキュメントと不一致), 300dpi, スケール 100%
         ❌ photo_bg.jpg — CMYK, 72dpi, スケール 400% (大幅拡大)
           → 原寸 300dpi 以上の画像に差し替えてください
```

</details>

### テキスト校正

<details>
<summary><b>テキストの表記揺れやダミーテキストの消し忘れを見つけたい</b></summary>

```
あなた: テキストの表記揺れをチェックして

Claude:  → check_text_consistency

         📝 表記揺れレポート:

         ■ 表記揺れ（同じ意味で異なる表記）
         ⚠ "お問い合わせ" (2箇所) vs "お問合せ" (1箇所)
         ⚠ "ウェブサイト" (1箇所) vs "Webサイト" (3箇所) vs "WEBサイト" (1箇所)
         ⚠ "〜" (2箇所) vs "～" (1箇所)  ← 波ダッシュ vs 全角チルダ
         ⚠ "サーバー" (3箇所) vs "サーバ" (1箇所)

         ■ 差し替え漏れの可能性
         ❌ ヘッダーに "2024年度" が残っています（他は全て "2025年度"）
         ❌ フッターの電話番号が "03-XXXX-1234"（他のページは "03-XXXX-5678"）

         ■ ダミーテキストの残存
         ❌ "テキストが入ります" (2箇所) — 仮テキストの消し忘れ？
         ❌ "Lorem ipsum" (1箇所)
```

</details>

### デザイン展開

<details>
<summary><b>チラシやバナーのサイズ違い展開を一括で作りたい</b></summary>

```
あなた: この A4 チラシから Web バナー 3 サイズ作って

Claude:  → get_document_info → resize_for_variation (3 targets)

         3 つのバリエーションを作成しました:
         - アートボード "Leaderboard" (728×90pt, 縮小率 11%)
         - アートボード "Medium Rectangle" (300×250pt, 縮小率 30%)
         - アートボード "Wide Skyscraper" (160×600pt, 縮小率 71%)

         ⚠ テキストのリフローは行っていません。
           はみ出しや文字サイズの調整が必要な場合があります。
```

</details>

<details>
<summary><b>レイアウト用の図形やテキストをまとめて配置したい</b></summary>

```
あなた: 名刺のレイアウトを作って。社名、名前、メールアドレス、電話番号

Claude:  → create_document (91×55mm, CMYK)
         → create_text_frame × 4
         → create_rectangle (背景)
         → create_line (区切り線)

         名刺レイアウトを作成しました:
         - 社名: 上部中央 / Noto Sans JP Bold 9pt
         - 氏名: 中央 / Noto Sans JP Bold 14pt
         - メール: 下部 / Noto Sans JP Regular 7pt
         - 電話: 下部 / Noto Sans JP Regular 7pt
```

</details>

### オブジェクト操作

<details>
<summary><b>複数オブジェクトを整列・等間隔分布したい</b></summary>

```
あなた: ボタン3つを左揃えにして、縦に等間隔で並べて

Claude:  → find_objects → align_objects (alignment: "left", distribute: "vertical")

         3 オブジェクトを左揃え + 縦等間隔分布しました。
```

</details>

<details>
<summary><b>ブランドカラーを一括で差し替えたい</b></summary>

```
あなた: 赤 (C0 M100 Y100 K0) を全部、新しいブランドカラー (C80 M10 Y0 K0) に変えて

Claude:  → replace_color (from: cmyk 0,100,100,0 → to: cmyk 80,10,0,0)

         塗り 24 箇所 / 線 3 箇所を置換しました。
```

</details>

<details>
<summary><b>使用カラーの一覧をカラーチップとして配置したい</b></summary>

```
あなた: 使ってる色をアートボードの右にカラーチップとして並べて

Claude:  → place_color_chips (position: "right")

         12 色のカラーチップを "Color Chips" レイヤーに配置しました。
         各チップに CMYK 値のラベル付き。
```

</details>

### カラー管理

<details>
<summary><b>CMYK ドキュメントに RGB が混在していないか調べたい</b></summary>

```
あなた: カラーの問題を診断して

Claude:  → get_colors (include_diagnostics: true)

         ■ カラー診断 (CMYK ドキュメント)
         ❌ RGB カラー混在: 塗り 3 箇所 / 線 1 箇所
         ⚠ グラデーション警告:
           - "Rainbow gradient": ストップ #2 が RGB
         ■ インク総量が高い色:
           - C80 M70 Y70 K90 (総量 310%) — 紙面によってはインク過多
```

</details>

### アクセシビリティ

<details>
<summary><b>テキストと背景のコントラスト比を WCAG 基準でチェックしたい</b></summary>

```
あなた: テキストのコントラスト比をチェックして

Claude:  → check_contrast (auto_detect: true)

         ■ WCAG コントラスト比レポート:
         ❌ "注釈テキスト" on "薄いグレー背景" — 2.8:1 (AA 不適合)
         ⚠ "サブ見出し" on "白背景" — 4.2:1 (AA Large OK, AA Normal NG)
         ✅ "本文テキスト" on "白背景" — 12.1:1 (AAA 適合)
```

</details>

### デザインシステム連携

<details>
<summary><b>デザインカンプからデザイントークンを抽出したい</b></summary>

```
あなた: CSS カスタムプロパティとしてデザイントークンを抽出して

Claude:  → extract_design_tokens (format: "css")

         :root {
           --color-primary: #1A73E8;
           --color-secondary: #34A853;
           --color-tertiary: #FBBC04;

           --font-heading-family: "NotoSansJP-Bold";
           --font-heading-size: 32pt;
           --font-body-family: "NotoSansJP-Regular";
           --font-body-size: 16pt;

           --spacing-8: 8pt;
           --spacing-16: 16pt;
           --spacing-24: 24pt;
         }
```

</details>

---

<br>

# 開発者向け情報

## MCP Prompts

ワークフロー全体を Claude に指示するプロンプトテンプレート。Claude Desktop のプロンプト一覧から選択できます。

| Prompt | 概要 |
|--------|------|
| `quick-layout` | テキスト原稿を渡すと、見出し・本文・キャプションを推測してアートボード上にざっくり配置 |
| `print-preflight-workflow` | 印刷入稿前の7ステップ包括チェック（ドキュメント情報→プリフライト→オーバープリント→色分解→画像→カラー→テキスト） |

---

## Claude Code Skills

MCP ツールを組み合わせたワークフローを、スラッシュコマンドとして Claude Code に追加できます。

### 入稿前プリフライトチェック (`/illustrator-preflight`)

`preflight_check` + `get_overprint_info` + `check_text_consistency` を並列実行し、結果を重要度別（Critical / Warning / Info）に統合レポートします。印刷事故につながる問題を見落としなくチェックできます。

**インストール:**

```bash
/plugin install illustrator-preflight
```

**使い方:**

Claude Code で `/illustrator-preflight:illustrator-preflight` と入力するか、「入稿前チェックして」と依頼してください。

---

## 特徴

- **63 ツール + 2 Prompts** — 読み取り 21 / 操作 37 / 書き出し 2 / ユーティリティ 3
- **Web 座標系** — デフォルトでアートボード相対・Y 軸下向き正（CSS/SVG と同じ座標系）
- **UUID トラッキング** — 全オブジェクトを `pageItem.note` の UUID で一意に識別

---

## ツール一覧

### 読み取り系 (21)

<details>
<summary>クリックして展開</summary>

| ツール | 概要 |
|---|---|
| `get_document_info` | ドキュメントのメタデータ（サイズ、カラーモード、プロファイル等） |
| `get_artboards` | アートボード情報（位置、サイズ、向き） |
| `get_layers` | レイヤー構造のツリー取得 |
| `get_document_structure` | レイヤー→グループ→オブジェクトのツリー一括取得 |
| `list_text_frames` | テキストフレーム一覧（フォント、サイズ、スタイル名） |
| `get_text_frame_detail` | 特定テキストの全属性（カーニング、段落設定等） |
| `get_colors` | 使用カラー情報（スウォッチ、グラデーション、スポットカラー等）。`include_diagnostics` で印刷診断 |
| `get_path_items` | パス・シェイプデータ（塗り、線、アンカーポイント） |
| `get_groups` | グループ・クリッピングマスク・複合パスの構造 |
| `get_effects` | エフェクト・アピアランス情報（不透明度、描画モード） |
| `get_images` | 埋め込み/リンク画像の情報（解像度、リンク切れ検出）。`include_print_info` で色空間ミスマッチ・スケール率 |
| `get_symbols` | シンボル定義とインスタンス |
| `get_guidelines` | ガイドライン情報 |
| `get_overprint_info` | オーバープリント設定 + K100/リッチブラック検出・意図判定 |
| `get_separation_info` | 色分解情報（CMYK プロセス版 + スポットカラー版の使用数） |
| `get_selection` | 選択中オブジェクトの詳細 |
| `find_objects` | 条件検索（名前、タイプ、色、フォント等） |
| `check_contrast` | WCAG カラーコントラスト比チェック（手動 or 自動検出） |
| `extract_design_tokens` | デザイントークン抽出（CSS / JSON / Tailwind 形式） |
| `list_fonts` | Illustrator で利用可能なフォント一覧（ドキュメント不要） |
| `convert_coordinate` | アートボード座標系⇔ドキュメント座標系の変換 |

</details>

### 操作系 (37)

<details>
<summary>クリックして展開</summary>

| ツール | 概要 |
|---|---|
| `create_rectangle` | 長方形の作成（角丸対応） |
| `create_ellipse` | 楕円の作成 |
| `create_line` | 直線の作成 |
| `create_text_frame` | テキストフレームの作成（ポイント/エリア） |
| `create_path` | 任意パスの作成（ベジェハンドル対応） |
| `place_image` | 画像ファイルの配置（リンク/埋め込み） |
| `modify_object` | 既存オブジェクトのプロパティ変更 |
| `convert_to_outlines` | テキストのアウトライン化 |
| `assign_color_profile` | カラープロファイルの割り当て（色値の変換は行わない） |
| `create_document` | 新規ドキュメントの作成（サイズ、カラーモード指定） |
| `close_document` | アクティブドキュメントを閉じる |
| `resize_for_variation` | サイズ展開（ソースアートボードから複数サイズを一括生成） |
| `align_objects` | 複数オブジェクトの整列・等間隔分布 |
| `replace_color` | 色の一括検索・置換（許容誤差指定可） |
| `manage_layers` | レイヤーの追加/リネーム/表示/ロック/順序変更/削除 |
| `place_color_chips` | 使用カラーをアートボード外にカラーチップとして配置 |
| `save_document` | ドキュメントの上書き保存・別名保存 |
| `open_document` | ファイルパスからドキュメントを開く |
| `group_objects` | オブジェクトのグループ化（クリッピングマスク対応） |
| `ungroup_objects` | グループの解除 |
| `duplicate_objects` | オブジェクトの複製（オフセット指定可） |
| `set_z_order` | 重なり順の変更（最前面/前面/背面/最背面） |
| `move_to_layer` | オブジェクトを別レイヤーに移動 |
| `manage_artboards` | アートボードの追加・削除・リサイズ・リネーム・整列 |
| `manage_swatches` | スウォッチの追加・更新・削除 |
| `manage_linked_images` | リンク画像の差し替え・埋め込み |
| `manage_datasets` | 変数/データセットの一覧・適用・作成・インポート/エクスポート |
| `apply_graphic_style` | グラフィックスタイルの適用 |
| `list_graphic_styles` | グラフィックスタイル一覧の取得 |
| `apply_text_style` | 文字/段落スタイルの適用 |
| `list_text_styles` | 文字/段落スタイル一覧の取得 |
| `create_gradient` | グラデーションの作成・オブジェクトへの適用 |
| `create_path_text` | パスに沿ったテキストの作成 |
| `place_symbol` | シンボルインスタンスの配置・差し替え |
| `select_objects` | UUID指定でオブジェクトを選択（複数選択対応） |
| `place_style_guide` | アートボード外にビジュアルスタイルガイドを配置（カラー・フォント・スペーシング・マージン・ガイド間隔） |
| `undo` | 操作の取り消し/やり直し（複数ステップ対応） |

</details>

### 書き出し系 (2)

| ツール | 概要 |
|---|---|
| `export` | SVG / PNG / JPG 書き出し（アートボード、選択範囲、UUID 指定） |
| `export_pdf` | 印刷用 PDF 書き出し（トンボ、裁ち落とし、選択的ダウンサンプリング、出力インテント） |

### ユーティリティ (3)

| ツール | 概要 |
|---|---|
| `preflight_check` | 入稿前チェック（RGB 混在、リンク切れ、低解像度、白オーバープリント、透明+オーバープリント相互作用、PDF/X 適合等） |
| `check_text_consistency` | テキスト整合性チェック（ダミーテキスト検出、表記揺れパターン検出、全テキスト一覧） |
| `set_workflow` | ワークフロー設定（Web/Print モード切り替え、座標系デフォルト設定） |

---

## アーキテクチャ

```mermaid
flowchart LR
    Claude <-->|MCP Protocol| Server["MCP Server\n(TypeScript/Node.js)"]
    Server <-->|"execFile (macOS)"| osascript
    Server <-->|"execFile (Windows)"| PS["powershell.exe\n(COM Automation)"]
    osascript <-->|do javascript| AI["Adobe Illustrator\n(ExtendScript/JSX)"]
    PS <-->|DoJavaScript| AI

    Server -.->|write| PF["params-{uuid}.json"]
    PF -.->|read| AI
    AI -.->|write| RF["result-{uuid}.json"]
    RF -.->|read| Server
    Server -.->|generate| JSX["script-{uuid}.jsx\n(BOM UTF-8)"]
    Server -.->|generate| Runner["run-{uuid}.scpt / .ps1"]
```

### 座標系

座標を扱う read / modify ツールでは `coordinate_system` パラメータを受け付けます。export やドキュメント全体に対する utility ツールは、座標変換に依存しないため受け付けません。

| 値 | 原点 | Y 軸 | 用途 |
|---|---|---|---|
| `artboard-web`（デフォルト） | アートボード左上 | 下向き正 | Web/CSS 実装 |
| `document` | ペーストボード | 上向き正（Illustrator ネイティブ） | 印刷・DTP |

---

## ソースからビルド

```bash
git clone https://github.com/ie3jp/illustrator-mcp-server.git
cd illustrator-mcp-server
npm install
npm run build
claude mcp add illustrator-mcp -- node /path/to/illustrator-mcp-server/dist/index.js
```

### 動作確認

```bash
npx @modelcontextprotocol/inspector npx illustrator-mcp-server
```

### テスト

```bash
# ユニットテスト
npm test

# E2E スモークテスト（Illustrator 起動状態で実行）
npx tsx test/e2e/smoke-test.ts
```

E2E テストは新規ドキュメントを作成し、テストオブジェクトを配置して全 106 ケース（登録済み全ツールカバー）を 6 フェーズで自動実行します。

---

## 既知の制約

| 制約 | 詳細 |
|---|---|
| macOS / Windows | macOS は osascript、Windows は PowerShell COM を使用（Windows は実機未検証） |
| ライブエフェクト | ExtendScript DOM の制約により、ドロップシャドウ等のパラメータ取得不可 |
| カラープロファイル変換 | プロファイル割り当てのみ。完全な ICC 変換は非対応 |
| 裁ち落とし設定 | ExtendScript API で非公開のため取得不可 |
| WebP 書き出し | ExtendScript の ExportType に存在しないため非対応 |
| 日本式トンボ | `PageMarksTypes.Japanese` が PDF 書き出しで反映されない場合あり |
| フォント埋め込み制御 | PDF 書き出し時のフォント埋め込み方式 (full/subset) は API 非公開。PDF プリセットで設定 |
| サイズ展開 | テキストリフロー非対応。比例配置のみ（スマートレイアウトではない） |

---

## ライセンス

[MIT](LICENSE)
