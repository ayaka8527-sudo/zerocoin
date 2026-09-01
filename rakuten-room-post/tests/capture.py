#!/usr/bin/env python3
# テスト用に、本物のROOM APIの応答を録音する。
#   cd ~/Documents/zerocoin/rakuten-room-post/tests && python3 capture.py
#
# 作るもの（どちらもgit管理外。38MBほどになる）:
#   fixture_api.json   … /collects の応答そのまま（自分14ページ＋競合8人×3ページ）
#   fixture_names.json … 商品名と紹介文だけを抜いたもの（判定の突き合わせ用）
#
# ★自分の棚は14ページ（1,400件）以上録ること。1日180投稿しているので、
#   4ページだと「4日以上たった投稿」が1件も無くなり、再投稿のテストが空振りする。
import json, urllib.request, time, os

ME = "1000006613976117"
RIVALS = ["1000004560654348", "1000003172147482", "1000002040940305", "1000004933352353",
          "1000004149652412", "1000002955020105", "1000005404178118", "1000002662408138"]

def get(u):
    r = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"})
    return json.load(urllib.request.urlopen(r, timeout=40))

CAP = json.load(open("fixture_api.json")) if os.path.exists("fixture_api.json") else {}

def crawl(uid, pages):
    u = f"https://room.rakuten.co.jp/api/{uid}/collects?api_version=1&limit=100"
    for _ in range(pages):
        if u in CAP:
            j = CAP[u]
        else:
            try:
                j = get(u)
            except Exception as e:
                print("skip", u[:60], e); return
            CAP[u] = j; time.sleep(0.4)
        u = (j.get("meta") or {}).get("next_page") or ""
        if not u: break

crawl(ME, 14)
for uid in RIVALS:
    crawl(uid, 3)
json.dump(CAP, open("fixture_api.json", "w"), ensure_ascii=False)

names, contents, seen = [], [], set()
for v in CAP.values():
    for c in v.get("data") or []:
        it = c.get("item") or {}
        n = it.get("name")
        if n and n not in seen:
            seen.add(n); names.append({"name": n, "st": it.get("start_time") or 0})
        if c.get("content"): contents.append(c["content"])
json.dump({"names": names, "contents": contents[:400]},
          open("fixture_names.json", "w"), ensure_ascii=False)
print(f"録音 {len(CAP)} リクエスト／商品名 {len(names)}件／紹介文 {len(contents[:400])}件")
