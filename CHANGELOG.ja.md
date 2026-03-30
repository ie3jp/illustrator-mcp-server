# 変更履歴

## [1.2.8] - 2026-03-30

### 追加
- **Claude Desktop 用 .mcpb バンドル** — 拡張機能パネルにドラッグ＆ドロップでインストール可能。Claude Desktop の内蔵 Node.js 互換の CJS バンドル
- **リリース自動化パイプライン** — タグ push で CI が .mcpb ビルド → GitHub Release → MCP レジストリ公開を自動実行
- **manifest.json v0.3** — 全62ツールの列挙、プラットフォーム/ランタイム互換性宣言、macOS 限定宣言

### 変更
- README 更新: Claude Desktop のインストール手順を .mcpb ドラッグ＆ドロップに簡素化（手動設定は折りたたみセクションに移動）

## [1.2.6] - 2026-03-30

### 追加
- **place_style_guide** ツール — カラーチップ・フォントサンプル・スペーシングアノテーション（アートボード上に色分けバー配置）・マージン・ガイド間隔をアートボード外にビジュアルスタイルガイドとして配置。同じ値のスペーシングはグループ化・色分けでクリック時に一括ハイライト可能
- **select_objects** ツール — UUID指定でオブジェクトを選択（複数選択対応）
- **extract_design_tokens: `output_path` パラメータ** — トークンを直接ファイルに保存（CSS/JSON/Tailwind）
- **manage_datasets: `import_csv` アートボード複製方式** — CSVインポートでデータセット切り替えではなく物理的にアートボードを複製

### 修正
- **extract_design_tokens** — "Style Guide"/"Color Chips" レイヤーをスキップし、アノテーションがトークン抽出を汚染しないように改善
- **extract_design_tokens** — `output_path` のファイル書き込みエラー時に構造化エラーメッセージを返すように修正
- **全modifyツール** — 操作後の状態検証（`verified` フィールド）を全modifyツールに追加
- **place_style_guide** — ES3互換のため関数宣言をトップレベルスコープに移動
- **select_objects** — 正しい `WRITE_IDEMPOTENT_ANNOTATIONS` アノテーションに修正（選択は冪等操作）

### 変更
- ツール数: 63ツール + 2 Prompts（読み取り21 / 操作37 / 書き出し2 / ユーティリティ3）

## [1.2.5] - 2026-03-30

### 追加
- **新規ツール19種**（Phase 6）— manage_datasets, create_gradient, apply_graphic_style, list_graphic_styles, convert_to_outlines, assign_color_profile, get_separation_info, get_overprint_info, check_text_consistency, list_text_styles, apply_text_style, get_guidelines, create_path_text, place_color_chips, set_z_order, resize_for_variation, extract_design_tokens, get_effects, convert_coordinate
- **LLM手動E2Eテスト** — ツール制約のLLM理解度を検証する9テストケース（クリッピングマスク順序、グラデーション+マスク、embed後UUID変更、クロスカラースペース制限、アートボード削除、テキスト改行、スタック順、エクスポート副作用、GrayColor解釈）

### 修正
- **ツールdescription改善** — LLMが制約・副作用を正しく理解できるよう強化: group_objects（UUID順序=スタック順）、export（PNG/JPGエクスポート時の選択状態変更）、manage_linked_images（embed後UUID無効化）、replace_color（SpotColor/GrayColor非対応・クロスカラースペース制限）、check_contrast/preflight_check（GrayColorインク量解釈）、find_objects（tolerance詳細）、get_path_items（opacity注記）、get_text_frame_detail（leading API制限）、manage_artboards（最後のアートボード削除不可）
- **create_text_frame** — MCPパラメータ経由のリテラル `\\n` を改行に正しく変換
- **group_objects** — PLACEATENDのスタック方向に関する内部コメントを修正
- **coerceBoolean** ヘルパー導入 — booleanパラメータの堅牢なハンドリング

### 変更
- E2Eテストスイートを106ケース（6フェーズ、全登録ツールカバー）に拡充
- READMEを61ツール+3ユーティリティに更新

## [1.2.4] - 2025-03-25

### 追加
- **create_document** ツール — 新規Illustratorドキュメント作成（サイズ、カラーモード指定）
- **close_document** ツール — アクティブドキュメントを閉じる（保存オプション付き）
- **place_image** ツール — 画像ファイルをリンクまたは埋め込みで配置（embed後のUUIDトラッキング対応）
- 画像解像度E2Eテスト — リンク/埋め込み画像の検証、プリフライト低解像度検出

### 変更
- E2Eテストスイートを完全自動化 — ドキュメント新規作成、テストオブジェクト配置（図形・テキスト・画像）、5フェーズ45テスト実行、クリーンアップまで自動。事前ファイル不要。

## [1.2.3] - 2025-03-24

### 追加
- UUID指定ラスターエクスポート（一時ドキュメント経由、PNG/JPG）
- エクスポート後の出力ファイル検証

### 修正
- SVG UUIDエクスポートを選択ベース方式に変更（非対応の分離エクスポートから移行）

## [1.2.2] - 2025-03-24

### 修正
- トランスポートの遅延初期化（Linux CIでの即時throwを回避）

## [1.2.1] - 2025-03-24

### 修正
- dist/から古いcep-transportアーティファクトを削除

## [1.2.0] - 2025-03-23

### 変更
- CEP（Common Extensibility Platform）トランスポートを廃止 — osascript/PowerShellのみ
- Windows PowerShell COMトランスポートの基盤実装（実機未テスト）

### 修正
- コードベース監査で発見された複数のバグ（export.ts到達不能コード、export-pdf.ts未定義パラメータ、get-effects.tsハードコードされたlimit、jsx-runner.tsタイムアウトメッセージ、list-text-frames.ts null処理、file-transport.tsクリーンアップログ）
- ユニットテスト・E2Eテスト改善

## [1.1.1] - 2025-03-22

### 追加
- WebP/PSD/HEIC画像ヘッダーパース対応
- フォント解決の改善 — 部分一致検索、失敗時に候補表示

### 修正
- 埋め込み画像の解像度計算をマトリクスベクトル大きさ方式に変更（回転対応）
- create-text-frame: フォント未検出でもフレーム作成を継続（候補付き警告）
- CIプラットフォーム互換性（Linux向けnpm ci --force）

## [1.1.0] - 2025-03-21

### 追加
- プリフライトチェックで画像の実DPI解像度検証
- リンク画像のDPIをNode.js側ファイルヘッダー読み取りで算出
- SECURITY.mdとDependabot設定
- executorおよびmodifyツールのユニットテスト

### 修正
- グレースフルシャットダウン処理
- modify/exportツール実行時にIllustratorをアクティベート
- エントリポイントのshebang修正
- コードベース監査による複数バグ修正

## [1.0.0] - 2025-03-20

### 追加
- 初回リリース
- 26ツール: 読み取り15 / 編集8 / エクスポート2 / ユーティリティ1
- macOS osascriptトランスポート
- Web座標系（アートボード相対、Y軸下向き正）
- 全オブジェクトのUUIDトラッキング
- ファイルベースJSX通信（JSONパラメータ/結果）
- BOM UTF-8 JSX生成（日本語テキスト対応）
