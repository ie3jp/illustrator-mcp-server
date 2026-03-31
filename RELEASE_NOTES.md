## What's New / 新機能

- **Auto-generated export paths** — When `output_path` is omitted in `export`, `export_pdf`, or `save_document` (save_as), the file is saved to the document's directory (or ~/Desktop for unsaved documents) with collision-safe numbering.
- **書き出しパス自動生成** — `export`、`export_pdf`、`save_document`(save_as)で`output_path`を省略すると、ドキュメントと同じディレクトリ（未保存時は~/Desktop）に連番付きで自動保存。

## Bug Fixes / バグ修正

- Fixed SVG export verification failure when Illustrator appends artboard name to filename.
- Fixed non-ASCII filenames triggering a warning dialog during SVG export (auto-fallback to ASCII name).
- SVG書き出し時、Illustratorがアートボード名をファイル名に付加する挙動で検証が失敗する問題を修正。
- SVG書き出し時、非ASCIIファイル名で警告ダイアログが表示される問題を修正（ASCIIに自動フォールバック）。

## Tests / テスト

- E2E smoke test stabilized with retry logic (111 test cases, 63 tools fully covered).
- Added tests for default path generation and previously untested tools (`select_objects`, `place_style_guide`).
- E2Eスモークテストをリトライ機構で安定化（111ケース、全63ツールをカバー）。
- デフォルトパス生成および未テストツール（`select_objects`、`place_style_guide`）のテストを追加。
