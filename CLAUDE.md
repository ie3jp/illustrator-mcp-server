# CLAUDE.md

## Project Overview

Illustrator MCP Server — Adobe IllustratorをMCP (Model Context Protocol) 経由で操作するサーバー。
ExtendScript (ES3) をJSXとして実行し、AppleScript/PowerShell COM経由でIllustratorに送信する。

## Architecture

- `src/jsx/helpers/common.jsx` — 全ツール共通のヘルパー関数（JSON polyfill, ファイルI/O, UUID, 座標変換, 検証）
- `src/tools/` — 各ツール実装（read/, modify/, export/, utility/）
- `src/executor/jsx-runner.ts` — JSX実行エンジン（IIFE + helpersで包んでIllustratorに送信）
- JSXコードはTypeScriptのテンプレートリテラル内に書かれる

## Conventions

### Post-Operation Verification (必須)

全ツールは操作後に状態を読み返して結果に含めること。「やったつもり」で返さない。

- 単一オブジェクト操作: `verifyItem(item, coordSystem, abRect)` で状態スナップショットを返す
- アートボード操作: `verifyArtboardContents(artboardIndex)` で名前付きアイテム一覧を返す
- 結果の `verified` フィールドに格納する

```jsx
// 例: 作成ツール
var uuid = ensureUUID(rect);
writeResultFile(RESULT_PATH, { uuid: uuid, verified: verifyItem(rect, coordSystem, abRect) });

// 例: バッチ操作
results.push({ sourceUuid: uuids[i], newUuid: uuid, verified: verifyItem(dup) });
```

### ExtendScript Template Literal Pitfalls

JSXコードはTypeScriptテンプレートリテラル（バッククォート）内に書かれるため:
- 正規表現の `\r`, `\n`, `\s`, `\t` 等は `\\r`, `\\n`, `\\s`, `\\t` にエスケープ必須
- `function` 宣言はブロック（if/else）内ではなく、トップレベルに配置する
- `${}` はテンプレートリテラル補間として解釈されるため、JSX内で使わない
