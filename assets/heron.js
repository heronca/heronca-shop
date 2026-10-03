// ===== Settings: edit here =====
const HERON = {
  api: "https://wvvizyrroqejwrfadbpx.supabase.co/functions/v1/heron-shop",
  categories: ["Tops", "Dresses & Jumpsuits", "Coats & Jackets", "Shirts", "Shoes", "Bags & Accessories"],
  links: [ // footer links with logos; add the missing addresses here
    ["Instagram", "https://www.instagram.com/heron.ca/", "instagram.com"],
    ["eBay", "https://www.ebay.com/usr/heronca", "ebay.com"],
    ["Poshmark", "https://poshmark.com/closet/heronca", "poshmark.com"],
    ["Vinted", "https://www.vinted.com/member/3172628125-heronca1", "vinted.com"],
    ["Mercari", "", "mercari.com"],
    ["Depop", "", "depop.com"],
    ["Etsy", "", "etsy.com"],
    ["Facebook", "", "facebook.com"],
  ],
};
// ================================

const $ = (s, el = document) => el.querySelector(s);
const money = (c) => "$" + (c / 100).toFixed(c % 100 ? 2 : 0);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function api(action, data = {}, headers = {}) {
  const r = await fetch(HERON.api, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ action, ...data }) });
  const j = await r.json().catch(() => ({ error: "Network error" }));
  if (!r.ok || j.error) throw new Error(j.error || "Request failed");
  return j;
}

let SHOP = null;
async function shop() { return (SHOP ??= await api("list")); }

// ---- bag (stored in this browser only) ----
const bag = {
  get() { try { return JSON.parse(localStorage.getItem("heron-bag") || "[]"); } catch { return []; } },
  set(ids) { try { localStorage.setItem("heron-bag", JSON.stringify(ids)); } catch {} renderBag(); },
  add(id) { const b = bag.get(); if (!b.includes(id)) bag.set([...b, id]); toast("Added to your bag"); },
  remove(id) { bag.set(bag.get().filter((x) => x !== id)); },
};

function toast(msg) { const t = $("#toast"); t.textContent = msg; t.style.display = "block"; clearTimeout(t._h); t._h = setTimeout(() => (t.style.display = "none"), 2200); }

async function renderBag() {
  const n = $("#bagCount"); if (n) n.textContent = bag.get().length;
  const rows = $("#bagRows"); if (!rows || !$("#drawer").classList.contains("open")) return;
  const s = await shop();
  const items = bag.get().map((id) => s.items.find((x) => x.id === id && !x.sold)).filter(Boolean);
  if (items.length !== bag.get().length) bag.set(items.map((x) => x.id));
  const tier = (i) => Math.max(s.discount, s.bundle[Math.min(i, s.bundle.length - 1)]);
  const sorted = [...items].sort((a, b) => b.price - a.price);
  const line = (x) => { const i = sorted.indexOf(x), p = tier(i); return { p, cost: Math.round(x.price * (100 - p) / 100) }; };
  rows.innerHTML = items.length ? items.map((x) => { const l = line(x); return `<div class="row"><img src="${x.images[0]}" alt=""><div>${esc(x.title)}<div class="small">${esc(x.size)}${x.size ? " · " : ""}${l.p}% off</div></div><div style="text-align:right"><b>${money(l.cost)}</b><br><s class="small">${money(x.price)}</s><br><button onclick="bag.remove('${x.id}')">Remove</button></div></div>`; }).join("") : `<p class="small">Your bag is empty.</p>`;
  const sub = items.reduce((a, x) => a + line(x).cost, 0), full = items.reduce((a, x) => a + x.price, 0);
  const ship = !items.length || sub >= s.free_ship ? 0 : s.ship_fee;
  const next = tier(items.length);
  $("#bagSum").innerHTML = `${items.length ? `<div class="nudge">Add one more piece and get <b>${next}% off</b> it</div>` : ""}<div><span>You save</span><span>${money(full - sub)}</span></div><div><span>Subtotal</span><span>${money(sub)}</span></div><div><span>US shipping</span><span>${ship ? money(ship) : "Free"}</span></div><div class="small">${sub < s.free_ship ? `Add ${money(s.free_ship - sub)} more for free US shipping` : "You get free US shipping"}</div>`;
  $("#bagGo").disabled = $("#bagPick").disabled = !items.length;
}

async function checkout(ids, pickup = false) {
  try { toast("Opening secure checkout…"); const { url } = await api("checkout", { ids, pickup }); location.href = url; }
  catch (e) { toast(e.message); SHOP = null; }
}

function chrome() {
  document.body.insertAdjacentHTML("afterbegin", `
  <div class="strip caps">Buy more, save more: 15% off your 2nd piece, up to 30% · Free US shipping over $80</div>
  <header class="top"><div class="wrap bar"><a class="logo" href="/"><img src="/assets/heron-logo.png" alt="Heron CA"></a>
  <div class="right"><nav class="menu"><a href="/">Shop</a><a href="/about.html">About</a><a href="/about.html#visit">Visit</a></nav>
  <button class="bag caps" onclick="openBag()">Bag <b id="bagCount">0</b></button></div></div>
  <nav class="cats" id="cats"></nav></header>
  <div class="marquee" aria-label="Find us on"><div class="track">${(() => { const one = HERON.links.filter((l) => l[1]).map(([n, u, d]) => `<a href="${u}" target="_blank" rel="noopener"><img src="https://www.google.com/s2/favicons?domain=${d}&sz=64" alt="" width="18" height="18">${n === "Instagram" ? "Instagram @heron.ca" : n}</a><span class="dot">✦</span>`).join(""); return one.repeat(6); })()}</div></div>`);
  document.body.insertAdjacentHTML("beforeend", `
  <footer><div class="wrap"><img class="logo-f" src="/assets/heron-footer.png" alt="Heron CA"><div class="caps">Vintage. New. Ours.</div>
  <div class="small">Also find us on</div><div class="links">${HERON.links.filter((l) => l[1]).map(([n, u, d]) => `<a class="plat" href="${u}" target="_blank" rel="noopener"><img src="https://www.google.com/s2/favicons?domain=${d}&sz=64" alt="" width="20" height="20">${n}</a>`).join("")}</div>
  <div class="small"><a href="/about.html">About</a> · <a href="/about.html#returns">Returns</a> · <a href="/about.html#visit">Visit</a><br>517 Ocean Front Walk, Unit 6, Venice, CA 90291 · Open daily 11:00 to 5:30<br><a href="tel:+13235776677">(323) 577-6677</a> · <a href="mailto:info@heronca.com">info@heronca.com</a></div></div></footer>
  <div class="drawer" id="drawer"><div class="shade" onclick="closeBag()"></div><div class="panel">
  <div class="head" style="margin:0"><h2>Your bag</h2><button class="chip" onclick="closeBag()">Close</button></div>
  <div class="rows" id="bagRows"></div><div class="sum" id="bagSum"></div>
  <button class="btn" id="bagGo" onclick="checkout(bag.get())">Checkout</button>
  <button class="btn alt" id="bagPick" onclick="checkout(bag.get(), true)">Pay now, pick up in store</button></div></div>
  <div class="toast" id="toast"></div>`);
  const here = new URLSearchParams(location.search).get("c") || "";
  $("#cats").innerHTML = [["", "All"], ...HERON.categories.map((c) => [c, c])].map(([v, l]) => `<a class="${v === here && location.pathname.length <= 11 ? " on" : ""}" href="/${v ? "?c=" + encodeURIComponent(v) : ""}">${l}</a>`).join("");
  renderBag();
}
function openBag() { $("#drawer").classList.add("open"); renderBag(); }
function closeBag() { $("#drawer").classList.remove("open"); }

function card(x) {
  return `<a class="card${x.sold ? " is-sold" : ""}" href="/item.html?id=${x.id}"><div class="ph"><img loading="lazy" src="${x.images[0]}" alt="${esc(x.title)}">${x.images[1] ? `<img loading="lazy" src="${x.images[1]}" alt="">` : ""}${x.sold ? `<span class="badge sold caps">Sold</span>` : ""}</div>
  <div class="t">${esc(x.title)}</div><div class="m">${esc(x.size)}${x.size ? " · " : ""}<span class="price"><b>${money(x.site_price)}</b><s>${money(x.price)}</s></span></div></a>`;
}
