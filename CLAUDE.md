# リリース手順

- npmへの直接publishは禁止。必ずCI（GitHub Actions）経由でリリースする
- 手順: バージョンbump → コミット → タグ作成・push → GitHub Releaseを作成 → release CIが npm publish・mcpbのリリース添付・MCP Registry公開まで自動実行
- mcpbの手動アップロードは不要（CIの Upload release asset ステップが自動添付する）
- server.json の description は **MCP Registry の100文字制限** あり。超えると release CI の Registry publish が422で失敗する（npm publishは成功してしまうので注意）
- server.json / manifest.json のversionはCIがタグから自動更新する。ローカルでは package.json と `plugins/ie3-design-bridge/.claude-plugin/plugin.json` をbumpする（プラグインは git の main から直接配られるためCIでは書き換えられない。ずれると `test/unit/plugin-manifest.test.ts` が落ちる）
- `npm publish` をローカルで実行しない
- GitHub Releaseのノートは以下のフォーマットで日英併記する:
  - セクション: `### 新機能 / New Features`、`### 改善 / Improvements`、`### バグ修正 / Bug Fixes`、`### ドキュメント / Docs`、`### その他 / Other`（該当があるもののみ）
  - 各項目は「日本語説明 / English description」の1行形式
  - デザイナーなど非エンジニアにもわかりやすい表現にする
  - Full ChangelogリンクやPRリンクは不要
  - 外部コントリビューター（PR・フィードバック）への謝辞は README ではなく、各リリースノート末尾の `### Special Thanks` に GitHub ハンドルで載せる。該当項目の行末にも「（@handle さんのコントリビューション）」を付ける
    - README に謝辞セクションを置くと8言語の同期コストがかかり、リリースごとの貢献が見えにくくなるため（2026-09 に README から撤去）

# プロモーション計画

## 登録済み
- Glama (READMEにバッジあり)
- MCP Registry（CI がリリースごとに自動公開）
- **Claude Desktop 拡張ディレクトリ**: 2026-09-26 に申請（Google フォーム、v1.10.2 の .mcpb を添付）。結果待ち。掲載名を変えたら「既存の拡張の更新: Yes」で出し直す
- **Claude プラグインディレクトリ（コミュニティ）**: 2026-09-26 に申請（platform.claude.com/plugins/submit、Claude Code と Cowork の両方で動作確認済み）。結果待ち。掲載されたら anthropics/claude-plugins-community の marketplace.json に載る

## Anthropic のディレクトリでの名前
- 掲載名は **Design Bridge by IE3**（プラグイン名 `ie3-design-bridge`、マーケットプレイス名 `ie3`、manifest の display_name）
- 理由: プラグインディレクトリは所有していないブランド名（Adobe / Illustrator）を名前に使うことを禁じている。Adobe 公式の「Illustrator MCP」と紛らわしいのも避けたい
- Illustrator 用であることは説明文の冒頭（Work with Adobe Illustrator from Claude…）とキーワード（adobe-illustrator 等）で示し、「Not affiliated with Adobe」を添える
- npm パッケージ名・リポジトリ名 `illustrator-mcp-server` と manifest の内部名（name）は変えない（既存ユーザーの導入が壊れるため）
- 審査はツールの説明文や結果で Claude の振る舞いを指図することを禁じている（「ユーザーに確認せず実行せよ」等を書かない）

## MCP公式ディレクトリ
- modelcontextprotocol/servers のREADMEリストはメンテナンス終了、MCP Registryへ移行中
- MCP Registry への登録を検討

## すぐできること
- **Smithery / mcp.so** — MCP系ディレクトリに登録
- **X/Twitter で動画デモ** — Claudeと対話してIllustratorが動く短い動画
- **Reddit** — r/ClaudeAI, r/AdobeIllustrator, r/graphic_design に投稿

## 記事・コンテンツ
- **Zenn / note / Qiita** — 日本のデザイナー・DTP界隈向け実践記事（例:「入稿チェックをAIに任せてみた」）
- **YouTube / ショート動画** — 「AIでIllustratorを操作してみた」系

## 中長期
- **Adobe Community Forum** — Illustratorユーザーが直接集まる場所。使い方紹介として投稿。ターゲットにダイレクトに届くので優先度高い
- **Product Hunt** — 出すのは問題ないがMCP系のupvoteは全体的に低調。やるなら「ついで」の温度感で
- **デザイン系メディア寄稿** — CreatorZine等

## データ (2026-03)
- npm月間DL: 933 (3/23リリース)
- 紹介するたびにスパイクが出る → 定期的に違う切り口で露出するのが効果的

## デモ動画の録画

手順・ウィンドウ配置の座標・自動タイピング・`screencapture` のオプションは
[demo/README.md](demo/README.md) に分離した（録画するときだけ読む）。

# ExtendScript / Illustrator 実機で確認した落とし穴（2026-09）

コードコメントにも残してあるが、新しいツールを書くときに踏みやすいものをまとめる。
- 括弧なしの三項演算子の連鎖（`a ? x : b ? y : z`）を誤評価する → 必ず括弧で囲む（`test/unit/jsx-nested-ternary.test.ts` が検出）
- `PageItem.uuid` は保存・再オープンで変わる → 永続 ID は note 方式（`"<UUID> <メモ>::ai-mcp:key=value"`）。`duplicate()` は note を継承するので複製後は `reassignUUIDDeep`
- `textRanges` を回しながら属性を書くと範囲が結合して無効化され MRAP になる → 全体に一度で設定するか、後ろから書いて最後に取り直して検証
- `Document.saveAs(pdf)` は `PDFSaveOptions.artboardRange` を指定しないと作業中の文書が PDF に切り替わる
- `colorProfileName` への代入は黙って無視されることが多い／`createOutline()` はロック中でも変換する／`zOrderPosition` は作成直後に例外
- JSX のエラー結果（`error: true` / `success: false`）は `formatToolResult` / `applyToolErrorBoundary` で isError 付き JSON として返す。例外にすると追加フィールドが LLM に届かない

# 実行層（AppleScript / osascript）で確認した落とし穴（2026-11）

- **AppleScript の Apple Event 既定タイムアウトは 120 秒。** `tell` ブロックを `with timeout` で
  包まないとここで打ち切られ、`-1712`（AppleEvent timed out）になる。README とエラーメッセージが
  案内している `ILLUSTRATOR_MCP_TIMEOUT_NORMAL` / `_HEAVY` は、120 秒以上に設定しても効かなかった。
  いまは execFile 側のタイムアウト + 60 秒で `with timeout` を生成している（`appleEventTimeoutSeconds`）
- **`with timeout` はコンパイル段（`tell application` の用語辞書解決）を覆わない。** 存在しないアプリに
  `tell` すると `with timeout` の内側でも 0.1 秒で `-2741` になる（実測）。`run script` で文字列として
  渡せばコンパイルも実行時に移せるが、**存在しないアプリ指定が「即エラー」から「長時間ハング」に化ける**
  ため採用しない（実測で 180 秒待っても返らなかった）
- **`-2741` は「Illustrator がビジー」だけでなく「`set_illustrator_version` で指定した版が入っていない」
  ときにも出る。** `set_illustrator_version` は `^\d{4}$` しか検証せず存在確認をしないため、
  未インストールの年を渡すとこのエラーになる
- **エラー番号は osascript 形式の末尾「(-1712)」の形で判定する。** stderr には必ず一時スクリプトの
  パスが入り、その UUID の 4 桁グループが "1712" になりうるので、`includes('-1712')` だと
  無関係なエラーを誤分類する（約 1/3 万の確率で成立）
- **`MRAP` は `PARM`（parameter）の逆順表示。** `1346458189 = 0x5041524D = "PARM"`。意味は
  「渡された引数が不正」で、無効になったオブジェクト参照を API に渡すと出る。Adobe は未文書化
- **テキスト生成が極端に遅い環境がある。** ある実機で `create_text_frame` 1 回が 124〜961 秒かかった
  （他のツールは 0.3〜4 秒）。素の JSX で計測すると `textFrames.pointText` の初回が 20.9 秒で
  2 回目以降は 0 秒の回もあり、**ばらつきの原因は未特定**。こちらのヘルパ（`ensureUUID` /
  `verifyItem` / `resolveTargetLayer`）は全てゼロ秒で、フォント数との因果も示せていない。
  `place_image` の埋め込みでも 121 秒かかった例があるのでテキスト専用の問題でもない

# 結果の形の規約

- **書き込み系ツールは `success` を返す。** 単一オブジェクトの作成系だけ返しておらず、LLM から見た
  成功判定の方法がツールごとに違っていたため揃えた（2026-11）。複数 UUID を扱うものは
  `success: notFound.length === 0 && errors.length === 0` のように部分失敗を計算する
- **読み取り系（`get_*` / `list_*`）は `success` を返さない。** データを返すのが仕事で、失敗時は
  `error: true` と isError が付くため冗長。ここを変えると全クライアントに影響する

# テスト

- ユニットテストの多くは JSX を Node 上のフェイクで評価する。フェイクは実機と食い違いうるので、挙動を変えたら実機 e2e（README の Testing 節）で確かめる
- e2e は Illustrator が 1 インスタンスだけ起動している状態で回す（2025 と 2026 が同時に起動していると `tell application "Adobe Illustrator"` の宛先が曖昧になる）。実行中は Illustrator に触らない
- **e2e のタイムアウトは `E2E_TIMEOUT_MS` で三者まとめて上げる**（既定 600 秒）。以前はサーバー側 30 秒・
  MCP SDK 60 秒・fixture の `with timeout` 120 秒がばらばらに効いており、遅い環境では構造的に完走できなかった
- e2e のテキスト系テストは 1 本ごとに数分かかる環境がある。全体で数時間になるため、
  Illustrator を使えない時間を見積まってから回す
- **間隔（spacing）の集計は、トップレベル（親が Layer）のアイテムをレイヤーをまたいで比較する。**
  レイヤーごとに scope を分けると「文字」「図形」「背景」のように分けた文書で間隔が一切取れなくなる
  （#52 の修正で一度そうなった）。グループの子だけ別 scope にして親と子の bounds を混ぜない
