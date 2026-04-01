# リリース手順

- npmへの直接publishは禁止。必ずCI（GitHub Actions）経由でリリースする
- 手順: バージョンbump → コミット → タグ作成・push → CIが自動でnpm publish → GitHub Releaseを作成
- `npm publish` をローカルで実行しない
- GitHub Releaseのノートは以下のフォーマットで日英併記する:
  - セクション: `### 新機能 / New Features`、`### 改善 / Improvements`、`### バグ修正 / Bug Fixes`、`### ドキュメント / Docs`、`### その他 / Other`（該当があるもののみ）
  - 各項目は「日本語説明 / English description」の1行形式
  - デザイナーなど非エンジニアにもわかりやすい表現にする
  - Full ChangelogリンクやPRリンクは不要

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

## デモ動画の録画（CLI）

macOS標準の `screencapture` でCLIから録画できる。ウィンドウ配置も `osascript` で制御可能。

### ワークフロー
1. `osascript` でIllustratorのウィンドウを固定位置・サイズに設定
2. `screencapture` で同じ矩形を動画録画
3. 撮り直し時も同一フレームで再現可能

### コマンド例
```bash
# ウィンドウ配置
osascript -e 'tell application "System Events" to tell process "Illustrator"
  set position of window 1 to {100, 100}
  set size of window 1 to {1280, 720}
end tell'

# 録画（30秒で自動停止、クリック表示）
screencapture -V 30 -R 100,100,1280,720 -k output.mov
```

### 主要オプション
- `-R x,y,w,h` — 録画範囲の矩形指定
- `-V seconds` — 秒数指定で自動停止（`-v` だとCtrl+Cで手動停止）
- `-k` — クリックを表示
- `-g` — マイク音声も録る

### 備考
- docsのautoPrompt用デモ録画に使う想定
- OpenScreen（`~/Dropbox/__playground/openScreen`）はElectron製GUIアプリでCLI非対応。ズーム演出等の加工が必要な場合はGUIで使う

## データ (2026-03)
- npm月間DL: 933 (3/23リリース)
- 紹介するたびにスパイクが出る → 定期的に違う切り口で露出するのが効果的
