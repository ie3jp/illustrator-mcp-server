# LLM 手動テスト

LLM（Claude Code 等）に MCP ツールの description が正しく伝わるかを手動で検証するテスト集。
Illustrator が起動した状態で、各プロンプトを LLM に投げ、「判定基準」を目視で確認する。

## 準備

テスト用のドキュメントを作成してから始める:

```
新規CMYKドキュメント（800x1200pt）を作成して。名前は "llm-manual-test"。
```

---

## 1. クリッピングマスクの順序

ツールの `group_objects` で `clipped: true` を使う際、マスクとなるオブジェクトを uuids 配列の最後に渡すべきことを LLM が理解しているか。

### プロンプト

```
座標 (100, 100) に 300x200 の矩形（シアン100%ベタ、ストロークなし、名前 "content"）を作成し、
同じ座標に 200x200 の矩形（塗りなし、ストロークなし、名前 "mask"）を作成して、
"mask" で "content" をクリッピングマスクしてグループ化して。グループ名は "clipped-group"。
coordinate_system は artboard-web。
```

### 判定基準

- [ ] `group_objects` の `uuids` 配列で "mask" の UUID が **最後** にある
- [ ] `clipped: true` が指定されている
- [ ] Illustrator のレイヤーパネルで "mask" がグループ内の **最上位** にある

### NG パターン

- "content" が uuids の最後 → マスクが逆（content がクリップパスになる）

---

## 2. はみ出すグラデーション + マスク

0-100% の範囲を超えるグラデーション指定を、大きいオブジェクト+クリッピングマスクで実現できるか。

### プロンプト

```
座標 (100, 400) に 200x200 の領域で、
左端シアン100% → 右端マゼンタ100% のリニアグラデーションを表示したい。
ただしグラデーション範囲は表示領域の140%分（280pt）にして、
はみ出した部分はクリッピングマスクで切ってほしい。
ストロークは全てなし。coordinate_system は artboard-web。
```

### 判定基準

- [ ] 280pt幅（またはそれ以上）のグラデーション用矩形が作成されている
- [ ] 200x200 のマスク用矩形が作成されている
- [ ] `create_gradient` でグラデーションが適用されている
- [ ] `group_objects` で `clipped: true`、マスク矩形の UUID が配列の **最後**
- [ ] Illustrator 上で 200x200 の範囲にグラデーションがクリップされて表示される

---

## 3. リンク画像の埋め込み → UUID変更の理解

`manage_linked_images` の `embed` 後に UUID が変わることを LLM が理解し、後続操作で新しい UUID を使えるか。

### 前準備

```
/tmp/llm-test.png に適当な画像を配置して。座標 (500, 100)、coordinate_system は artboard-web。
```

### プロンプト

```
さっき配置したリンク画像を埋め込み（embed）して、その後そのオブジェクトの不透明度を50%に変更して。
```

### 判定基準

- [ ] `manage_linked_images` で `action: "embed"` が呼ばれる
- [ ] embed の結果から `newUuid` を取得している
- [ ] `modify_object` で **newUuid** を使って不透明度を変更している（古い UUID ではない）
- [ ] Illustrator 上でオブジェクトの不透明度が 50% になっている

### NG パターン

- embed 前の UUID で `modify_object` → 対象が見つからずエラー

---

## 4. replace_color のクロスカラースペース制限

CMYK の色を RGB に置換しようとしたとき、制限事項を理解して適切に対応するか。

### 前準備

```
座標 (100, 600) に 50x50 のシアン100%ベタ矩形を作って。coordinate_system は artboard-web。
```

### プロンプト

```
ドキュメント内のシアン100%（CMYK）の塗りを、RGB の赤 (255,0,0) に一括置換して。
```

### 判定基準（以下のいずれか）

- [ ] **A**: クロスカラースペース不可と説明し、代替手段（CMYK の赤相当値で置換、or 個別に `modify_object` で変更）を提案する
- [ ] **B**: `replace_color` を呼ぶ場合、`from_color` と `to_color` を同じカラースペースに統一している（例: 両方 CMYK）

### NG パターン

- `from_color: {type: "cmyk", ...}` と `to_color: {type: "rgb", ...}` で呼ぶ → マッチせず何も置換されない

---

## 5. 最後のアートボードは削除不可

### プロンプト

```
ドキュメントのアートボードを全て削除して。
```

### 判定基準

- [ ] 最後の1つのアートボードを残して削除を止める（削除不可と説明）
- [ ] もしくは、最後の1つを削除しようとした際のエラーを受けて「最後のアートボードは削除できません」と報告
- [ ] 最終的にドキュメントにアートボードが **1つ以上** 残っている

### NG パターン

- エラーを無視して何度もリトライ
- アートボード 0 を消そうとしてドキュメントが壊れる

---

## 6. テキスト改行

LLM が `create_text_frame` の `contents` に `\n` を使って複数行テキストを正しく作成できるか。

### プロンプト

```
座標 (100, 800) にポイントテキストを作成して。内容は3行:
1行目: Hello
2行目: World
3行目: Test
フォントサイズ 24pt、coordinate_system は artboard-web。
```

### 判定基準

- [ ] `create_text_frame` の `contents` に改行（`\n`）が含まれている
- [ ] Illustrator 上で3行のテキストが表示される

### NG パターン

- 改行なしで "HelloWorldTest" と1行になる
- 改行が `\\n` のままリテラル文字として表示される

---

## 7. グループのスタック順序（非クリッピング）

`group_objects` の uuids 順序がスタック順序に影響することを理解しているか。

### プロンプト

```
以下の2つの矩形を作成し、グループ化して:
1. 座標 (400, 100) に 100x100 の赤い矩形（CMYK: C0 M100 Y100 K0、名前 "red-back"）
2. 座標 (430, 130) に 100x100 の青い矩形（CMYK: C100 M100 Y0 K0、名前 "blue-front"）

グループ名は "stacked-group"。レイヤーパネル上で "blue-front" が "red-back" より前面になるようにして。
ストロークは全てなし、coordinate_system は artboard-web。
```

### 判定基準

- [ ] `group_objects` の `uuids` 配列で "blue-front" が **最後** にある
- [ ] Illustrator のレイヤーパネルで "blue-front" が "red-back" の **上** に表示される
- [ ] 視覚的に青い矩形が赤い矩形の上に重なっている

### NG パターン

- 順序を気にせず作成順に渡す → 意図と逆のスタック順になる可能性

---

## 8. UUID + PNG エクスポートの副作用理解

### 前準備

```
座標 (600, 400) に 100x100 のマゼンタ100% 矩形を作って。名前は "export-target"。coordinate_system は artboard-web。
```

### プロンプト

```
"export-target" という名前の矩形を PNG で /tmp/export-test.png にエクスポートして。
その後、同じ矩形の色をシアン100%に変更して。
```

### 判定基準

- [ ] `export` でエクスポートが成功する
- [ ] エクスポート後も対象オブジェクトの UUID で `modify_object` が成功する
- [ ] 選択状態が変わっている可能性を理解している（明示的なエラーにはならないが）

---

## 9. GrayColor の解釈

`check_contrast` や `preflight_check` が GrayColor をインク量として解釈することを理解しているか。

### プロンプト

```
CMYK の白 (C0 M0 Y0 K0) と GrayColor の gray=80 のコントラスト比を check_contrast で確認して。
```

### 判定基準

- [ ] `check_contrast` が呼ばれる
- [ ] GrayColor で `value: 80` を指定している（gray=80 = インク80% = かなり暗い色）
- [ ] 結果のコントラスト比が高い値（白 vs 暗いグレー）になる

### NG パターン

- gray=80 を「明るいグレー」と誤解して低コントラストを期待する

---

## クリーンアップ

```
テストドキュメントを保存せずに閉じて。
```

---

## テスト結果の記録

| # | シナリオ | 結果 | メモ |
|---|---------|------|------|
| 1 | clipping-mask | | |
| 2 | overflow-gradient | | |
| 3 | embed-then-modify | | |
| 4 | replace-color-limitation | | |
| 5 | artboard-remove-constraint | | |
| 6 | text-newline | | |
| 7 | group-stacking-order | | |
| 8 | uuid-png-export | | |
| 9 | graycolor-interpretation | | |
