### 改善 / Improvements

- 長く使った Illustrator では、文字の色やサイズなどの属性を読み取れないことが散発的に起きます。これまでは読めなかった値を既定値で埋めて成功として返していたため、「成功したのに指定と違う」結果になっていました。読めなかったことを記録して失敗として返し、新しい参照から読み直して回復を試みるようにしました。Illustrator を再起動すると直る種類の問題です / On an Illustrator session that has been running for a while, reading text attributes such as color or size can fail sporadically. Until now those values were filled in with defaults and reported as success, so a result could differ from what was asked for. Such failures are now reported instead of hidden, and the value is re-read through a fresh reference first. Restarting Illustrator clears this kind of failure
- テキストを作ったあとに文字属性を読み返せなかった場合、作成されたこと（`created: true`）とその UUID を添えて失敗として返します。作ったかどうかが分からない状態になりません / When a text frame is created but its character attributes cannot be read back, the result reports the failure together with `created: true` and the UUID, so it is never ambiguous whether the object exists

### バグ修正 / Bug Fixes

- `resize_for_variation` でサイズ展開すると、オブジェクトの大きさは変わらないのに間隔だけ広がり、レイアウトが崩れる問題を直しました（100×100 を 200×100 にした場合、間隔が 2.67 倍になっていました）。大きさと間隔を同じ倍率で変換し、縮尺後のアートワークをアートボードの中央に置きます / Fixed `resize_for_variation` stretching the gaps between objects without scaling the objects themselves, which broke the layout (going from 100×100 to 200×100 widened the gaps 2.67×). Sizes and gaps now scale by the same factor, and the scaled artwork is centered on the target artboard
- `convert_to_outlines` でアウトライン化すると、元のテキストの名前も UUID も引き継がれず、直後にそのオブジェクトを指定できなくなっていました。`converted` に変換前後の UUID の対応を返し、名前も引き継ぎます / `convert_to_outlines` dropped the text frame's name and UUID, so the artwork could not be addressed right after converting. It now reports each `oldUuid` → `newUuid` pair in `converted` and carries the name over
