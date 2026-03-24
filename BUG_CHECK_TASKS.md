# Bug Check Tasks

コードベース全体の監査で発見されたバグ・改善点の一覧。

## NOT A BUG（再確認の結果、問題なし）

### 1. modify-object.ts: RGB バリデーションの論理演算子
- **ファイル**: `src/tools/modify/modify-object.ts` 26-28行目
- **結論**: `&&` (AND) で正しい。「R,G,B がすべて未指定の場合のみNoColor」という意図的な設計。部分指定時は未指定チャンネルを0にデフォルトする。

### 3. find-objects.ts: 名前フィルター
- **ファイル**: `src/tools/read/find-objects.ts` 63-64行目
- **結論**: `itemName.indexOf(params.name) < 0` で `return false` は「名前に含まれない場合は除外」＝正しいフィルター。

### 5. get-artboards.ts: 座標系
- **ファイル**: `src/tools/read/get-artboards.ts` 49-51行目
- **結論**: `-rect[1]` はIllustratorのY軸反転を正しく変換している。他ツールの `getBounds` と一貫性あり。

## LOW - コード品質（未対応・cosmetic）

### 9. create-rectangle/ellipse/line.ts: 変数名の再利用
- **ファイル**: `src/tools/modify/create-rectangle.ts`, `create-ellipse.ts`, `create-line.ts`
- **問題**: `createColor()` 関数内で変数 `c` を CMYK/RGB/Gray で再利用。ES3なので問題にはならないが可読性が低い。
- **対応**: スキップ（cosmetic、機能的影響なし）

## FIXED（修正済み）

### 前回コミット（DPI解像度チェック）
- [x] **get-images.ts**: matrix回転バグ（`mValueA` → `sqrt(a²+b²)`）
- [x] **preflight-check.ts**: 解像度チェックが機能していなかった（ダミーwarningのみ）
- [x] **preflight-check.ts**: リンク画像のDPIチェックなし
- [x] **preflight-check.ts**: DPI閾値がハードコード（`min_dpi` パラメータ追加）
- [x] **image-header.ts**: `require()` ではなく ES module `import` を使用

### 今回コミット（バグ修正）
- [x] **export.ts**: 到達不能な `"done"` 条件を削除
- [x] **export-pdf.ts**: 未定義の `_bleed_set` パラメータ参照を削除
- [x] **get-effects.ts**: ハードコードされた500件制限を撤廃
- [x] **jsx-runner.ts**: タイムアウト時に明確なエラーメッセージを返すよう改善
- [x] **list-text-frames.ts**: フォント情報取得失敗時に空文字ではなくnullを返すよう変更
- [x] **file-transport.ts**: クリーンアップ失敗時に `console.warn` でログ出力
