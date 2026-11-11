# Privacy Policy / プライバシーポリシー

Effective date / 施行日: 2026-11-12

illustrator-mcp-server ("the server") is an open-source MCP server that runs entirely on your computer and controls your local copy of Adobe Illustrator.

illustrator-mcp-server（以下「本サーバー」）は、お使いのコンピューター上だけで動作し、ローカルの Adobe Illustrator を操作するオープンソースの MCP サーバーです。

## Data collection / 収集するデータ

The server does not collect, transmit, or sell any personal data. It has no telemetry, analytics, or crash reporting. Its only network connection is the update check described below.

本サーバーは個人データを収集・送信・販売しません。テレメトリー、アクセス解析、クラッシュレポートの仕組みはありません。本サーバー自身が行うネットワーク通信は、下記の更新確認だけです。

## Update check / 更新の確認

Once per start, the server asks the public npm registry (`https://registry.npmjs.org/illustrator-mcp-server/latest`) for the latest version number, so it can tell you when an update is available. The request contains no personal data and no document data; like any web request, the registry sees your IP address. If the check fails (for example, when you are offline), it is silently skipped. To turn it off, set the environment variable `ILLUSTRATOR_MCP_NO_UPDATE_CHECK=1`.

本サーバーは起動のたびに一度だけ、公開されている npm レジストリ（`https://registry.npmjs.org/illustrator-mcp-server/latest`）に最新の版番号を問い合わせ、更新があればお知らせします。問い合わせに個人データやドキュメントのデータは含まれません（通常の Web 通信と同じく、レジストリには IP アドレスが伝わります）。オフラインなどで失敗した場合は何もせずに続行します。無効にするには環境変数 `ILLUSTRATOR_MCP_NO_UPDATE_CHECK=1` を設定してください。

## How data is used and stored / データの利用と保存

- **Tool parameters and document data** — To run a tool, the server passes its parameters to Illustrator on your machine (via AppleScript on macOS or PowerShell/COM on Windows) and reads or modifies the open Illustrator document. The result is returned only to the MCP client that called the tool (for example, Claude).
- **Temporary files** — Each call writes its script, parameters, and result to a temporary folder in your operating system's temp directory. These files are deleted as soon as the call finishes.
- **Files you ask for** — Files are written only when you (or the AI on your behalf) export or save: to the path you specify, or, if no path is given, as a new file next to the document (or on the Desktop for unsaved documents). Existing files are not overwritten unless you explicitly allow it.
- **Object notes** — To identify objects between calls, the server stores a short ID at the start of an object's note (Attributes panel) inside your Illustrator document. Any note you wrote yourself is kept.

- **ツールの引数とドキュメントのデータ** — ツールを実行すると、本サーバーは引数をお使いのマシン上の Illustrator に渡し（macOS は AppleScript、Windows は PowerShell/COM 経由）、開いているドキュメントを読み取り・変更します。結果は、ツールを呼び出した MCP クライアント（Claude など）にだけ返します。
- **一時ファイル** — 呼び出しのたびに、スクリプト・引数・結果を OS の一時フォルダーに書き出し、処理が終わるとすぐに削除します。
- **指定されたファイル** — ファイルを書き込むのは、あなた（またはあなたの代わりに AI）が書き出し・保存を行ったときだけです。書き込み先は指定されたパス、指定がなければドキュメントと同じフォルダー（未保存のドキュメントはデスクトップ）に新しい名前で作ります。明示的に許可しない限り、既存のファイルは上書きしません。
- **オブジェクトのメモ** — 呼び出しをまたいでオブジェクトを識別するため、Illustrator ドキュメント内のオブジェクトのメモ（「属性」パネル）の先頭に短い ID を記録します。あなたが書いたメモはそのまま残ります。

## Third-party sharing / 第三者への提供

The server does not share data with any third party. Tool results are returned to the MCP client you use; how that client (for example, Claude by Anthropic) handles them is governed by the client's own privacy policy.

本サーバーは第三者にデータを提供しません。ツールの結果はお使いの MCP クライアントに返され、その扱い（たとえば Anthropic の Claude）は各クライアントのプライバシーポリシーに従います。

## Data retention / データの保持期間

The server keeps no data after a call finishes: temporary files are deleted immediately, and nothing is stored outside the documents and files you work with.

本サーバーは呼び出しの終了後にデータを保持しません。一時ファイルはすぐに削除され、作業中のドキュメントとファイル以外には何も保存しません。

## Contact / お問い合わせ

- Questions and requests / 質問・ご要望: <https://github.com/ie3jp/illustrator-mcp-server/issues>
- Security issues / セキュリティ上の問題: <https://github.com/ie3jp/illustrator-mcp-server/security/advisories/new>

Changes to this policy are published in this repository. / 本ポリシーの変更は、このリポジトリで公開します。
