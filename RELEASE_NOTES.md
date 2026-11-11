### 新機能 / New Features

- 新しい版が出ていると、最初のツール応答で知らせ、入れ方（.mcpb・npx・Claude Code プラグイン）ごとの更新方法を案内します。起動時に npm へ最新の版番号を 1 回だけ問い合わせます（個人データやドキュメントのデータは送りません）。環境変数 `ILLUSTRATOR_MCP_NO_UPDATE_CHECK=1` で無効にできます / When a newer version is out, the first tool response now says so and explains how to update for your install method (.mcpb, npx or the Claude Code plugin). The server asks the npm registry for the latest version number once per start (no personal or document data is sent). Set `ILLUSTRATOR_MCP_NO_UPDATE_CHECK=1` to turn it off

### ドキュメント / Docs

- README の npx の手順を `npx -y illustrator-mcp-server@latest` に変えました。これまでの `npx illustrator-mcp-server` は、npx が最初に取得した版を使い続けるため更新されていませんでした。手動で設定している方は、設定の `args` を書き換えて再起動してください / The npx instructions in the README now use `npx -y illustrator-mcp-server@latest`. The previous `npx illustrator-mcp-server` kept reusing whichever version npx had cached first, so it never updated. If you set the server up manually, change `args` in your config and restart
- プライバシーポリシーに、上記の更新確認の通信について追記しました / The privacy policy now describes the update check above
