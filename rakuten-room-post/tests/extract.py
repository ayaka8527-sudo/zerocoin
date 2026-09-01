#!/usr/bin/env python3
# 拡張の background.js から、突き合わせたい関数だけを抜き出して bg_extract.js を作る。
# （まるごと読むと chrome.* が要るため）
import io, re
SRC = "/Users/ayakahayakawa/Desktop/楽天ROOM巡回ナビ拡張/background.js"
NAMES = ["ZK_YEN", "ZK_SHOPWIDE", "ZK_CLOSE", "zkDiscountCands", "zkMaxDiscount",
         "capDiscountPct", "capPrice", "capDeadline", "capStar", "capBanner",
         "AMMO_CP_START", "ammoCouponStart", "ammoCouponTooEarly", "ammoTooEarly",
         "ammoEnsurePr", "ammoShopOf", "ammoLearn", "ammoCaption",
         "CAP_CTA", "CAP_BOX_TOP", "CAP_BOX_BTM",
         "AMMO_REVIEW_MUL", "AMMO_STAR_GOOD", "AMMO_STAR_GOOD_MUL", "AMMO_STAR_BAD",
         "AMMO_STAR_BAD_MUL", "ammoReviewMul", "jstDayStr", "daysBetween"]
src = io.open(SRC, encoding="utf-8").read().split("\n")
out = []
for n in NAMES:
    pat = re.compile(r'^(?:const |let )' + re.escape(n) + r'\b|^(?:async )?function ' + re.escape(n) + r'\s*\(')
    start = next((i for i, l in enumerate(src) if pat.match(l)), None)
    assert start is not None, "見つかりません: " + n
    i, depth = start, 0
    while i < len(src):
        l = src[i]
        depth += l.count("{") + l.count("[") + l.count("(") - l.count("}") - l.count("]") - l.count(")")
        if depth <= 0 and (l.rstrip().endswith(";") or l.rstrip().endswith("}")):
            break
        i += 1
    out.append("\n".join(src[start:i + 1]))
io.open("bg_extract.js", "w", encoding="utf-8").write("\n".join(out))
print(f"抜き出し {len(NAMES)}個")
