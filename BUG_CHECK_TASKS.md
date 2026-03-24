# Bug Check Tasks

コードベース全体の監査で発見されたバグ・改善点の一覧。

## HIGH - ロジックエラー

### 1. modify-object.ts: RGB バリデーションの論理演算子が間違い
- **ファイル**: `src/tools/modify/modify-object.ts` 26-28行目
- **問題**: `&&` (AND) を使っているため、R/G/B のうち1つでも指定されていれば通ってしまう。`||` (OR) で全チャンネル必須にすべき。
- **現状コード**:
  ```javascript
  if (typeof colorObj.r !== "number" && typeof colorObj.g !== "number" && typeof colorObj.b !== "number") {
  ```
- **修正案**: `&&` → `||` に変更（全チャンネル揃っていない場合はNoColor扱い）

### 2. export.ts: 到達不能な条件分岐
- **ファイル**: `src/tools/export/export.ts` 166-168行目
- **問題**: `targetType !== "done"` をチェックしているが、`"done"` は一度もセットされない。デッドコード。
- **修正案**: 不要な条件を削除

### 3. find-objects.ts: 名前フィルターの検証（要確認）
- **ファイル**: `src/tools/read/find-objects.ts` 63-64行目
- **問題**: `itemName.indexOf(params.name) < 0` で `return false` しているが、これは「含まない場合にスキップ」＝「含む場合のみ返す」なので、実はこのロジック自体は正しい可能性がある。意図を確認する必要あり。
- **修正案**: 意図確認の上、必要なら修正

## MEDIUM - 潜在的な問題

### 4. export-pdf.ts: 未定義パラメータの参照
- **ファイル**: `src/tools/export/export-pdf.ts` 49-52行目
- **問題**: `options._bleed_set` は入力パラメータに定義されておらず、常に `undefined`（falsy）になる。意図不明のデッドロジック。
- **修正案**: ロジックの意図を確認し、不要なら削除

### 5. get-artboards.ts: 座標系の不整合
- **ファイル**: `src/tools/read/get-artboards.ts` 49-51行目
- **問題**: artboard-web モードでアートボード位置を `{ x: rect[0], y: -rect[1] }` としているが、他ツールとの座標系の一貫性が不明確。
- **修正案**: 全ツールでの座標系変換を統一的にレビュー

### 6. get-effects.ts: ハードコードされた500件制限
- **ファイル**: `src/tools/read/get-effects.ts` 145-150行目
- **問題**: `pageItems` の走査が500件で打ち切られる。大規模ドキュメントでエフェクトが欠落する可能性。
- **修正案**: 制限の撤廃、またはパラメータ化

### 7. jsx-runner.ts: タイムアウトエラーのハンドリング不足
- **ファイル**: `src/executor/jsx-runner.ts` 87-96行目
- **問題**: `execFile` のタイムアウト時に `stderr` が空になる場合がある。エラーメッセージが不明瞭になる可能性。
- **修正案**: タイムアウト固有のエラーメッセージを追加

### 8. list-text-frames.ts: フォント情報取得失敗が無視される
- **ファイル**: `src/tools/read/list-text-frames.ts` 89-97行目
- **問題**: `textRanges[0].characterAttributes.textFont.family` アクセス失敗時にサイレントfail。fontFamilyが空文字のまま返る。
- **修正案**: 取得失敗を示すフラグまたはnullを返す

## LOW - コード品質

### 9. create-rectangle/ellipse/line.ts: 変数名の再利用
- **ファイル**: `src/tools/modify/create-rectangle.ts`, `create-ellipse.ts`, `create-line.ts`
- **問題**: `createColor()` 関数内で変数 `c` を CMYK/RGB/Gray で再利用。ES3なので問題にはならないが可読性が低い。
- **修正案**: 各色空間で別名を使う（cosmetic）

### 10. file-transport.ts: クリーンアップ失敗が完全に無視される
- **ファイル**: `src/executor/file-transport.ts` 68-74行目
- **問題**: `cleanupTmpDirSync()` が全エラーを飲み込む。長時間運用でtempファイルが蓄積する可能性。
- **修正案**: console.warnでログ出力

## FIXED（今回修正済み）

- [x] **get-images.ts**: matrix回転バグ（`mValueA` → `sqrt(a²+b²)`）
- [x] **preflight-check.ts**: 解像度チェックが機能していなかった（ダミーwarningのみ）
- [x] **preflight-check.ts**: リンク画像のDPIチェックなし
- [x] **preflight-check.ts**: DPI閾値がハードコード（`min_dpi` パラメータ追加）
- [x] **image-header.ts**: `require()` ではなく ES module `import` を使用
