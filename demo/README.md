# デモ動画の録画

Claude Desktop と Illustrator を左右に並べ、プロンプトの自動入力から MCP 経由で
Illustrator が動くまでを録画するための手順。CLAUDE.md から分離してある
（録画するときしか要らない運用手順で、毎セッション読む必要がないため）。

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
