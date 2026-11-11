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

掲載・申請状況、掲載名の方針、露出の施策、実績データ、マネタイズ設計、ユースケース整理は
リポジトリの外（`../illustrator-mcp-server-private/`）に置いた。公開リポジトリに出すものではなく、
リポジトリ内に置くと .gitignore の変更や `git add -f` で混入しうるため。

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

<<<<<<< HEAD
| # | スクリプト | 内容 | カラー |
|---|-----------|------|--------|
| 1 | `demo/record_01_business_card.sh` | 名刺 "KUMO Studio" | CMYK |
| 2 | `demo/record_02_poster.sh` | A3ポスター "SYNC TOKYO 2026" | CMYK |
| 3 | `demo/record_03_logo.sh` | ロゴ3案 "Slow Drip" | RGB |

### 録画の実行手順

```bash
# 0. 事前準備
#    - Claude Desktop と Illustrator を起動しておく
#    - Claude Desktop で新しいチャットを開いておく
#    - 前回の .mov ファイルが残っていたら削除する（上書きできないため）

# 1. スクリプト実行（ウィンドウ配置→録画開始→タイピング→送信を一括）
bash demo/record_01_business_card.sh

# 2. Claude Desktop が作業完了するまで待つ
#    - スクロールが止まったら End キーで最下部に飛ばす
#    - Continue ボタンが出たら手動で押す

# 3. 完了したら Ctrl+C で録画停止

# 4. 次のパターンは新しいチャットで繰り返し
bash demo/record_02_poster.sh
bash demo/record_03_logo.sh
```

### スクリプトの中身

各スクリプトは以下を自動実行する:
1. Claude Desktop（左）+ Illustrator（右）をサブディスプレイ上に配置
2. `screencapture -v` でサブディスプレイを録画開始（バックグラウンド）
3. 英数キーでIME切替 → プロンプトを1文字ずつタイピング（delay 0.002）→ Cmd+Enter で送信

### ウィンドウ配置（サブディスプレイ EV2785, 1280x720）

```bash
# AppleScript座標: サブが上にあるため Y が負の値
osascript -e '
tell application "System Events"
    tell process "Claude"
        set position of window 1 to {0, -720}
        set size of window 1 to {640, 720}
    end tell
    tell process "Illustrator"
        set position of window 1 to {640, -720}
        set size of window 1 to {640, 720}
    end tell
end tell'
```

- ディスプレイ配置が変わったら座標の再取得が必要（`NSScreen` で確認）
- Illustrator は AppleScript の `set position` で負のY座標を受け付けないことがある。その場合は手動でサブに移動してからスクリプトを実行する

### 自動タイピング

```bash
osascript -e '
tell application "System Events" to key code 102
delay 0.5
tell application "Claude" to activate
delay 1
set inputText to "ここにプロンプト"
tell application "System Events"
    repeat with c in (characters of inputText)
        keystroke c
        delay 0.002
    end repeat
    delay 0.5
    keystroke return using command down
end tell'
```

- `key code 102`（英数キー）でIMEを英語に切り替えてから入力
- `delay 0.002` でタイピング速度を調整（小さいほど速い）
- 日本語テキストは未対応（`keystroke` はASCIIのみ。クリップボード経由の別方式が必要）
- 改行は `keystroke return using shift down`（Shift+Enter）。通常の Enter は送信になるため
- 送信は `keystroke return`（Enter）
- アクセシビリティ権限が必要（System Preferences → Privacy & Security → Accessibility）

### screencapture オプション
- `-R x,y,w,h` — 録画範囲の矩形指定
- `-V seconds` — 秒数指定で自動停止（`-v` だとCtrl+Cで手動停止）
- `-k` — クリックを表示
- `-g` — マイク音声も録る
- 同名ファイルが既に存在すると録画失敗する。事前に削除すること

### スクロール
- Claude Desktop の自動スクロールが止まった場合は `End` キーで最下部に飛ばせる

### 注意事項
- OpenScreen（`~/Dropbox/__playground/openScreen`）はElectron製GUIアプリでCLI非対応。ズーム演出等の加工が必要な場合はGUIで使う
- Illustrator の英語化は `application.xml` の `installedLanguages` を `en_US` に変更（sudo必要、要再起動）。ただし効かない場合あり

## データ (2026-03)
- npm月間DL: 933 (3/23リリース)
- 紹介するたびにスパイクが出る → 定期的に違う切り口で露出するのが効果的

# ExtendScript / Illustrator 実機で確認した落とし穴（2026-09）

コードコメントにも残してあるが、新しいツールを書くときに踏みやすいものをまとめる。
- 括弧なしの三項演算子の連鎖（`a ? x : b ? y : z`）を誤評価する → 必ず括弧で囲む（`test/unit/jsx-nested-ternary.test.ts` が検出）
- `PageItem.uuid` は保存・再オープンで変わる → 永続 ID は note 方式（`"<UUID> <メモ>::ai-mcp:key=value"`）。`duplicate()` は note を継承するので複製後は `reassignUUIDDeep`
- `textRanges` を回しながら属性を書くと範囲が結合して無効化され MRAP になる → 全体に一度で設定するか、後ろから書いて最後に取り直して検証
- `Document.saveAs(pdf)` は `PDFSaveOptions.artboardRange` を指定しないと作業中の文書が PDF に切り替わる
- `colorProfileName` への代入は黙って無視されることが多い／`createOutline()` はロック中でも変換する／`zOrderPosition` は作成直後に例外
- JSX のエラー結果（`error: true` / `success: false`）は `formatToolResult` / `applyToolErrorBoundary` で isError 付き JSON として返す。例外にすると追加フィールドが LLM に届かない
- 長く使った Illustrator では文字属性（characterAttributes / paragraphAttributes）の読み書きが `an Illustrator error occurred: 1346458189 ('MRAP')`（e.number 1200）で散発的に失敗する（2026 / 30.3.0、2026-10 に実機で計測）。セッションが古くなるほど増え、呼び出し間隔・前面化・`$.gc()`・`app.redraw()` では変わらない
  - `tf.characters` / `tf.textRanges` は一度失敗すると、取り直しても次の呼び出しでも失敗し続ける。毎回新しく作られる `tf.textRange`（とその characters / paragraphs）から読み直すと回復する（交互比較 120 回: 1 文字ずつの読み取りが現行方式で 18/40 失敗、読み直し付きで 1/80）
  - **未解決（2026-10-03 時点、このブランチをマージしない理由）**: 失敗を明示する変更を入れたビルドは、e2e-behaviors を変更前と交互に回すと、変更していない経路（create_text_frame の書き込み、e2e フィクスチャの書き込み、preflight の読み取り）の MRAP が変更前 16 回中 4 件に対し変更後 17 回中 17 件と明らかに多い。読み直しを外した版でも同じだったので、読み直しが原因ではない。原因は未特定。疑っているのは、増えた common.jsx が全スクリプト（e2e フィクスチャも cwd の common.jsx を前置する）に入ること、または失敗が表に出て e2e の流れが変わること。切り分けには同じセッションでの交互比較が数十回要る
  - 変更前のビルドは同じ期間の 16 回すべてで 102 件中 0〜1 件しか落ちなかったが、これは MRAP を握りつぶして既定値で通しているため（contents しか見ないテストは値が壊れていても通る）。変更後で出た get_text_frame_detail のエラー（`Could not read the attributes of character N`）は、変更前なら黙って既定値になっていた分
  - `readTextUnits` は最初に各ツールが従来読んでいたコレクション（`tf.textRanges` など）を読み、MRAP のときだけ新しい `tf.textRange` に切り替える。常に新しい `tf.textRange` から読む版を e2e で変更前と交互に回したら、変更していない経路（フィクスチャの書き込み・preflight）の MRAP が 7 件/8 回 対 3 件/7 回 と多めに出た。偶然の範囲だが、根拠なく平常時の触り方を変えないため
  - 文字属性を読むときは common.jsx の `readTextWhole` / `readTextUnits` を使い、読めなければ `newTextReadLog` → `noteTextReadFailure` → `markTextReadFailures` で部分失敗（isError）にする。既定値で埋めて成功にしない（「成功したのに値が違う」がいちばん見つけにくい）。作成・配置を終えた後の付随的な読み取りなら `attachTextReadFailures`（失敗扱いにすると作り直されて二重になる）
  - 書き込み（fillColor の代入、pointText の作成）でも MRAP は出るが、書き込みを再試行して効くかは実機で確かめていない
  - 平常時でも例外になるもの（値が無いだけ）: ポイント文字・パス上文字の nextFrame / previousFrame（9544）、手動カーニングが無い位置の TextRange.kerning（9551）、空のフレームの文字属性（1220）と paragraphs[0]（1302。段落数は 1 と返る）。混在した属性を文字列全体で読むと例外にならず先頭文字の値が返る

# テスト

- ユニットテストの多くは JSX を Node 上のフェイクで評価する。フェイクは実機と食い違いうるので、挙動を変えたら実機 e2e（README の Testing 節）で確かめる
- e2e は Illustrator が 1 インスタンスだけ起動している状態で回す（2025 と 2026 が同時に起動していると `tell application "Adobe Illustrator"` の宛先が曖昧になる）。実行中は Illustrator に触らない
- e2e・実機プローブの前に Illustrator を前面にしておく。背面のまま `documents.add` の途中で止まり、AppleEvent が -1712 でタイムアウトしたことがある（2026-10-03、前面にしたら続きが走った）
- 文字属性の MRAP は再現の強さがセッションの古さで変わる。直したかを確かめるときは、変更前と変更後のビルドを同じセッションで交互に回して比べる（片方だけ回した回数では比べられない）
=======
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
>>>>>>> main
