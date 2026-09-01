#!/bin/bash
# iPhone投稿アプリのテスト。
#   cd ~/Documents/zerocoin/rakuten-room-post/tests && ./run.sh
#
# ① cmp.js … 弾の判定が、Chrome拡張（background.js）と一致するかを実データで突き合わせる
# ② e2e.js … 弾づくりを通しで動かす（ネットの代わりに録音した本物のAPI応答を返す）
#
# JavaScriptCore（macOS標準・インストール不要）で動きます。
set -e
cd "$(dirname "$0")"
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
[ -x "$JSC" ] || { echo "❌ JavaScriptCore が見つかりません"; exit 1; }

[ -f fixture_api.json ] || { echo "📡 録音がないので取りに行きます（数分かかります）"; python3 capture.py; }
[ -f fixture_names.json ] || python3 capture.py
python3 extract.py

FAIL=0
for f in cmp.js e2e.js; do
  echo; echo "── $f ──"
  OUT=$("$JSC" "$f") || FAIL=1
  echo "$OUT"
  # まとめ行は cmp.js が「❌ 食い違い 0」、e2e.js が「❌ 0件」
  echo "$OUT" | grep -qE "❌ (0件|食い違い 0)" || FAIL=1
done
echo
if [ "$FAIL" = "0" ]; then echo "🎉 ぜんぶ通りました"; else echo "⚠️ 失敗したテストがあります"; exit 1; fi
