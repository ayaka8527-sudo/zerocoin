#!/bin/bash
# ダウンロードされた post.json を、iPhoneが読む公開ページに置く。
#
# 流れ（**貼り付けは不要**）
#   1. 拡張の「弾をそろえる」が終わると、自分で post.json を保存する（背側から）
#   2. 定期タスク room-post-to-phone がそれを見つけて、このスクリプトを走らせる
#   3. iPhoneのアプリは開いたときに最新を読む
#
# 手で走らせることもできる：
#   引数なし … ダウンロードにある post.json を取り込む
#   pbpaste  … クリップボードの中身を取り込む（「📱 iPhoneへ渡す」でコピーしたとき）
set -euo pipefail
cd "$(dirname "$0")"

DL="$HOME/Downloads"
TMP=$(mktemp)
SRC=""

if [ "${1:-}" = "pbpaste" ]; then
  pbpaste > "$TMP"
  SRC="クリップボード"
else
  # Chromeは同じ名前で2回目以降 "post (1).json" のように付け足すので、新しいものを拾う
  FOUND=$(ls -t "$DL"/post*.json 2>/dev/null | head -1 || true)
  if [ -z "$FOUND" ]; then
    echo "ダウンロードに post.json がありません（何もしません）"
    exit 0
  fi
  cp "$FOUND" "$TMP"
  SRC="$FOUND"
fi

# 中身が投稿の弾リストか確かめてから置く（変なものを公開しないため）
python3 - "$TMP" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
items = d.get("items")
if not isinstance(items, list) or not items:
    raise SystemExit("❌ 投稿の弾リストではありません")
# c=識別子は必須。開く先（商品URL u / 自分の投稿 o）がどちらも無い行は回れない
if not all(isinstance(x, dict) and x.get("c") and (x.get("u") or x.get("o")) for x in items):
    raise SystemExit("❌ 中身の形がちがいます")
print(f"✅ {len(items)}件ぶん（{d.get('kind') or '種別なし'}）")
PY

mkdir -p data
cp "$TMP" data/post.json
rm -f "$TMP"
# 取り込んだら、ダウンロードのほうは片づける（同じものを何度も拾わないため）
if [ "${1:-}" != "pbpaste" ]; then rm -f "$DL"/post*.json; fi

git add data/post.json
if git diff --cached --quiet; then
  echo "中身が同じなので、そのままにします（$SRC）"
  exit 0
fi
git -c user.email=ayaka8527@gmail.com commit -q -m "投稿（iPhone）：弾リストを更新"
git push -q
echo "✅ 公開しました → https://ayaka8527-sudo.github.io/zerocoin/rakuten-room-post/"
