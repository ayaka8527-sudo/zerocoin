// Macで弾を作る（JavaScriptCoreで走る）。
//
//   jsc build_post.js -- <pages.json> <state.json> <data/> <kind> <count> <lead> <out.json>
//
// ★弾の中身は index.html と**まったく同じ ammo.js** が作る。
//   Mac用にロジックを書き直さない（書き直すと片方だけずれる）。
//   ここがやるのは、ブラウザのふりをして ammo.js を動かすことだけ:
//     ・document/script … ネットの代わりに build_post.py が取ってきた応答を返す
//     ・localStorage    … 棚と「もう出した」を state.json に置く（差分読みが効く）
//     ・fetch           … 並べ方の表を data/ から読む
const A = arguments;
const PAGES = A[0], STATE = A[1], DATA = A[2], KIND = A[3];
const COUNT = parseInt(A[4], 10) || 90, LEAD = parseInt(A[5], 10) || 0, OUT = A[6];

const FX = JSON.parse(readFile(PAGES));
let ST = {};
try { ST = JSON.parse(readFile(STATE)); } catch (e) { ST = {}; }

globalThis.window = globalThis;
globalThis.queueMicrotask = (fn) => Promise.resolve().then(fn);
globalThis.setTimeout = () => 0;
globalThis.clearTimeout = () => {};

let MISSED = [];
globalThis.document = {
  head: { appendChild(el) { el._go(); } },
  createElement() {
    return {
      remove() {}, onerror: null,
      set src(u) { this._u = u; }, get src() { return this._u; },
      _go() {
        const u = this._u;
        const i = u.lastIndexOf("callback=");
        const cb = u.slice(i + 9);
        const base = u.slice(0, u.lastIndexOf("&callback=") >= 0 ? u.lastIndexOf("&callback=") : u.lastIndexOf("?callback="));
        const j = FX[base];
        // 取ってきていないページは「もう無い」として空を返す（ページ送りがそこで止まる）
        if (!j) { MISSED.push(base); queueMicrotask(() => window[cb]({ status: "success", data: [], meta: {} })); return; }
        queueMicrotask(() => window[cb](j));
      },
    };
  },
};
globalThis.localStorage = {
  getItem(k) { return ST[k] == null ? null : ST[k]; },
  setItem(k, v) { ST[k] = String(v); },
  removeItem(k) { delete ST[k]; },
};
globalThis.fetch = (u) => {
  const f = String(u).replace(/^data\//, "").replace(/\?.*$/, "");
  try {
    const j = JSON.parse(readFile(DATA + "/" + f));
    return Promise.resolve({ ok: true, json: () => Promise.resolve(j) });
  } catch (e) { return Promise.reject(new Error("no file")); }
};

load("./ammo.js");

// Promise を最後まで回す（jsc にはイベントループが無いので自分で回す）
function run(p) {
  let out = null, err = null, done = false;
  p.then((v) => { out = v; done = true; }, (e) => { err = e; done = true; });
  for (let i = 0; i < 2000 && !done; i++) drainMicrotasks();
  drainMicrotasks();
  if (err) throw err;
  if (!done) throw new Error("終わりませんでした");
  return out;
}

const prog = () => {};
const r = KIND === "new"
  ? run(RoomAmmo.buildNew(COUNT, LEAD, prog))
  : run(RoomAmmo.buildRepost(COUNT, LEAD, prog));

const payload = {
  at: Date.now(),
  kind: KIND,
  total: r.rows.length,
  items: r.rows.map((x) => RoomAmmo.toItem(x, KIND)),
};
write(OUT, JSON.stringify(payload));
write(STATE, JSON.stringify(ST));

// 何がどう効いたかは必ず出す（黙って上げ下げしない・拡張と同じ鉄則）
const bits = [];
bits.push(r.rows.length + "件（候補" + r.pool + "・店" + r.shops.length + "）");
if (KIND === "repost") bits.push("#PR追加 " + r.prAdded);
if (r.reviewed != null) bits.push("レビューで " + r.reviewed + "件");
if (r.rateUp && r.rateUp.pool) bits.push("料率アップ " + r.rateUp.used + "/" + r.rateUp.pool + "件");
if (r.rank) bits.push(r.rank.days < 3 ? "ランキング未使用(" + r.rank.days + "日)" : "ランキング " + r.rank.used + "件");
if (r.season) bits.push(r.season.ready ? "季節 " + r.season.used + "件" : "季節まだ");
if (r.presaleUsed) bits.push("先行セール " + r.presaleUsed + "件");
bits.push("売り出し前で外した " + r.early + "件");
bits.push("クーポン前で外した " + r.earlyCp + "件");
print(bits.join(" / "));
if (MISSED.length) print("（ページ送りが止まった先 " + MISSED.length + "件）");
