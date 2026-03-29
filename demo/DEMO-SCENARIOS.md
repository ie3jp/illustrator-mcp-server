# Illustrator MCP Server — デモシナリオ

## 1. デザインQAワークフロー（印刷入稿チェック）

**ストーリー**: 入稿前チェックをAIが秒でやる

### フロー

```
User: "Check this file for print readiness"
→ open_document("入稿用.ai")
→ preflight_check()              # 問題点が一覧で返る
→ "Fix the RGB colors to CMYK"
→ replace_color(RGB→CMYK一括修正)
→ get_separation_info()          # 版確認
```

### 使用ツール

| ステップ | ツール | 役割 |
|----------|--------|------|
| 1 | `open_document` | 入稿用aiファイルを開く |
| 2 | `preflight_check` | 問題点を一覧検出 |
| 3 | `replace_color` | RGB→CMYK一括修正 |
| 4 | `get_separation_info` | 版構成の確認 |

---

## 2. デザイントークン抽出 → コード連携

**ストーリー**: デザイナーのaiファイルからエンジニアが直接トークンを取れる

### フロー

```
User: "Extract design tokens from this file"
→ open_document("design.ai")
→ extract_design_tokens()        # CSS変数やTailwind形式で出力
```

### 使用ツール

| ステップ | ツール | 役割 |
|----------|--------|------|
| 1 | `open_document` | デザインファイルを開く |
| 2 | `extract_design_tokens` | カラー・フォント・スペーシングをCSS/Tailwind形式で抽出 |

---

## 3. データドリブンバリエーション生成

**ストーリー**: 100パターンのバナーを1コマンドで

### フロー

```
User: "Create a banner template and generate variations from CSV"
→ create_document(1200x628)
→ レイヤー構成（Background / Decoration / Text）
→ 背景・装飾・テキストフレームを配置（CSVヘッダーと同名）
→ manage_datasets(import_csv, "events.csv")
→ 3アートボードが自動生成、全バリエーションが横に並ぶ
```

### 使用ツール

| ステップ | ツール | 役割 |
|----------|--------|------|
| 1 | `create_document` | 新規ドキュメント作成（1200×628 バナーサイズ） |
| 2 | `manage_layers` | Background / Decoration / Text レイヤー構成 |
| 3 | `create_rectangle` | 背景・アクセントバー |
| 4 | `create_ellipse` | 装飾の円 |
| 5 | `create_line` | ディバイダーライン |
| 6 | `create_text_frame` ×5 | EventTitle, Subtitle, Date, Venue, CTA |
| 7 | `manage_datasets(import_csv)` | CSVから全バリエーションをアートボード複製で一括生成 |

### import_csv の動作

- CSVヘッダーとテキストフレーム名を自動マッチング
- 各行ごとにアートボードを複製（データセット切り替えではなく物理コピー）
- グリッドレイアウト（最大4列で折り返し）
- オブジェクトのはみ出し量から間隔を自動計算（重なり防止）
- 各アートボードのテキスト内容を検証して返す

### デモ用データ（demo/events.csv）

```csv
EventTitle,Subtitle,Date,Venue,CTA
Tech Conference 2026,The Future of AI & Design,April 15 2026,Tokyo International Forum,Register Now — Free Admission
Design Summit Tokyo,Where Creativity Meets Technology,June 8–9 2026,Shibuya Hikarie Hall,Early Bird Tickets Available
Startup Pitch Night,10 Startups. 5 Minutes Each.,September 20 2026,Roppongi Hills Arena,Apply to Pitch — Deadline Aug 31
```
