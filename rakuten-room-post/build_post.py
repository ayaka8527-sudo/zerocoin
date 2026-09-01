#!/usr/bin/env python3
# Macが弾を作って、iPhoneの公開ページへ送る。
#
#   python3 build_post.py auto       … 時刻で決める（昼前=repost／昼から=new）
#   python3 build_post.py repost     … 朝枠むけ（貼り替え・再投稿）
#   python3 build_post.py new        … 夜枠むけ（新規投稿）
#   python3 build_post.py new --dry-run   … 作るだけで送らない
#
# 朝枠（6:00-6:25 の90件）は再投稿でも新規でもよく、夜枠（22:00-22:25 の90件）は新規。
# なので auto は 4時台=repost / 20時台=new になる。
#
# なぜこの形か（2026-09-02）:
#   iPhoneのブラウザからROOMのAPIは読めない。CORSヘッダが無いうえ、
#   `callback=` を付けても `content-type: text/plain` ＋ `nosniff` で返るので
#   <script> としても実行できない（JSONPが通らない）。
#   → 取ってくるのはMac。ただし**弾の中身を決めるのは ammo.js のまま**にする
#     （iPhoneのアプリとまったく同じもの。Mac用に書き直すと片方だけずれる）。
#
# 流れ: ①ここがAPIのページを取る → ②jsc が ammo.js を回して post.json を作る
#       → ③push.sh が公開ページへ送る
#
# ★launchd からは動かない（macOSがバックグラウンドのプロセスから ~/Documents を
#   読むのを拒否する）。Claude Codeの定期タスク room-post-build から実行する。
import datetime, json, os, subprocess, sys, time, urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(BASE, ".post_state.json")     # 棚と「もう出した」（localStorage の中身）
PAGES = os.path.join(BASE, ".pages.json")          # 取ってきたAPI応答（作業用）
OUT = os.path.join(BASE, "data", "post.json")
JSC = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc"

ME = "1000006613976117"
RIVALS = ["1000004560654348", "1000003172147482", "1000002040940305", "1000004933352353",
          "1000004149652412", "1000002955020105", "1000005404178118", "1000002662408138"]
SHELF_PAGES = 20     # ammo.js の AMMO_SHELF_PAGES と同じ
RIVAL_PAGES = 3      # ammo.js の AMMO_RIVAL_PAGES と同じ
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36"


def get(u):
    r = urllib.request.Request(u, headers={"User-Agent": UA})
    with urllib.request.urlopen(r, timeout=40) as f:
        return json.load(f)


def known_ids():
    """前回の棚にあるコレクトID。ここに当たったら読むのをやめる（ammo.js の差分読みと同じ）。"""
    try:
        st = json.load(open(STATE, encoding="utf-8"))
        shelf = json.loads(st.get("roomPostShelf") or "{}")
        return {x.get("id") for x in (shelf.get("items") or [])}
    except Exception:
        return set()


def crawl(pages, uid, limit, stop_ids=None):
    u = f"https://room.rakuten.co.jp/api/{uid}/collects?api_version=1&limit=100"
    for _ in range(limit):
        try:
            j = get(u)
        except Exception as e:
            print(f"  ⚠️ {uid} で止まりました: {e}", file=sys.stderr)
            return
        pages[u] = j
        rows = j.get("data") or []
        if not rows:
            return
        # 既に知っている投稿に当たったら、そこから先は前回ぶんなので読まない
        if stop_ids is not None and any(str(c.get("id")) in stop_ids for c in rows):
            return
        u = (j.get("meta") or {}).get("next_page") or ""
        if not u:
            return
        time.sleep(0.4)   # 詰めて叩くとROOMが絞ってくる


def main():
    kind = sys.argv[1] if len(sys.argv) > 1 else "auto"
    if kind == "auto":
        # 日本時間の昼を境に。朝枠は再投稿、夜枠は新規（[[rakuten_room_daily_180]]の枠割り）
        h = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).hour
        kind = "repost" if h < 12 else "new"
        print(f"（時刻から {kind} を選びました）")
    if kind not in ("new", "repost"):
        print("使い方: build_post.py [auto|new|repost] [--dry-run]", file=sys.stderr)
        return 2
    dry = "--dry-run" in sys.argv
    count = 90
    lead = 2

    print(f"① APIを読みます（{kind}）")
    pages = {}
    stop = known_ids()
    crawl(pages, ME, SHELF_PAGES, stop if stop else None)
    if kind == "new":
        for uid in RIVALS:
            crawl(pages, uid, RIVAL_PAGES)
    n = sum(len(v.get("data") or []) for v in pages.values())
    print(f"   {len(pages)}ページ／{n}件（棚に覚えているのは {len(stop)}件）")
    if not pages:
        print("❌ 1ページも読めませんでした（ネットワークかAPIの都合）")
        return 1
    json.dump(pages, open(PAGES, "w"), ensure_ascii=False)

    print("② 弾を組み立てます（ammo.js）")
    r = subprocess.run([JSC, "build_post.js", "--", PAGES, STATE, os.path.join(BASE, "data"),
                        kind, str(count), str(lead), OUT],
                       cwd=BASE, capture_output=True, text=True)
    os.remove(PAGES)
    if r.returncode != 0:
        print("❌ 組み立てに失敗しました\n" + (r.stderr or r.stdout))
        return 1
    print("   " + (r.stdout or "").strip())

    total = json.load(open(OUT, encoding="utf-8")).get("total", 0)
    if not total:
        print("⚠️ 弾が0件でした（条件に合うものが無い日です）。送りません")
        return 0

    if dry:
        print(f"（--dry-run なので送りません。{OUT} に {total}件）")
        return 0
    print("③ 公開ページへ送ります")
    p = subprocess.run(["bash", os.path.join(BASE, "push.sh"), "file", OUT],
                       capture_output=True, text=True)
    print("   " + (p.stdout or p.stderr).strip())
    return 0 if p.returncode == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
