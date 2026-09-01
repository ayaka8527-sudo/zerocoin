// 拡張（background.js）と iPhoneアプリ（ammo.js）の判定が一致するか、実データで突き合わせる。
// 実行: jsc cmp.js

// ── ammo.js を、ブラウザのふりをして読み込む ──
globalThis.window = globalThis;
globalThis.document = {
  createElement: () => ({ remove(){}, style:{}, }),
  head: { appendChild(){} },
};
globalThis.localStorage = {
  _d:{}, getItem(k){ return this._d[k] == null ? null : this._d[k]; },
  setItem(k,v){ this._d[k]=String(v); }, removeItem(k){ delete this._d[k]; },
};
globalThis.fetch = () => Promise.reject(new Error("no net"));
globalThis.setTimeout = () => 0;
globalThis.clearTimeout = () => {};
load("../ammo.js");
const A = window.RoomAmmo._;

// ── background.js から、比べたい関数だけを切り出したもの（bg_extract.js）──
const B = {};
new Function("E", readFile("bg_extract.js") + "\nObject.assign(E,{zkMaxDiscount,capPrice,capDeadline,capBanner,capStar,ammoCouponStart,ammoCouponTooEarly,ammoTooEarly,ammoEnsurePr,ammoLearn,ammoCaption,ammoReviewMul,daysBetween,ammoShopOf});")(B);

// ── 突き合わせ ──
const fx = JSON.parse(readFile("fixture_names.json"));
let ok = 0, ng = 0;
const bad = [];
function cmp(label, a, b, ctx) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa === sb) { ok++; return; }
  ng++;
  if (bad.length < 8) bad.push(label + "\n   拡張: " + sb + "\n   アプリ: " + sa + "\n   ← " + ctx.slice(0, 90));
}

const NOW = new Date(2026, 8, 2, 12, 0, 0); // 2026-09-02 12:00 で固定して比べる
for (const x of fx.names) {
  const n = x.name;
  cmp("zkMaxDiscount", A.zkMaxDiscount(n), B.zkMaxDiscount(n), n);
  cmp("capPrice", A.capPrice(n), B.capPrice(n), n);
  cmp("capDeadline", A.capDeadline(n, NOW), B.capDeadline(n, NOW), n);
  cmp("ammoCouponStart", A.ammoCouponStart(n, NOW), B.ammoCouponStart(n, NOW), n);
  cmp("ammoCouponTooEarly", A.ammoCouponTooEarly(n, 2, NOW), B.ammoCouponTooEarly(n, 2, NOW), n);
  for (const lead of [0, 2, 7]) cmp("ammoTooEarly", A.ammoTooEarly(x.st, lead), B.ammoTooEarly(x.st, lead), n);
  // バナーは日付をまたぐと変わるので、比べるのは同じ now を渡したとき
  cmp("capBanner", A.capBanner({ name: n, reviewN: 120, reviewAvg: 4.5 }, NOW),
                   B.capBanner({ name: n, reviewN: 120, reviewAvg: 4.5 }, NOW), n);
}
for (const c of fx.contents) cmp("ammoEnsurePr", A.ammoEnsurePr(c), B.ammoEnsurePr(c), c.split("\n")[0]);
for (const [rc, ra] of [[0,0],[9,4.5],[30,3.5],[120,4.4],[600,4.9],[600,3.7],[null,0]]) {
  cmp("ammoReviewMul", A.ammoReviewMul(rc, ra), B.ammoReviewMul(rc, ra), rc + "/" + ra);
}

// ammoLearn / ammoCaption は棚まるごとで比べる
const shelf = fx.contents.map((c, i) => ({
  content: c, key: (["llic","antelp","kiroran","e-kit"][i % 4]) + ":" + (10000 + i),
  cid: "c" + (i % 7), c2: "b" + (i % 3), c1: "a" + (i % 2), name: fx.names[i % fx.names.length].name,
}));
const la = A.ammoLearn(shelf), lb = B.ammoLearn(shelf);
cmp("ammoLearn.learned", la.learned, lb.learned, "棚" + shelf.length + "件");
for (const it of shelf.slice(0, 120)) {
  cmp("ammoLearn.catOf", la.catOf(it), lb.catOf(it), it.key);
  cmp("ammoLearn.shopOf", la.shopOf(it.key), lb.shopOf(it.key), it.key);
  cmp("ammoCaption", A.ammoCaption(it, la), B.ammoCaption(it, lb), it.name);
}

print("═══════════════════════════════");
print("  商品名 " + fx.names.length + "件 ・ 紹介文 " + fx.contents.length + "件で突き合わせ");
print("  ✅ 一致 " + ok + " ／ ❌ 食い違い " + ng);
print("═══════════════════════════════");
for (const b of bad) print("\n" + b);
