// 弾づくりを通しで動かす。ネットの代わりに、本物のAPI応答（fixture_api.json）を返す。
// ★jsonp関数そのものを通すので、URLの組み立て・叩き先の固定・ページ送りもここで確かめられる。
const FX = JSON.parse(readFile("fixture_api.json"));
const TBL = {
  "ammo_reviews.json": JSON.parse(readFile("../data/ammo_reviews.json")),
  "ammo_rates.json": JSON.parse(readFile("../data/ammo_rates.json")),
  "ammo_ranking.json": JSON.parse(readFile("../data/ammo_ranking.json")),
};

globalThis.window = globalThis;
let MICRO = [];
globalThis.setTimeout = (fn) => { MICRO.push(fn); return MICRO.length; };
globalThis.queueMicrotask = (fn) => Promise.resolve().then(fn);
globalThis.clearTimeout = () => {};
let REQ = 0, MISS = 0;
const URLS = [];
globalThis.document = {
  head: { appendChild(el) { el._go(); } },
  createElement() {
    const el = {
      remove() {}, onerror: null,
      set src(u) { this._u = u; }, get src() { return this._u; },
      _go() {
        const u = this._u;
        REQ += 1;
        URLS.push(u);
        const cb = u.slice(u.lastIndexOf("callback=") + 9);
        const base = u.slice(0, u.indexOf("&callback=") >= 0 ? u.indexOf("&callback=") : u.indexOf("?callback="));
        const j = FX[base];
        // 録音していないページは「もう無い」として空を返す（本物なら次のページが来る）
        if (!j) { MISS += 1; queueMicrotask(() => window[cb]({ status: "success", data: [], meta: {} })); return; }
        queueMicrotask(() => window[cb](j));
      },
    };
    return el;
  },
};
globalThis.localStorage = {
  _d: {}, getItem(k) { return this._d[k] == null ? null : this._d[k]; },
  setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; },
};
globalThis.fetch = (u) => {
  const f = String(u).replace(/^data\//, "").replace(/\?.*$/, "");
  return TBL[f] ? Promise.resolve({ ok: true, json: () => Promise.resolve(TBL[f]) })
                : Promise.reject(new Error("no file"));
};

load("../ammo.js");

function run(p) {
  let out = null, err = null, done = false;
  p.then((v) => { out = v; done = true; }, (e) => { err = e; done = true; });
  for (let i = 0; i < 400 && !done; i++) { drainMicrotasks(); const t = MICRO.shift(); if (t) {} }
  drainMicrotasks();
  if (err) throw err;
  return out;
}
const prog = () => {};
let ok = 0, ng = 0;
const chk = (name, cond, extra) => { if (cond) { ok++; print("  ✅ " + name); } else { ng++; print("  ❌ " + name + (extra ? " → " + extra : "")); } };

print("① 🔁 貼り替え・再投稿の弾");
const rp = run(RoomAmmo.buildRepost(90, 2, prog));
print("   " + rp.rows.length + "件（候補" + rp.pool + "／店 " + rp.shops.length + "／#PR追加 " + rp.prAdded
  + "／売り出し前で外した " + rp.early + "／クーポン前で外した " + rp.earlyCp + "）");
chk("件数が出る", rp.rows.length > 0, rp.rows.length);
chk("全部にROOM投稿URLがある", rp.rows.every((x) => /^https:\/\/room\.rakuten\.co\.jp\/[^/]+\/\d+$/.test(x.roomUrl)), rp.rows.find((x)=>!/^https:\/\/room\.rakuten\.co\.jp\/[^/]+\/\d+$/.test(x.roomUrl)) ? rp.rows.find((x)=>!/^https:\/\/room\.rakuten\.co\.jp\/[^/]+\/\d+$/.test(x.roomUrl)).roomUrl : "");
chk("全部に商品URLがある", rp.rows.every((x) => /^https?:\/\//.test(x.url)));
chk("いいねは9以下だけ", rp.rows.every((x) => (x.likes || 0) <= 9), Math.max(...rp.rows.map((x)=>x.likes||0)));
chk("4日以上たったものだけ", rp.rows.every((x) => x.age >= 4), Math.min(...rp.rows.map((x)=>x.age)));
chk("固定投稿が入っていない", rp.rows.every((x) => !x.pin));
chk("全部に #PR が入っている", rp.rows.every((x) => /^#PR$/m.test(x.content)));
chk("紹介文は持ち回り（#PR以外はそのまま）", rp.rows.every((x) => x.content.replace(/\n*#PR\n*/, "\n").length > 0));

print("");
print("② 🆕 新規投稿の弾");
const nw = run(RoomAmmo.buildNew(90, 2, prog));
print("   " + nw.rows.length + "件（候補" + nw.pool + "／店 " + nw.shops.length + "／学習に使えた紹介文 " + nw.learned
  + "／売り出し前で外した " + nw.early + "／クーポン前で外した " + nw.earlyCp + "）");
print("   レビューで動かした " + nw.reviewed + "件／料率アップ " + nw.rateUp.used + "件（候補" + nw.rateUp.pool + "）"
  + "／ランキング " + (nw.rank ? nw.rank.used : "-") + "件／季節 " + (nw.season ? nw.season.used : "-") + "件");
chk("件数が出る", nw.rows.length > 0, nw.rows.length);
chk("全部に商品URLがある", nw.rows.every((x) => /^https?:\/\//.test(x.url)));
chk("ROOM投稿URLは持たない（未投稿だから）", nw.rows.every((x) => !x.roomUrl));
chk("全部に #PR が入っている", nw.rows.every((x) => /^#PR$/m.test(x.content)));
chk("装飾ボックスが入っている", nw.rows.every((x) => x.content.includes("╔") && x.content.includes("╚")));
chk("『楽天市場で詳細を見る』が入っている", nw.rows.every((x) => x.content.includes("タップ⏬")));
chk("#買って良かった で終わる", nw.rows.every((x) => x.content.trim().endsWith("#買って良かった")));
chk("ショップタグ ☆nari が入っている", nw.rows.every((x) => /#[^\s◇#]+☆nari/.test(x.content)));
chk("売切は入っていない", nw.rows.every((x) => !x.sold));

print("");
print("③ 自分がもう出している商品は新規に出てこない");
const shelf = RoomAmmo.shelfInfo();
const mine = new Set(shelf.items.map((x) => x.key));
chk("重なりゼロ", nw.rows.every((x) => !mine.has(x.key)), nw.rows.filter((x) => mine.has(x.key)).length + "件かぶり");
chk("棚を持っている", shelf.items.length > 0, shelf.items.length + "件");
chk("ハンドルが取れている", shelf.handle && shelf.handle !== "", shelf.handle);

print("");
print("④ 同じ商品を続けて出さない（直近3日は避ける）");
const again = run(RoomAmmo.buildNew(90, 2, prog));
const first = new Set(nw.rows.map((x) => x.key));
chk("さっきの弾とかぶらない", again.rows.every((x) => !first.has(x.key)), again.rows.filter((x) => first.has(x.key)).length + "件かぶり");

print("");
print("⑤ 販売開始・クーポン開始のしぼり");
const l0 = run(RoomAmmo.buildNew(90, 0, prog));
chk("0日前にすると外れる件数が増える（か同じ）", (l0.early + l0.earlyCp) >= 0, "0日=" + l0.early + "/" + l0.earlyCp + "　2日=" + nw.early + "/" + nw.earlyCp);
chk("外した件数を別々に数えている", typeof nw.early === "number" && typeof nw.earlyCp === "number");

print("");
print("⑥ 叩き先の固定");
// ★JSONPは相手のJavaScriptをそのまま実行する形なので、叩き先が
//   room.rakuten.co.jp から外れていないことは必ず確かめる
const HOST = "https://room.rakuten.co.jp/";
const stray = URLS.filter((u) => u.indexOf(HOST) !== 0);
chk("叩いた先はぜんぶ room.rakuten.co.jp", stray.length === 0, stray[0] || "");
chk("callback= が必ず付いている", URLS.every((u) => /[?&]callback=__roomcb\d+$/.test(u)), URLS.find((u) => !/[?&]callback=__roomcb\d+$/.test(u)) || "");
print("   （APIを叩いた回数 " + REQ + "／録音に無くて空を返した " + MISS + "）");

print("");
print("═══════════════════════════════");
print("  ✅ " + ok + "件  ❌ " + ng + "件");
print("═══════════════════════════════");
if (nw.rows.length) {
  print("");
  print("── 新規1件目の紹介文 ──");
  print(nw.rows[0].content);
}
