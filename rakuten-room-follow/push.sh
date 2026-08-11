#!/bin/bash
# クリップボードにある「iPhoneへ渡す」の中身を、公開ページに置いて反映する。
#
#   1. 拡張のポップアップで「📱 iPhoneへ渡す」を押す（クリップボードに入る）
#   2. このスクリプトを実行する
#   3. iPhoneのアプリで「🌐 最新のリストを取り込む」を押す
#
# ★貼り付けでも使えるので、これは「毎回貼るのが面倒」なとき用です。
#   Handoffが効いていれば、Macでコピー→iPhoneでそのまま貼る、でも同じことができます。
set -euo pipefail
cd "$(dirname "$0")"

TMP=$(mktemp)
pbpaste > "$TMP"

# 中身が「フォロー回りのリスト」かどうかを確かめてから置く（変なものを公開しないため）
python3 - "$TMP" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
items = d.get("items")
if not isinstance(items, list) or not items:
    raise SystemExit("❌ クリップボードの中身がフォロー回りのリストではありません")
if not all(isinstance(x, dict) and x.get("h") for x in items):
    raise SystemExit("❌ 中身の形がちがいます")
print(f"✅ {len(items)}人ぶん")
PY

mkdir -p data
cp "$TMP" data/follow.json
rm -f "$TMP"

git add data/follow.json
if git diff --cached --quiet; then
  echo "変わっていないので、そのままにします"
  exit 0
fi
git commit -q -m "フォロー回り（iPhone）：リストを更新"
git push -q
echo "✅ 公開しました → https://ayaka8527-sudo.github.io/zerocoin/rakuten-room-follow/"
