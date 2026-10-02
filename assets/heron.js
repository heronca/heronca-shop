// ===== Settings: edit here =====
const HERON = {
  api: "https://wvvizyrroqejwrfadbpx.supabase.co/functions/v1/heron-shop",
  categories: ["Tops", "Dresses & Jumpsuits", "Coats & Jackets", "Shirts", "Shoes", "Bags & Accessories"],
  links: [ // footer platform links; fill in or remove the empty ones
    ["eBay", "https://www.ebay.com/usr/heronca"],
    ["Poshmark", "https://poshmark.com/closet/heronca"],
    ["Vinted", "https://www.vinted.com/member/3172628125-heronca1"],
    ["Instagram", ""], ["Depop", ""], ["Mercari", ""], ["Etsy", ""],
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
  rows.innerHTML = items.length ? items.map((x) => `<div class="row"><img src="${x.images[0]}" alt=""><div>${esc(x.title)}<div class="small">${esc(x.size)}</div></div><div><b>${money(x.site_price)}</b><br><button onclick="bag.remove('${x.id}')">Remove</button></div></div>`).join("") : `<p class="small">Your bag is empty.</p>`;
  const sub = items.reduce((a, x) => a + x.site_price, 0);
  const ship = !items.length || sub >= s.free_ship ? 0 : s.ship_fee;
  $("#bagSum").innerHTML = `<div><span>Subtotal</span><span>${money(sub)}</span></div><div><span>US shipping</span><span>${ship ? money(ship) : "Free"}</span></div><div class="small">${sub < s.free_ship ? `Add ${money(s.free_ship - sub)} more for free US shipping` : "You get free US shipping"}</div>`;
  $("#bagGo").disabled = $("#bagPick").disabled = !items.length;
}

async function checkout(ids, pickup = false) {
  try { toast("Opening secure checkout…"); const { url } = await api("checkout", { ids, pickup }); location.href = url; }
  catch (e) { toast(e.message); SHOP = null; }
}

function chrome() {
  document.body.insertAdjacentHTML("afterbegin", `
  <div class="strip caps">Free US shipping over $80 · Visit us at 517 Ocean Front Walk, Venice</div>
  <header class="top"><div class="wrap bar"><a class="logo" href="/"><img src="/assets/heron-wordmark.png" alt="Heron CA"></a>
  <button class="bag caps" onclick="openBag()">Bag <b id="bagCount">0</b></button></div>
  <nav class="cats" id="cats"></nav></header>`);
  document.body.insertAdjacentHTML("beforeend", `
  <footer><div class="wrap"><img src="/assets/heron-ca.png" alt=""><div class="caps">Vintage. New. Ours.</div>
  <div class="small">Also find us on</div><div class="links">${HERON.links.filter((l) => l[1]).map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener">${n}</a>`).join("")}</div>
  <div class="small">517 Ocean Front Walk, Unit 6, Venice, CA 90291 · Open daily 11:00 to 5:30</div></div></footer>
  <div class="drawer" id="drawer"><div class="shade" onclick="closeBag()"></div><div class="panel">
  <div class="head" style="margin:0"><h2>Your bag</h2><button class="bag caps" onclick="closeBag()">Close</button></div>
  <div class="rows" id="bagRows"></div><div class="sum" id="bagSum"></div>
  <button class="btn" id="bagGo" onclick="checkout(bag.get())">Checkout</button>
  <button class="btn alt" id="bagPick" onclick="checkout(bag.get(), true)">Pay now, pick up in store</button></div></div>
  <div class="toast" id="toast"></div>`);
  const here = new URLSearchParams(location.search).get("c") || "";
  $("#cats").innerHTML = [["", "All"], ...HERON.categories.map((c) => [c, c])].map(([v, l]) => `<a class="chip${v === here && location.pathname.length <= 11 ? " on" : ""}" href="/${v ? "?c=" + encodeURIComponent(v) : ""}">${l}</a>`).join("");
  renderBag();
}
function openBag() { $("#drawer").classList.add("open"); renderBag(); }
function closeBag() { $("#drawer").classList.remove("open"); }

function card(x) {
  return `<a class="card${x.sold ? " is-sold" : ""}" href="/item.html?id=${x.id}"><div class="ph"><img loading="lazy" src="${x.images[0]}" alt="${esc(x.title)}">${x.sold ? `<span class="badge sold caps">Sold</span>` : ""}</div>
  <div class="t">${esc(x.title)}</div><div class="m">${esc(x.size)}${x.size ? " · " : ""}<span class="price"><b>${money(x.site_price)}</b><s>${money(x.price)}</s></span></div></a>`;
}
