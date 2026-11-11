### 新機能 / New Features

- **トラップ線**（`make_trap_stroke`）を追加しました。塗りと同じ色の線をオーバープリントで引き、印刷の版ズレで輪郭に白い隙間が出るのを防ぎます。単色の塗りだけが対象で、グラデーションやパターン、ロックされたオブジェクトは理由つきで `skipped` に返します。線幅は印刷所に確認すべき値なので、既定の 0.5pt のまま使わず確認してください / Added **trap strokes** (`make_trap_stroke`): a stroke in the fill's own color, set to overprint, so a misregistration on press leaves no white gap along the edge. Only solid fills are trapped; gradients, patterns and locked objects are reported in `skipped` with a reason. Ask your printer for the trap width rather than relying on the 0.5 pt default
- **入稿確認用の表示切替**（`toggle_prepress_view`）を追加しました。オーバープリントプレビュー、プリント分割表示、分版プレビュー、分割・統合プレビュー、属性パネルを切り替えます。入稿前に人が目で確かめるためのものです / Added **prepress views** (`toggle_prepress_view`): switch overprint preview, print tiling, the separations preview, the flattener preview or the attributes panel, so a person can check the file before it goes to print

### 改善 / Improvements

- トラップ線は適用後にオーバープリントの設定を読み返して確認し、効いていなければ `failed` に返します。Illustrator が代入を黙って無視することがあるためです / The trap stroke reads the overprint setting back after writing it and reports anything that did not stick in `failed`, because Illustrator sometimes ignores the assignment silently

### ドキュメント / Docs

- 8 言語の README にツール一覧を追記しました（操作系 39 → 41、全体 66 → 68） / Added the new tools to the tool tables in all eight READMEs (modify tools 39 → 41, 68 in total)
