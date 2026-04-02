# Windows Diagnostic Tools

Windows 上で Illustrator MCP Server の COM 連携をテストする診断ツール。

## 使い方

### 方法 1: PowerShell 直接実行（ビルド不要）

Illustrator を起動し、何かドキュメントを開いた状態で:

```powershell
cd test/windows-diag
powershell -ExecutionPolicy Bypass -File run-diag.ps1
```

### 方法 2: Node.js 経由（MCP サーバーと同じコードパス）

```bash
npm run build
npx tsx test/windows-diag/diag-mcp.ts
```

## テスト内容

| テスト | 内容 | 失敗時の意味 |
|--------|------|-------------|
| COM 接続 | `New-Object -ComObject "Illustrator.Application"` | Illustrator 未起動 or COM 未登録 |
| インライン読み取り | `DoJavaScript("app.version")` | COM 基本通信の問題 |
| インライン書き込み | `DoJavaScript` で矩形作成・移動・削除 | 書き込み権限の問題 |
| evalFile 読み取り | `$.evalFile()` で JSX ファイル実行（読み取り） | ファイルパス or evalFile の問題 |
| evalFile 書き込み | `$.evalFile()` で JSX ファイル実行（書き込み） | evalFile コンテキストでの書き込み制限 |
| ファイル I/O | JSX 内で JSON ファイル読み書き | temp ディレクトリ権限の問題 |

## 結果の読み方

- **テスト 2-3 PASS、テスト 4-6 FAIL** → `$.evalFile()` またはファイル I/O の問題
- **テスト 3 FAIL（書き込み）、テスト 2 PASS（読み取り）** → COM 書き込み権限の問題
- **全テスト PASS** → COM 自体は正常。MCP サーバー固有の統合問題
