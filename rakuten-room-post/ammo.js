// 楽天ROOM 投稿（iPhone）— 弾をそろえる
//
// ★これは Chrome拡張「楽天ROOM巡回ナビ」の background.js の弾づくりを、
//   そのままiPhoneのSafariへ引っ越したもの。判定は**一字一句そろえてある**。
//   片方だけ直すと噛み合わなくなるので、直すときは必ず両方直すこと。
//
// なぜiPhoneだけで作れるのか（2026-09-02に確認）:
//   ROOMのAPIは CORSヘッダを返さない＝ふつうの fetch では読めない。
//   ところが `&callback=` を付けると **JSONP** で返ってくるので、
//   <script> タグなら読める。サーバーもGitHub Actionsも要らない。
//   ★JSONPは相手のJavaScriptをそのまま実行する形なので、叩き先は
//     room.rakuten.co.jp に**固定**する（URLを外から差し込ませない）。
//
// 使わないもの（Macの拡張との違い。意図的に外している）:
//   ・売れた実績の重み … 報酬額が入っていて、このリポジトリは公開なので置かない
//   ・料率アップの別枠 … 材料（ammo_campaign.json）に期限があり、iPhoneだけでは更新できない

(function (global) {
  "use strict";

  // ── 定数（拡張と同じ値。変えるときは background.js も同時に）─────────
  const AMMO_SLOT = 90;          // 1枠の件数。ROOMの上限は1時間100件なので10件の余裕
  const AMMO_RIVAL_PAGES = 3;    // 競合1人あたり読むページ数（100件×3＝直近およそ3日ぶん）
  const AMMO_SHELF_PAGES = 20;   // 自分の棚を最初に読むときの上限（100件×20＝2,000件）
  const AMMO_USED_DAYS = 3;      // 直近何日ぶんを「もう出した」として避けるか
  const AMMO_MIN_AGE_D = 4;      // 再投稿に回すのは何日たってから
  const AMMO_MAX_LIKES = 9;      // いいね10以上は貼り替えると減る（実測 -38%）ので触らない
  const AMMO_SHELF_MAX = 2000;   // 手元に置く棚の上限（Safariのlocalstorageは5MBほど）

  const AMMO_RATES_BUILTIN = {
    decori: 20, "e-kit": 20, llic: 20, mochikuma: 20, radianne: 20, kiroran: 20,
    tmartr: 20, darkangel: 20, ideazakkaten: 20, luluhope: 20, "kurashi-zakka": 17.6,
    azusa: 16, eunicedress: 15.3, "la-gemme": 15, "chakasho-dina": 15, amely: 15,
    soutowelshop: 11, "auc-risecreation": 10, kashiwa01: 6, ponopono: 5, iijo: 4.9,
    sljapan1: 4, teddyshop: 4, "imoto-sports": 4, catherine: 4, devirockstore: 4,
    mamababy: 4, "babykids-hrt": 4, "irisplaza-r": 4, "marine-blue": 4,
    "es-toys": 3, gelaskins: 2.1, chinavi: 2,
  };
  const AMMO_RATE_UNKNOWN = 8;

  const AMMO_REVIEW_MUL = [[500, 1.8], [100, 1.4], [30, 1.0], [10, 0.7], [0, 0.45]];
  const AMMO_STAR_GOOD = 4.3, AMMO_STAR_GOOD_MUL = 1.2;
  const AMMO_STAR_BAD = 3.8, AMMO_STAR_BAD_MUL = 0.8;

  const AMMO_RANK_MIN_DAYS = 3;
  const AMMO_RANK_SHOP_MUL = [[0.5, 1.3], [0.15, 1.15], [0, 1.0]];
  const AMMO_SEASON_OUT_MUL = 0.7;
  const AMMO_SEASON_GONE_AVG = 0.5;
  const AMMO_WORD_RE = /[ァ-ヴー]{2,}|[一-龥]{2,}/g;

  const AMMO_PRESALE_BOOST = 1.8;
  const AMMO_PRESALE_FROM = 0;
  const AMMO_PRESALE_TO = 1;

  const CAP_CTA = "詳しくは『楽天市場で詳細を見る』をタップ⏬";
  const CAP_BOX_TOP = "╔═════❖•ೋ ° °ೋ•❖═════╗";
  const CAP_BOX_BTM = "╚═════❖•ೋ ° °ೋ•❖═════╝";

  // 自分と、弾の出どころになる競合（follower_watch.py の USERS と同じ並び）
  const ME_ID = "1000006613976117";
  const ME_HANDLE = "room_4c0290bf5b";
  const RIVALS = [
    "1000004560654348", // ことり
    "1000003172147482",
    "1000002040940305",
    "1000004933352353",
    "1000004149652412", // 超かぐら
    "1000002955020105",
    "1000005404178118", // ながと
    "1000002662408138", // あんバタ子
  ];

  // ── 日付（すべてJSTで数える）────────────────────────────────
  const jstDayStr = (ts) => new Date(ts + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const todayJst = () => jstDayStr(Date.now());
  function daysBetween(fromDay, toDay) {
    const a = Date.parse(fromDay + "T00:00:00+09:00");
    const b = Date.parse(toDay + "T00:00:00+09:00");
    if (isNaN(a) || isNaN(b)) return 9999;
    return Math.round((b - a) / 86400000);
  }
  const ammoShopOf = (key) => String(key || "").split(":")[0];

  // ── JSONPで叩く ────────────────────────────────────────
  // ★叩き先は room.rakuten.co.jp に固定する。JSONPは相手のJSを実行するので、
  //   next_page で返ってきたURLでも必ずここを通す
  let cbN = 0;
  const API_HOST = "https://room.rakuten.co.jp/";
  function jsonp(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (String(url).indexOf(API_HOST) !== 0) { reject(new Error("叩き先が違います")); return; }
      const cb = "__roomcb" + ++cbN;
      const s = document.createElement("script");
      let done = false;
      const clean = () => { try { delete global[cb]; } catch (e) { global[cb] = undefined; } s.remove(); };
      const to = setTimeout(() => {
        if (done) return; done = true; clean(); reject(new Error("時間切れ"));
      }, timeoutMs || 25000);
      global[cb] = (j) => { if (done) return; done = true; clearTimeout(to); clean(); resolve(j); };
      s.onerror = () => { if (done) return; done = true; clearTimeout(to); clean(); reject(new Error("つながりません")); };
      s.src = url + (url.indexOf("?") >= 0 ? "&" : "?") + "callback=" + cb;
      document.head.appendChild(s);
    });
  }
  const collectsUrl = (id) => API_HOST + "api/" + id + "/collects?api_version=1&limit=100";

  // ── 並べ方の表（data/ に置いてある静的ファイル。同一オリジンなのでCORSは関係ない）──
  // ★無くても弾は作れる（重みが付かないだけ）。古くても壊れない。
  //   いつの表かは画面に出す（黙って効かせない・拡張と同じ鉄則）
  let TABLES = null;
  async function tables() {
    if (TABLES) return TABLES;
    const one = async (f, pick) => {
      try {
        const r = await fetch("data/" + f + "?t=" + Date.now(), { cache: "no-store" });
        if (!r.ok) return null;
        return pick(await r.json());
      } catch (e) { return null; }
    };
    const [revs, irates, rk] = await Promise.all([
      one("ammo_reviews.json", (j) => (j && j.r) || j || {}),
      one("ammo_rates.json", (j) => j || null),
      one("ammo_ranking.json", (j) => (j && j.shop ? j : null)),
    ]);
    TABLES = {
      revs: revs || {},
      irates: (irates && irates.r) || {},
      ratesMade: (irates && irates.made) || "",
      rk: rk || null,
    };
    return TABLES;
  }

  // ── 手元の控え（棚と「もう出した」）──────────────────────────
  const SHELF_KEY = "roomPostShelf";
  const USED_KEY = "roomPostUsed";
  const jload = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  function jsave(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) {
      // 入りきらなければ棚を半分にして入れ直す（Safariは5MBほどで頭を打つ）
      if (v && Array.isArray(v.items) && v.items.length > 200) {
        v.items = v.items.slice(0, Math.floor(v.items.length / 2));
        return jsave(k, v);
      }
      return false;
    }
  }

  function usedKeys() {
    const used = jload(USED_KEY, {});
    const out = new Set();
    const today = todayJst();
    for (const d of Object.keys(used)) {
      if (daysBetween(d, today) <= AMMO_USED_DAYS) for (const k of used[d]) out.add(k);
    }
    return out;
  }
  function remember(keys) {
    const used = jload(USED_KEY, {});
    const today = todayJst();
    const set = new Set((used[today] || []).concat(keys));
    used[today] = Array.from(set);
    for (const d of Object.keys(used)) if (daysBetween(d, today) > AMMO_USED_DAYS) delete used[d];
    jsave(USED_KEY, used);
  }

  // ── 販売開始前・クーポン開始前（拡張 v1.97.0 / v2.1.0 をそのまま）──────
  function ammoTooEarly(start, leadDays) {
    const n = Number(start);
    if (!n || !isFinite(n)) return false;
    return n * 1000 - Date.now() > leadDays * 86400000;
  }

  // ★拾うのは「日付のうしろが 〜／～／から／開始／スタート」だけ。
  //   『9/4 19:59まで』は**終わり**なので拾わない（間違えると、もう始まっている
  //   クーポンの商品まで消えて弾が痩せる）。
  // ★「クーポン」の語がある商品名だけを見る（`綿100%` を割引と読んだ罠と同じ）
  // ★読み取れないものは**落とさない**
  const AMMO_CP_START = new RegExp(
    "(?:(\\d{1,2})\\s*[/／]\\s*(\\d{1,2})|(\\d{1,2})\\s*日)" +
      "\\s*(?:(\\d{1,2})\\s*(?::\\s*(\\d{2})|時(?:\\s*(\\d{1,2})\\s*分)?))?" +
      "\\s*(?:〜|～|~|ー~|から|より|開始|スタート|START|start)",
    "g"
  );
  function ammoCouponStart(name, now) {
    const s = String(name || "");
    if (!s.includes("クーポン")) return 0;
    const today = now || new Date();
    let best = null;
    for (const m of s.matchAll(AMMO_CP_START)) {
      const hh = m[4] == null ? 0 : parseInt(m[4], 10);
      const mm = m[5] != null ? parseInt(m[5], 10) : m[6] != null ? parseInt(m[6], 10) : 0;
      if (hh > 23 || mm > 59) continue;
      let d = null;
      if (m[1] != null) {
        const mo = parseInt(m[1], 10), dy = parseInt(m[2], 10);
        if (mo < 1 || mo > 12 || dy < 1 || dy > 31) continue;
        for (const y of [today.getFullYear(), today.getFullYear() + 1]) {
          const c = new Date(y, mo - 1, dy, hh, mm, 0, 0);
          if ((c - today) / 86400000 >= -200) { d = c; break; }
        }
      } else {
        const dy = parseInt(m[3], 10);
        if (dy < 1 || dy > 31) continue;
        d = new Date(today.getFullYear(), today.getMonth(), dy, hh, mm, 0, 0);
        if ((d - today) / 86400000 < -5) d = new Date(today.getFullYear(), today.getMonth() + 1, dy, hh, mm, 0, 0);
        if (d.getDate() !== dy) continue;
      }
      if (!d) continue;
      if (!best || d < best) best = d;
    }
    return best ? best.getTime() : 0;
  }
  function ammoCouponTooEarly(name, leadDays, now) {
    const t = ammoCouponStart(name, now);
    if (!t) return false;
    return t - (now ? now.getTime() : Date.now()) > leadDays * 86400000;
  }
  function ammoDayOf(startTime) {
    const n = Number(startTime);
    if (!n || !isFinite(n)) return "";
    return jstDayStr(n * 1000);
  }

  // ── 割引率（拡張の zkDiscountCands / zkMaxDiscount をそのまま）────────
  // ★「綿100%」「UVカット率99%」を割引と読まないこと。OFF・クーポン・割引・セールが
  //   隣にある % だけを見る。**商品個別のクーポンを優先する**（店内全品より）
  const ZK_YEN = /([\d,]{3,7})\s*円(?!\s*(?:OFF|オフ|引き|割引|クーポン))/gi;
  const ZK_SHOPWIDE = /店内|全品|全商品|全アイテム|ショップ内|店舗内/;
  const ZK_CLOSE = ["】", "》", "］", "]", "）", ")", "＞", ">"];
  function zkDiscountCands(name) {
    const s = String(name || "");
    const out = [];
    const push = (pct, i) => {
      if (!(pct >= 1 && pct <= 99)) return;
      let pre = s.slice(Math.max(0, i - 30), i);
      let cut = -1;
      for (const c of ZK_CLOSE) cut = Math.max(cut, pre.lastIndexOf(c));
      if (cut >= 0) pre = pre.slice(cut + 1);
      out.push({ pct, shopWide: ZK_SHOPWIDE.test(pre) });
    };
    let m;
    const a = /(\d+(?:\.\d+)?)\s*[%％]\s*(?:OFF|オフ|割引|引き|クーポン)/gi;
    while ((m = a.exec(s))) push(parseFloat(m[1]), m.index);
    const b = /(?:クーポン|OFF|オフ|セール|割引)[^0-9]{0,6}(\d+(?:\.\d+)?)\s*[%％]/gi;
    while ((m = b.exec(s))) push(parseFloat(m[1]), m.index);
    return out;
  }
  function zkMaxDiscount(name) {
    const c = zkDiscountCands(name);
    if (!c.length) return 0;
    const own = c.filter((x) => !x.shopWide);
    const use = own.length ? own : c;
    return Math.max(...use.map((x) => x.pct));
  }

  // ── お得情報バナー（拡張 v1.87.0）──────────────────────────
  function capPrice(name) {
    const s = String(name || "");
    let last = null;
    for (const m of s.matchAll(/([\d,]{3,7})\s*円?\s*[→⇒]\s*([\d,]{3,7})\s*円/g)) last = m;
    if (last) return parseInt(last[2].replace(/,/g, ""), 10);
    const range = s.match(/([\d,]{3,7})\s*円?\s*[～〜~]\s*([\d,]{3,7})\s*円/);
    if (range) return parseInt(range[1].replace(/,/g, ""), 10);
    const set = new Set();
    for (const m of s.matchAll(new RegExp(ZK_YEN.source, "gi"))) {
      set.add(parseInt(m[1].replace(/,/g, ""), 10));
    }
    return set.size === 1 ? [...set][0] : null;
  }
  // ★まで／迄 が付いている＝終わりの日が決まっているものだけ拾う（日替わりクーポンを入れない）
  function capDeadline(name, now) {
    const s = String(name || "");
    const today = now || new Date();
    let best = null;
    for (const m of s.matchAll(/(\d{1,2})\s*\/\s*(\d{1,2})\s*(?:\d{1,2}\s*(?::\d{2}|時))?\s*(?:まで|迄)/g)) {
      const mo = parseInt(m[1], 10), dy = parseInt(m[2], 10);
      if (mo < 1 || mo > 12 || dy < 1 || dy > 31) continue;
      for (const y of [today.getFullYear(), today.getFullYear() + 1]) {
        const d = new Date(y, mo - 1, dy);
        if ((d - today) / 86400000 >= -200) { if (!best || d < best) best = d; break; }
      }
    }
    return best ? (best.getMonth() + 1) + "/" + best.getDate() : null;
  }
  // レビュー要件：5件以上 かつ 星4超のときだけ ☆スコアを出す（ハウススタイル）
  function capStar(it) {
    const n = Number(it.reviewN || 0), a = Number(it.reviewAvg || 0);
    return n >= 5 && a > 4 ? a.toFixed(2).replace(/0$/, "") : null;
  }
  function capBanner(it, now) {
    const pct = zkMaxDiscount(it.name);
    if (!pct) return null;               // 読み取れないならバナーを出さない
    const parts = [pct === 50 ? "半額クーポン対象" : pct + "%OFFクーポン対象"];
    const price = capPrice(it.name);
    if (price) parts.push(price.toLocaleString("en-US") + "円");
    const due = capDeadline(it.name, now);
    if (due) parts.push(due + "まで");
    const star = capStar(it);
    if (star) parts.push("☆" + star);
    return "🌸" + parts.join("・") + "✨️🉐🌸";
  }

  // ★既存の紹介文はここ以外いじらない。書き換えると「再投稿が効いた」のか
  //   「文を変えたのが効いた」のか分からなくなる
  function ammoEnsurePr(content) {
    const c = String(content || "");
    if (/^#PR$/m.test(c)) return c;
    const lines = c.split("\n");
    const i = lines.findIndex((ln) => ln.includes("タップ⏬"));
    if (i >= 0) { lines.splice(i + 1, 0, "", "#PR"); return lines.join("\n"); }
    const j = lines.findIndex((ln) => /^╔/.test(ln.trim()));
    if (j >= 0) { lines.splice(j, 0, "#PR", ""); return lines.join("\n"); }
    return c + "\n\n#PR";
  }

  // ── 棚から学ぶ（カテゴリID→#nari_タグ、ショップコード→表示名）────────
  function ammoLearn(items) {
    const cat = { cid: new Map(), c2: new Map(), c1: new Map() };
    const shop = new Map();
    let learned = 0;
    const bump = (m, k, v) => {
      if (!k || !v) return;
      if (!m.has(k)) m.set(k, new Map());
      const c = m.get(k);
      c.set(v, (c.get(v) || 0) + 1);
    };
    for (const x of items) {
      const c = x.content || "";
      const tags = (c.match(/#nari_[^\s◇]+/g) || []).map((t) => t.slice(1));
      if (tags.length) {
        learned += 1;
        for (const t of tags) { bump(cat.cid, x.cid, t); bump(cat.c2, x.c2, t); bump(cat.c1, x.c1, t); }
      }
      const m = c.match(/#([^\s◇#]+)☆nari/);
      if (m) bump(shop, ammoShopOf(x.key), m[1]);
    }
    const top = (m, k) => {
      const c = m.get(k);
      if (!c) return null;
      let best = null, n = -1;
      for (const [v, cnt] of c) if (cnt > n) { best = v; n = cnt; }
      return best;
    };
    return {
      learned,
      // 細かいカテゴリから順に引く。実測の当たり率は cid 90% → c2 80% → c1 61%
      catOf: (it) => top(cat.cid, it.cid) || top(cat.c2, it.c2) || top(cat.c1, it.c1) || null,
      // 名前が分からない店はコードのまま（ハウススタイルの決まり）
      shopOf: (key) => top(shop, ammoShopOf(key)) || ammoShopOf(key),
    };
  }

  function ammoCaption(it, learn) {
    const cat = learn.catOf(it);
    const box = [CAP_BOX_TOP, "他にもおススメはこちら🔽"];
    if (cat) box.push("◆◇ #" + cat + " ◇◆");
    box.push("◆◇ #" + learn.shopOf(it.key) + "☆nari ◇◆");
    box.push(CAP_BOX_BTM);
    const banner = capBanner(it);
    const head = banner ? [banner, "", it.name || ""] : [it.name || ""];
    return [...head, "", CAP_CTA, "", "#PR", "", box.join("\n"), "", "#買って良かった"].join("\n");
  }

  // ── 重みづけ ──────────────────────────────────────────
  function ammoReviewMul(rc, ra) {
    if (rc == null) return 1;
    let m = 1;
    for (const [lo, mul] of AMMO_REVIEW_MUL) { if (rc >= lo) { m *= mul; break; } }
    if (ra >= AMMO_STAR_GOOD) m *= AMMO_STAR_GOOD_MUL;
    else if (ra && ra < AMMO_STAR_BAD) m *= AMMO_STAR_BAD_MUL;
    return m;
  }
  function ammoRankShopMul(rk, shop) {
    if (!rk || !shop) return 1;
    const days = rk.days || 0;
    if (days < AMMO_RANK_MIN_DAYS) return 1;
    const hit = rk.shop && rk.shop[shop];
    if (!hit) return 1;
    const ratio = hit / days;
    for (const [lo, mul] of AMMO_RANK_SHOP_MUL) { if (ratio >= lo) return mul; }
    return 1;
  }
  function ammoSeasonMul(rk, name) {
    if (!rk || !rk.ready || !rk.word || !name) return [1, ""];
    const ws = String(name).match(AMMO_WORD_RE) || [];
    for (const w of ws) {
      const v = rk.word[w];
      if (v && v[0] === 0 && v[1] >= AMMO_SEASON_GONE_AVG) return [AMMO_SEASON_OUT_MUL, w];
    }
    return [1, ""];
  }
  function ammoMark(items, revs, todayStr, rk) {
    const n = { presale: 0, rank: 0, season: 0, reviewed: 0 };
    for (const it of items) {
      const r = revs[it.key];
      it.rmul = Array.isArray(r) ? ammoReviewMul(r[0], r[1]) : 1;
      if (it.rmul !== 1) n.reviewed += 1;
      it.kmul = ammoRankShopMul(rk, it.shop || ammoShopOf(it.key));
      if (it.kmul !== 1) n.rank += 1;
      const [zmul, zword] = ammoSeasonMul(rk, it.name);
      it.zmul = zmul; it.zword = zword;
      if (zmul !== 1) n.season += 1;
      it.presale = false;
      if (it.start) {
        const d = daysBetween(ammoDayOf(it.start), todayStr);
        if (d >= AMMO_PRESALE_FROM && d <= AMMO_PRESALE_TO) { it.presale = true; n.presale += 1; }
      }
    }
    return n;
  }
  // ★売れた実績（smul）はここには無い。報酬額を公開リポジトリに置かないため（2026-09-02の決定）
  function ammoScore(it, rate) {
    let s = rate;
    if (it.who > 1) s *= 1.08;
    if (it.price >= 3000 && it.price <= 5000) s *= 1.1;
    else if (it.price && it.price < 1000) s *= 0.9;
    s *= it.rmul || 1;
    s *= it.kmul || 1;
    s *= it.zmul || 1;
    if (it.presale) s *= AMMO_PRESALE_BOOST;
    return s;
  }

  // ── 店ごとにまとめて並べる（競合の手順が「1晩1店・90件・30分」だから）────
  function ammoArrange(items, want, kind, T) {
    const mark = ammoMark(items, T.revs, todayJst(), T.rk);
    const byShop = new Map();
    for (const it of items) {
      if (!byShop.has(it.shop)) byShop.set(it.shop, []);
      byShop.get(it.shop).push(it);
    }
    // ★料率は**商品単位が優先**。キャンペーン中だけ30%に乗る商品を、
    //   20%の店の他の商品と区別する（料率は2%〜30%と10倍以上ちがう）
    let nUp = 0;
    const shops = Array.from(byShop.entries()).map(([shop, list]) => {
      const shopRate = AMMO_RATES_BUILTIN[shop] != null ? AMMO_RATES_BUILTIN[shop] : AMMO_RATE_UNKNOWN;
      for (const it of list) {
        const ir = T.irates && T.irates[it.key];
        it.rate = ir ? ir[0] : shopRate;
        it.rateUp = !!(ir && ir[0] > shopRate);
        if (it.rateUp) nUp += 1;
      }
      list.sort((a, b) => ammoScore(b, b.rate) - ammoScore(a, a.rate));
      return { shop, rate: shopRate, list };
    });
    // 使う店は「その店から1件出したときの見込みの平均」で選ぶ。
    // ★在庫の深さをここに混ぜてはいけない（いちばん報酬の出る店が夜枠から落ちる）
    for (const s of shops) {
      const top = s.list.slice(0, AMMO_SLOT);
      s.quality = top.length ? top.reduce((sum, it) => sum + ammoScore(it, it.rate), 0) / top.length : 0;
    }
    shops.sort((a, b) => (b.quality - a.quality) || (b.list.length - a.list.length));
    const out = [];
    for (const s of shops) {
      if (out.length >= want) break;
      for (const it of s.list.slice(0, Math.min(AMMO_SLOT, want - out.length))) out.push(it);
    }
    const rows = out.slice(0, want);
    // 数えた内訳は必ず返す（黙って上げ下げしない・鉄則）
    return {
      kind, rows, pool: items.length,
      presaleUsed: rows.filter((x) => x.presale).length,
      rateUp: { pool: nUp, used: rows.filter((x) => x.rateUp).length,
                made: T.ratesMade || "" },
      rank: T.rk ? { days: T.rk.days || 0, pool: mark.rank,
                     used: rows.filter((x) => (x.kmul || 1) !== 1).length } : null,
      season: T.rk ? { ready: !!T.rk.ready, pool: mark.season,
                       used: rows.filter((x) => (x.zmul || 1) !== 1).length } : null,
      reviewed: Object.keys(T.revs).length ? rows.filter((x) => x.rmul !== 1).length : null,
      shops: Array.from(new Set(rows.map((x) => x.shop))),
    };
  }

  // ── 自分の棚を読む（差分読み。知っているidに当たったら止める）──────────
  async function loadShelf(prog, force) {
    const saved = jload(SHELF_KEY, null);
    const prev = (!force && saved) || { items: [] };
    const known = new Set((prev.items || []).map((x) => x.id));
    const fresh = [];
    let url = collectsUrl(ME_ID);
    let page = 0, hitKnown = false, handle = "";
    while (url && page < AMMO_SHELF_PAGES && !hitKnown) {
      const j = await jsonp(url);
      const rows = (j && j.data) || [];
      if (!rows.length) break;
      for (const c of rows) {
        if (!handle && c.user && c.user.username) handle = c.user.username;
        const id = String(c.id);
        if (known.has(id)) { hitKnown = true; break; }
        const it = c.item || {};
        fresh.push({
          id, ca: c.created_at || "", lk: c.likes || 0, pin: !!c.is_pinned,
          key: it.key || "", url: it.url || "", name: it.name || "",
          content: c.content || "", sold: !!it.flg_soldout, st: it.start_time || 0,
          cid: it.category_id || "", c2: it.category_lv2_id || "", c1: it.category_lv1_id || "",
        });
      }
      page += 1;
      url = (j.meta || {}).next_page || "";
      prog("自分の棚を読んでいます（" + fresh.length + "件）", page,
           hitKnown ? page : AMMO_SHELF_PAGES);
    }
    // 新しいものが前。固定は毎日入れ替わるので、既知ぶんの固定フラグは信じない
    const items = fresh.concat(prev.items || []).slice(0, AMMO_SHELF_MAX);
    const shelf = { at: Date.now(), items, handle: handle || (prev.handle || ME_HANDLE) };
    jsave(SHELF_KEY, shelf);
    return { shelf, added: fresh.length, full: !hitKnown && page > 1 };
  }

  // ── 🔁 貼り替え・再投稿の弾 ─────────────────────────────
  async function buildRepost(count, lead, prog) {
    const want = count || AMMO_SLOT;
    const T = await tables();
    const { shelf } = await loadShelf(prog, false);
    const used = usedKeys();
    const today = todayJst();
    let early = 0, earlyCp = 0;
    const rows = [];
    for (const x of shelf.items) {
      if (!x.key || !x.url) continue;
      if (x.pin) continue;                          // 固定は触らない
      if ((x.lk || 0) > AMMO_MAX_LIKES) continue;   // いいねが乗っているものは消さない
      // ★貼り替えは「消してから投稿し直す」ので、売り出し前・クーポン開始前のものに
      //   手を出すと、開く前に棚から消えている時間ができてしまう
      if (ammoTooEarly(x.st, lead)) { early += 1; continue; }
      if (ammoCouponTooEarly(x.name, lead)) { earlyCp += 1; continue; }
      if (used.has(x.key)) continue;
      const age = daysBetween((x.ca || "").slice(0, 10), today);
      if (!(age >= AMMO_MIN_AGE_D)) continue;
      rows.push({ key: x.key, url: x.url, name: x.name, price: 0,
                  shop: ammoShopOf(x.key), who: 1, age,
                  roomUrl: "https://room.rakuten.co.jp/" + shelf.handle + "/" + x.id,
                  content: x.content, likes: x.lk || 0 });
    }
    rows.sort((a, b) => b.age - a.age);   // 古いものから棚を入れ替える
    const arranged = ammoArrange(rows, want, "repost", T);
    // ★既存の紹介文は書き換えない。#PR が無いものにだけ足す
    let added = 0;
    for (const it of arranged.rows) {
      const before = it.content || "";
      it.content = ammoEnsurePr(before);
      if (it.content !== before) added += 1;
    }
    arranged.prAdded = added;
    arranged.early = early; arranged.earlyCp = earlyCp; arranged.lead = lead;
    remember(arranged.rows.map((x) => x.key));
    return arranged;
  }

  // ── 🆕 新規投稿の弾（競合が出していて自分がまだ出していないもの）────────
  async function buildNew(count, lead, prog) {
    const want = count || AMMO_SLOT;
    const T = await tables();
    const { shelf } = await loadShelf(prog, false);
    const mine = new Set(shelf.items.map((x) => x.key).filter(Boolean));
    const used = usedKeys();
    let early = 0, earlyCp = 0;
    const pool = new Map();
    let round = 0;
    const cursors = RIVALS.map((id) => ({ id, next: collectsUrl(id) }));
    while (round < AMMO_RIVAL_PAGES && cursors.some((c) => c.next)) {
      prog("競合の投稿を読んでいます（" + pool.size + "件）", round, AMMO_RIVAL_PAGES);
      await Promise.all(cursors.map(async (c) => {
        if (!c.next) return;
        let j = null;
        try { j = await jsonp(c.next); } catch (e) { c.next = ""; return; }
        const rows = (j && j.data) || [];
        for (const row of rows) {
          const it = row.item || {};
          const key = it.key || "";
          if (!key || !it.url) continue;          // 商品URLが無いと投稿できない
          if (it.flg_soldout) continue;
          // 売り出しが先すぎる商品・クーポンだけ先の商品は、いま貼っても空振りになる
          if (ammoTooEarly(it.start_time, lead)) { early += 1; continue; }
          if (ammoCouponTooEarly(it.name, lead)) { earlyCp += 1; continue; }
          if (mine.has(key) || used.has(key)) continue;
          const cur = pool.get(key);
          if (cur) { cur.who += 1; continue; }
          pool.set(key, { key, url: it.url, name: it.name || "", price: it.price || 0,
                          shop: ammoShopOf(key), who: 1,
                          cid: it.category_id || "", c2: it.category_lv2_id || "",
                          c1: it.category_lv1_id || "", start: it.start_time || 0,
                          // ★ROOMのAPIの review_count/review_average は当てにならない
                          //   （300件中2件しか入っていない）。使うのは data/ のレビュー表
                          reviewN: 0, reviewAvg: 0 });
        }
        c.next = (j.meta || {}).next_page || "";
      }));
      round += 1;
    }
    const arranged = ammoArrange(Array.from(pool.values()), want, "new", T);
    // 紹介文は「商品名＋装飾」。#PR を必ず入れる
    const learn = ammoLearn(shelf.items);
    for (const it of arranged.rows) it.content = ammoCaption(it, learn);
    arranged.learned = learn.learned;
    arranged.early = early; arranged.earlyCp = earlyCp; arranged.lead = lead;
    remember(arranged.rows.map((x) => x.key));
    return arranged;
  }

  // 弾の1件を、画面が回せる形にする。
  // ★ここに一本化する（画面とMac側の作り置きで別々に書くと、片方だけずれる）
  const ROUTE_TH = 100; // いいねがこれ以上なら「消さずに書き換え」（拡張と同じ）
  function toItem(x, kind) {
    const route = kind === "new" ? "new" : (x.likes || 0) >= ROUTE_TH ? "edit" : "repost";
    return {
      c: x.roomUrl ? String(x.roomUrl).replace(/\/$/, "").split("/").pop() : "new:" + x.url,
      r: route, n: x.name || "", s: x.shop || "", p: x.price || 0,
      l: x.likes == null ? null : x.likes,
      u: x.url || "", o: x.roomUrl || "", t: x.content || x.name || "", k: x.key || "",
    };
  }

  global.RoomAmmo = {
    buildNew, buildRepost, remember, usedKeys, toItem, ROUTE_TH,
    shelfInfo: () => jload(SHELF_KEY, null),
    clearShelf: () => { localStorage.removeItem(SHELF_KEY); },
    tables,
    // テスト用に判定だけ取り出せるようにしておく（tests/ から呼ぶ）
    _: { ammoTooEarly, ammoCouponStart, ammoCouponTooEarly, zkMaxDiscount, capBanner,
         capPrice, capDeadline, ammoEnsurePr, ammoLearn, ammoCaption, ammoScore,
         ammoReviewMul, ammoRankShopMul, ammoSeasonMul, daysBetween, ammoShopOf, jstDayStr },
  };
})(window);
