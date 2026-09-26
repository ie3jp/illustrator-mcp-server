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

## デモ動画の録画

### 概要
Claude Desktop + Illustrator を左右に並べ、プロンプト自動入力→MCP経由でIllustratorを操作する様子を録画する。

### 3パターンのデモ

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

# テスト

- ユニットテストの多くは JSX を Node 上のフェイクで評価する。フェイクは実機と食い違いうるので、挙動を変えたら実機 e2e（README の Testing 節）で確かめる
- e2e は Illustrator が 1 インスタンスだけ起動している状態で回す（2025 と 2026 が同時に起動していると `tell application "Adobe Illustrator"` の宛先が曖昧になる）。実行中は Illustrator に触らない
