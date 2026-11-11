# リリース手順

- **npm への直接 publish は禁止。** CI（GitHub Actions）経由でリリースする
- 手順: `package.json` と `plugins/ie3-design-bridge/.claude-plugin/plugin.json` を bump →
  コミット → タグ作成・push → GitHub Release を作成 → release CI が npm publish・
  mcpb の添付・MCP Registry 公開まで自動実行する（mcpb の手動アップロードは不要）
- `server.json` / `manifest.json` の version は CI がタグから自動更新する。プラグインは git の
  main から直接配られるため CI では書き換えられないので、ローカルで bump する
  （ずれると `test/unit/plugin-manifest.test.ts` が落ちる）
- `server.json` の description は **MCP Registry の 100 文字制限**あり。超えると Registry publish が
  422 で失敗する（npm publish は成功してしまうので注意）。`license` は MCP のスキーマに
  存在しないので入れない
- Release ノートは日英併記。セクションは該当があるものだけ使う:
  `### 破壊的変更 / Breaking Changes`、`### 新機能 / New Features`、`### 改善 / Improvements`、
  `### バグ修正 / Bug Fixes`、`### ドキュメント / Docs`、`### その他 / Other`
- 各項目は「日本語説明 / English description」の 1 行。デザイナーにも分かる表現にする。
  Full Changelog や PR リンクは不要
- 外部コントリビューターへの謝辞は README ではなく各リリースノート末尾の `### Special Thanks` に
  GitHub ハンドルで載せ、該当項目の行末にも「（@handle さんのコントリビューション）」を付ける
  （README に置くと 8 言語の同期コストがかかり、リリースごとの貢献も見えにくいため。2026-09 に撤去）

# 内部メモ

掲載・申請状況、掲載名の方針、露出の施策、実績データは `docs/internal.md`（git 管理外）に置いた。
公開リポジトリに出すものではないため。

# 入稿系ツールの方針（2026-11）

あえて実装していないもの（同じ検討を繰り返さないため）:

- **`flatten_transparency`**: 公式リファレンス全体に `flattenTransparency` が無く、メニューコマンド
  経由しかない。ダイアログの設定（ラスタライズ解像度・アウトライン化）を制御できないまま
  不可逆な処理を走らせることになる
- **`print_document`**: `Document.print()` と `PrintOptions` はあるが、物理的に紙が出て
  取り消せない。入稿データを作るという用途から外れる

# ExtendScript / Illustrator 実機で確認した落とし穴

- 括弧なしの三項演算子の連鎖（`a ? x : b ? y : z`）を誤評価する → 必ず括弧で囲む
  （`test/unit/jsx-nested-ternary.test.ts` が検出）
- `PageItem.uuid` は保存・再オープンで変わる → 永続 ID は note 方式
  （`"<UUID> <メモ>::ai-mcp:key=value"`）。`duplicate()` は note を継承するので複製後は
  `reassignUUIDDeep`
- `textRanges` を回しながら属性を書くと範囲が結合して無効化され MRAP になる → 全体に一度で
  設定するか、属性ごとにパスを分ける。**書いた直後の同じ参照から別の属性を読まない**
- `MRAP` は `PARM`（parameter）の逆順表示（`1346458189 = 0x5041524D`）。意味は「引数が不正」で、
  無効になったオブジェクト参照を渡すと出る。Adobe は未文書化
- `Document.saveAs(pdf)` は `PDFSaveOptions.artboardRange` を指定しないと作業中の文書が PDF に
  切り替わる
- `Document.pageItems` は再帰的に子孫を含む。`Layer.pageItems` は直下のみ
- `Document.printTiles` は read-only で、意味は「タイル出力として印刷するか」。
  View > プリント分割表示の状態ではない（`pagetiling` を実行しても変化しない）
- `colorProfileName` への代入は黙って無視されることが多い／`createOutline()` はロック中でも
  変換する／`zOrderPosition` は作成直後に例外
- JSX のエラー結果（`error: true` / `success: false`）は `formatToolResult` /
  `applyToolErrorBoundary` で isError 付き JSON として返す。例外にすると追加フィールドが
  LLM に届かない

# 実行層（AppleScript / osascript）の落とし穴

- **AppleScript の Apple Event 既定タイムアウトは 120 秒。** `tell` を `with timeout` で包まないと
  `-1712` になり、`ILLUSTRATOR_MCP_TIMEOUT_NORMAL` / `_HEAVY` を 120 秒以上にしても効かない。
  いまは execFile のタイムアウト + 60 秒で包んでいる（`appleEventTimeoutSeconds`）
- **`with timeout` はコンパイル段（`tell application` の用語辞書解決）を覆わない。**
  存在しないアプリへの `tell` は内側でも 0.1 秒で `-2741` になる。`run script` で実行時に移せるが、
  設定ミスが「即エラー」から「長時間ハング」に化けるため採用しない（実測で 180 秒返らず）
- `-2741` は `set_illustrator_version` で未インストールの版を指定したときにも出る
- エラー番号は末尾の `(-1712)` の形で判定する。stderr には必ず一時スクリプトのパスが入り、
  UUID の 4 桁グループが "1712" になりうるため、部分一致では誤分類する
- **背面の Illustrator はテキスト API で 240 秒待たされる。** `textFrames.pointText` と
  `contents` 代入がそれぞれ 240 秒（実測: 背面 480014 / 480040 / 480009 ms、前面 0〜2 ms。
  2025 / 29.5.0 と 2026 / 30.3.0 の両方で再現）。待機中は CPU 1.5% で計算していない。
  `characterAttributes` の読み書き・`createOutline`・矩形・読み取りは背面でも瞬時
- したがって `activate: true` を指定するのは次の 2 種類だけ:
  `executeMenuCommand` を使うツール（前面でないと失敗する）と、テキストを書くツール（速度のため）

# 結果の形の規約

- 書き込み系は `success` を返す。複数 UUID を扱うものは
  `success: notFound.length === 0 && failed.length === 0` のように部分失敗を計算する
- 読み取り系（`get_*` / `list_*`）は `success` を返さない。失敗時は `error: true` と isError が付く
- **失敗は必ず `failed` に入れ、要素に `message` を持たせる**（`errors` / `reason` は使わない）。
  識別キーは `uuid`（オブジェクト単位）か `property`（プロパティ単位）

# テスト

- ユニットテストの多くは JSX を Node 上のフェイクで評価する。フェイクは実機と食い違いうるので、
  挙動を変えたら実機 e2e で確かめる
- e2e は Illustrator が 1 インスタンスだけ起動している状態で回す（複数版が同時起動していると
  `tell application "Adobe Illustrator"` の宛先が曖昧になる）。実行中は Illustrator に触らない
- e2e のタイムアウトは `E2E_TIMEOUT_MS` で三者（サーバー・MCP SDK・fixture）まとめて上げる
- 間隔（spacing）の集計は、トップレベル（親が Layer）のアイテムをレイヤーをまたいで比較する。
  レイヤーごとに分けると「文字」「図形」「背景」のように分けた文書で間隔が取れなくなる

# デモ動画の録画

手順・ウィンドウ配置の座標・自動タイピング・`screencapture` のオプションは
[demo/README.md](demo/README.md) に分離した（録画するときだけ読む）。
