### 破壊的変更 / Breaking Changes

- `group_objects` の重なり順がドキュメント通りに直りました。配列の最初の UUID が最背面、最後が最前面です。旧版は逆だったため、旧挙動に合わせて UUID を逆順で渡していた場合は結果が反転します / `group_objects` now stacks objects as documented: the first UUID in the array is the bottommost, the last is the topmost. The old build did the opposite, so calls written for it will now produce the reversed order（@maximstark さんの報告）

### 改善 / Improvements

- 操作系ツールが Illustrator を前面に引っ張り出さなくなりました。別の作業をしながら Illustrator を動かせます。前面に出るのはトンボを描くときだけです / Editing tools no longer pull Illustrator to the front, so you can keep working in another app while it runs. Only the crop-mark tools still come forward（@const7 さんのコントリビューション）
- 時間のかかる操作を待てるようになりました。`ILLUSTRATOR_MCP_TIMEOUT_NORMAL` / `_HEAVY` を 120 秒以上に設定しても効かず、必ず 120 秒で打ち切られていた問題を直しました（環境によってはテキストの作成に数分かかる例を実測しています） / Long operations can now finish. `ILLUSTRATOR_MCP_TIMEOUT_NORMAL` / `_HEAVY` had no effect above 120 seconds, so every call was cut off there (on some systems a text operation has been measured taking minutes)
- Illustrator が応答しないときのエラーが「ビジーなのか、指定したバージョンが入っていないのか」を判断できる文面になりました / When Illustrator does not answer, the error now explains what to check instead of showing a raw script error

### バグ修正 / Bug Fixes

- SVG を編集可能な状態で読み込むと、複合パスの穴が塗り潰され、グループの中身が二重になる問題を直しました / Fixed `import_svg_as_editable` filling in the holes of compound paths and duplicating group children（@maximstark さんの報告）
- `create_gradient` で分岐点を 3 つ以上指定すると、2 番目が 100% の位置に飛ぶ問題を直しました / Fixed `create_gradient` placing the second stop at 100% when three or more stops were given（@maximstark さんの報告）
- コントラスト比の合否判定が、小数 2 桁に丸めた値で行われていました。真の比率が 4.495 でも AA 合格と表示されていたのを、丸める前の値で判定するようにしました / `check_contrast` judged WCAG pass/fail on the rounded ratio, so 4.495 was reported as passing AA. It now judges on the unrounded value
- 文字の色を塗りと線の両方まとめて置換すると、置換が中断されることがある問題を直しました / Fixed `replace_color` failing part way through when replacing both the fill and the stroke of text
- `manage_datasets` の変数 XML 書き出しが、既存ファイルを確認せず上書きしていました。他のツールと同じく `overwrite: true` が必要になりました / `manage_datasets` export now refuses to replace an existing XML file unless `overwrite: true` is given, like the other tools
- `create_line` で線幅だけを指定すると、線が引かれず何も見えない状態になる問題を直しました / Fixed `create_line` producing an invisible line when only the stroke width was given
- グループ化・重なり順の変更・レイヤー移動などの結果に入る座標が、他のツールと違う基準で返り、「アートボードに載っていない」という誤った注記が付いていた問題を直しました / Fixed the verified coordinates returned by `group_objects`, `set_z_order`, `move_to_layer` and five other tools using a different origin than every other tool, with a note that wrongly said the object was off the artboard
- アートボードの検証結果が、グループとその中身を別々に数えて件数を多く報告していた問題を直しました。入れ子のものには印が付きます / Fixed the artboard verification count adding a group and its children together; nested items are now marked
- クリッピンググループを作ると、マスクになる図形の塗りと線が失われることを、ツールの説明と実行結果に明記しました（Illustrator の操作と同じ挙動です） / `group_objects` now states, in both its description and its result, that the clip path loses its own fill and stroke (the same as making a clipping mask by hand)

### ドキュメント / Docs

- README に Codex CLI での導入手順を追加しました / Added Codex CLI setup instructions to the README

### Special Thanks

- @maximstark — #52 / #53 / #54 の詳細な不具合報告と回避策
- @const7 — 操作系ツールの前面化を外す PR（#58）
