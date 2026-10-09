import {mrspaceAdmin} from "./mrspace-auth.ts";
// heron-shop: heronca.com <-> Square bridge (Supabase Edge Function)
// Secrets: SQUARE_ACCESS_TOKEN, ADMIN_PASSWORD, SQUARE_ENV (sandbox|production),
// optional: SQUARE_LOCATION_ID, SITE_URL, SITE_DISCOUNT_PCT, SHIP_FEE_CENTS, FREE_SHIP_CENTS

const ENV = Deno.env.get("SQUARE_ENV") ?? "sandbox";
const BASE = ENV === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com";
const TOKEN = Deno.env.get("SQUARE_ACCESS_TOKEN") ?? "";
const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD") ?? "";
const SITE_URL = Deno.env.get("SITE_URL") ?? "https://heronca.shop";
// Pricing model: Square price = STORE price. The site shows it as "10% off" a compare price (store + 10%).
// Other marketplaces should be listed at store + PLATFORM_MARKUP_PCT (fees there are higher).
const DISCOUNT = Number(Deno.env.get("SITE_DISCOUNT_PCT") ?? "10");
const PLATFORM_MARKUP = Number(Deno.env.get("PLATFORM_MARKUP_PCT") ?? "30");
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "", SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
async function db(path: string, method = "GET", body?: unknown) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { method, headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error("Queue table: " + (await r.text()));
  return r.status === 204 ? [] : await r.json();
}
const SHIP_FEE = Number(Deno.env.get("SHIP_FEE_CENTS") ?? "599");
const FREE_SHIP = Number(Deno.env.get("FREE_SHIP_CENTS") ?? "8000");
const SQ_VERSION = "2025-01-23";

const CATEGORIES: Record<string, string> = {
  "Tops": "TP", "Dresses & Jumpsuits": "DR", "Coats & Jackets": "CT",
  "Shirts": "SH", "Shoes": "SO", "Bags & Accessories": "AC",
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-admin-password, authorization, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function sq(path: string, method = "GET", body?: unknown) {
  const r = await fetch(BASE + path, {
    method,
    headers: { "Square-Version": SQ_VERSION, Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(j.errors ?? j));
  return j;
}

let loc: string | undefined;
async function locationId() {
  if (loc) return loc;
  loc = Deno.env.get("SQUARE_LOCATION_ID") ?? undefined;
  if (loc) return loc;
  const j = await sq("/v2/locations");
  const l = (j.locations ?? []).find((x: any) => x.status === "ACTIVE") ?? j.locations[0];
  return (loc = l.id);
}

async function listAll(types: string) {
  const out: any[] = [];
  let cursor: string | undefined;
  do {
    const j = await sq(`/v2/catalog/list?types=${types}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    out.push(...(j.objects ?? []));
    cursor = j.cursor;
  } while (cursor);
  return out;
}

async function counts(ids: string[], location: string) {
  const map: Record<string, { q: number; at: string }> = {};
  for (let i = 0; i < ids.length; i += 500) {
    let cursor: string | undefined;
    do {
      const j = await sq("/v2/inventory/counts/batch-retrieve", "POST", {
        catalog_object_ids: ids.slice(i, i + 500), location_ids: [location], cursor,
      });
      for (const c of j.counts ?? []) if (c.state === "IN_STOCK") map[c.catalog_object_id] = { q: Number(c.quantity), at: c.calculated_at };
      cursor = j.cursor;
    } while (cursor);
  }
  return map;
}

let cache: { at: number; items: any[] } | null = null;
async function catalog(fresh = false) {
  if (!fresh && cache && Date.now() - cache.at < 60_000) return cache.items;
  const objs = await listAll("ITEM,IMAGE,CATEGORY");
  const imgs: Record<string, string> = {}, cats: Record<string, string> = {};
  const raw: any[] = [];
  for (const o of objs) {
    if (o.is_deleted) continue;
    if (o.type === "IMAGE") imgs[o.id] = o.image_data?.url;
    else if (o.type === "CATEGORY") cats[o.id] = o.category_data?.name;
    else if (o.type === "ITEM") raw.push(o);
  }
  const location = await locationId();
  const vids = raw.map((i) => i.item_data?.variations?.[0]?.id).filter(Boolean);
  const cnt = vids.length ? await counts(vids, location) : {};
  const items = raw.flatMap((it) => {
    const d = it.item_data, v = d.variations?.[0];
    if (!v) return [];
    const vd = v.item_variation_data, c = cnt[v.id];
    const price = Number(vd.price_money?.amount ?? 0);
    const catId = d.categories?.[0]?.id ?? d.category_id ?? d.reporting_category?.id;
    return [{
      id: v.id, item_id: it.id, sku: vd.sku ?? "", title: d.name,
      description: d.description_plaintext ?? d.description ?? "",
      size: vd.name && !["Regular", "One size"].includes(vd.name) ? vd.name : "",
      category: cats[catId] ?? "Other", price, site_price: price,
      images: (d.image_ids ?? []).map((id: string) => imgs[id]).filter(Boolean),
      qty: c?.q ?? 0, qty_at: c?.at ?? null, updated: it.updated_at,
    }];
  });
  items.sort((a, b) => b.updated.localeCompare(a.updated));
  cache = { at: Date.now(), items };
  return items;
}

// Public list: has photo, in stock, or sold within the last 7 days
async function hiddenIds() {
  if (!SB_URL) return new Set<string>();
  try { const rows = await db(`publish_queue?select=item_id,status,publish_at`);
    const now = Date.now();
    return new Set(rows.filter((r: any) => !(r.status === "approved" && r.publish_at && Date.parse(r.publish_at) <= now)).map((r: any) => r.item_id));
  } catch { return new Set<string>(); }
}
async function publicList() {
  const week = Date.now() - 7 * 864e5;
  const hidden = await hiddenIds();
  return (await catalog())
    .filter((x) => !hidden.has(x.id) && !x.sku.startsWith("HC-G-"))
    .map((x) => ({ ...x, price: Math.ceil(x.price * (100 + DISCOUNT) / 100 / 100) * 100, site_price: x.price }))
    .filter((x) => x.images.length && (x.qty > 0 || (x.qty_at && Date.parse(x.qty_at) > week)))
    .map(({ qty, qty_at, item_id, ...x }) => ({ ...x, sold: qty <= 0 }))
    .sort((a, b) => Number(a.sold) - Number(b.sold));
}

// Multi-buy: most expensive piece gets the site discount, the 2nd gets 15%, 3rd 20%, 4th 25%, 5th and on 30%.
// Never stacked with the site discount: each piece gets whichever is higher.
const BUNDLE = [0, 15, 20, 25, 30];
const pctFor = (i: number) => BUNDLE[Math.min(i, BUNDLE.length - 1)];

async function checkout(rawIds: string[], pickup: boolean, offerCents = 0) {
  const ids = [...new Set((rawIds ?? []).map(String))].slice(0, 20);
  const items = await catalog(true);
  const pick = ids.map((id) => items.find((x) => x.id === id && x.qty > 0)).filter(Boolean) as any[];
  if (!pick.length) throw new Error("These pieces are no longer available.");
  pick.sort((a, b) => b.price - a.price);
  const pcts = pick.map((_, i) => pctFor(i));
  const subtotal = pick.reduce((s, x, i) => s + Math.round(x.price * (100 - pcts[i]) / 100), 0);
  if (offerCents) pcts.fill(0);
  const uniq = [...new Set(pcts)].filter((p) => p > 0);
  const order: any = {
    location_id: await locationId(),
    ...(uniq.length ? { discounts: uniq.map((p) => ({ uid: `d${p}`, name: `Multi-buy, ${p}% off`, percentage: String(p), scope: "LINE_ITEM" })) } : {}),
    line_items: pick.map((x, i) => ({ catalog_object_id: x.id, quantity: "1", ...(pcts[i] > 0 ? { applied_discounts: [{ discount_uid: `d${pcts[i]}` }] } : {}) })),
  };
  if (offerCents) {
    const full = pick.reduce((t, x) => t + x.price, 0);
    if (offerCents < full) order.discounts = [{ uid: "offer", name: "Accepted offer", amount_money: { amount: full - offerCents, currency: "USD" }, scope: "ORDER" }];
  }
  if (pickup) order.line_items[0].note = "PICKUP IN STORE, 517 Ocean Front Walk";
  const checkout_options: any = { redirect_url: `${SITE_URL}/thanks.html` };
  if (!pickup) {
    checkout_options.ask_for_shipping_address = true;
    if ((offerCents || subtotal) < FREE_SHIP) checkout_options.shipping_fee = { name: "US shipping", charge: { amount: SHIP_FEE, currency: "USD" } };
  }
  const j = await sq("/v2/online-checkout/payment-links", "POST", { idempotency_key: crypto.randomUUID(), order, checkout_options });
  return { url: j.payment_link.url };
}

function samePassword(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// ---------- admin ----------
async function ensureCategories(names: string[]) {
  const objs = await listAll("CATEGORY");
  const byName: Record<string, string> = {};
  for (const o of objs) if (!o.is_deleted) byName[o.category_data?.name] = o.id;
  const missing = [...new Set(names)].filter((n) => !byName[n]);
  if (missing.length) {
    const j = await sq("/v2/catalog/batch-upsert", "POST", {
      idempotency_key: crypto.randomUUID(),
      batches: [{ objects: missing.map((n, i) => ({ type: "CATEGORY", id: `#c${i}`, category_data: { name: n } })) }],
    });
    for (const m of j.id_mappings ?? []) byName[missing[Number(m.client_object_id.slice(2))]] = m.object_id;
  }
  return byName;
}

async function nextSkus(code: string, n: number, kind = "V", skip = 0) {
  const items = await catalog(true);
  const re = new RegExp(`^HC-[VK]-${code}-(\\d+)$`);
  let max = 0;
  for (const x of items) { const m = x.sku.match(re); if (m) max = Math.max(max, Number(m[1])); }
  return Array.from({ length: n }, (_, i) => `HC-${kind}-${code}-${String(max + 1 + skip + i).padStart(4, "0")}`);
}

async function setStock(varIds: string[], qty = 1) {
  const location = await locationId();
  const now = new Date().toISOString();
  for (let i = 0; i < varIds.length; i += 100) {
    await sq("/v2/inventory/changes/batch-create", "POST", {
      idempotency_key: crypto.randomUUID(),
      changes: varIds.slice(i, i + 100).map((id) => ({
        type: "PHYSICAL_COUNT",
        physical_count: { catalog_object_id: id, location_id: location, state: "IN_STOCK", quantity: String(qty), occurred_at: now },
      })),
    });
  }
}

function itemObject(tmp: string, r: any, catId: string, sku: string) {
  return {
    type: "ITEM", id: `#i${tmp}`,
    item_data: {
      name: r.title, description: r.description ?? "", categories: [{ id: catId }], reporting_category: { id: catId },
      variations: [{
        type: "ITEM_VARIATION", id: `#v${tmp}`,
        item_variation_data: {
          item_id: `#i${tmp}`, name: r.size || "One size", sku, pricing_type: "FIXED_PRICING",
          price_money: { amount: Math.round(Number(r.price) * 100), currency: "USD" }, track_inventory: true,
        },
      }],
    },
  };
}

// Photos from the seller's own eBay listing page
async function ebayImages(itemNo: string) {
  const r = await fetch(`https://www.ebay.com/itm/${itemNo}`, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh) HeronShop/1.0", "Accept-Language": "en-US" } });
  if (!r.ok) return [];
  const html = await r.text();
  const ids: string[] = [];
  for (const m of html.matchAll(/i\.ebayimg\.com\/images\/g\/([A-Za-z0-9~_-]{10,})\//g)) if (!ids.includes(m[1])) ids.push(m[1]);
  return ids.slice(0, 8).map((id) => `https://i.ebayimg.com/images/g/${id}/s-l1600.jpg`);
}

async function imageBytes(src: string) {
  if (src.startsWith("data:")) return Uint8Array.from(atob(src.split(",").pop()!), (c) => c.charCodeAt(0));
  if (!src.startsWith("https://")) throw new Error("Only https photo links are allowed");
  const r = await fetch(src);
  if (!r.ok) throw new Error(`Photo download failed: ${src}`);
  return new Uint8Array(await r.arrayBuffer());
}

async function uploadImages(itemId: string, images: string[], sku: string) {
  for (let i = 0; i < images.length; i++) {
    const bytes = await imageBytes(images[i]);
    const fd = new FormData();
    fd.append("request", JSON.stringify({
      idempotency_key: crypto.randomUUID(), object_id: itemId, is_primary: i === 0,
      image: { type: "IMAGE", id: "#img", image_data: { name: `${sku}-${i + 1}` } },
    }));
    fd.append("image_file", new Blob([bytes], { type: "image/jpeg" }), `${sku}-${i + 1}.jpg`);
    const r = await fetch(BASE + "/v2/catalog/images", {
      method: "POST", headers: { "Square-Version": SQ_VERSION, Authorization: `Bearer ${TOKEN}` }, body: fd,
    });
    if (!r.ok) throw new Error(await r.text());
  }
}

async function createItems(rows: any[], dedup = false) {
  const cats = await ensureCategories(rows.map((r) => r.category));
  const existing = new Set((await catalog(true)).map((x) => x.title.trim().toLowerCase()));
  const todo = rows.filter((r) => !dedup || !existing.has(r.title.trim().toLowerCase()));
  const byCode: Record<string, any[]> = {}; const used: Record<string, number> = {};
  for (const r of todo) if (!r.sku) (byCode[(r.consign ? "K:" : "V:") + (CATEGORIES[r.category] ?? "XX")] ??= []).push(r);
  for (const [key, list] of Object.entries(byCode)) {
    const [kind, code] = key.split(":");
    const skus = await nextSkus(code, list.length, kind, used[code] ?? 0); used[code] = (used[code] ?? 0) + list.length;
    list.forEach((r, i) => (r.sku = skus[i]));
  }
  const created: any[] = [];
  for (let i = 0; i < todo.length; i += 200) {
    const chunk = todo.slice(i, i + 200);
    const j = await sq("/v2/catalog/batch-upsert", "POST", {
      idempotency_key: crypto.randomUUID(),
      batches: [{ objects: chunk.map((r, k) => itemObject(String(k), r, cats[r.category], r.sku)) }],
    });
    const map: Record<string, string> = {};
    for (const m of j.id_mappings ?? []) map[m.client_object_id] = m.object_id;
    chunk.forEach((r, k) => created.push({ ...r, item_id: map[`#i${k}`], var_id: map[`#v${k}`] }));
  }
  await setStock(created.map((c) => c.var_id));
  let photos = 0;
  for (const c of created) {
    if (!c.images?.length && c.ebay) c.images = await ebayImages(c.ebay).catch(() => []);
    if (c.images?.length) { await uploadImages(c.item_id, c.images, c.sku).catch(() => {}); photos++; }
  }
  cache = null;
  return { var_ids: created.map((c) => c.var_id), created: created.length, with_photos: photos, skipped: rows.length - todo.length, skus: created.map((c) => c.sku) };
}

// ---- Google Aerial View: monthly budget instead of a daily cap ----
// Google gives 5,000 free lookups a month. Busy days can use more, quiet days less; we stop at the monthly limit.
const AERIAL_KEY = Deno.env.get("GOOGLE_AERIAL_KEY") ?? "", AERIAL_LIMIT = Number(Deno.env.get("AERIAL_MONTHLY_LIMIT") ?? "4900");
const AERIAL_ADDRESS = "517 Ocean Front Walk, Venice, CA 90291";
async function aerialLink() {
  if (!AERIAL_KEY || !SB_URL) return { src: "" };
  const ok = await db("rpc/aerial_hit", "POST", { lim: AERIAL_LIMIT });
  if (ok !== true) return { src: "", reason: "monthly limit" };
  const saved = (await db("aerial?key=eq.video_id&select=val"))[0]?.val; // Google allows keeping the video ID, not the video
  const q = saved ? `videoId=${encodeURIComponent(saved)}` : `address=${encodeURIComponent(AERIAL_ADDRESS)}`;
  const j: any = await (await fetch(`https://aerialview.googleapis.com/v1/videos:lookupVideo?key=${AERIAL_KEY}&${q}`)).json();
  if (!saved && j.metadata?.videoId) await db("aerial", "POST", [{ key: "video_id", val: j.metadata.videoId }]);
  return { src: (j.state === "ACTIVE" && (j.uris?.MP4_HIGH?.landscapeUri || j.uris?.MP4_MEDIUM?.landscapeUri)) || "" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const a = body.action;
    if (a === "list") return json({ items: await publicList(), discount: DISCOUNT, markup: PLATFORM_MARKUP, bundle: BUNDLE, ship_fee: SHIP_FEE, free_ship: FREE_SHIP });
    if (a === "aerial") return json(await aerialLink());
    if (a === "checkout") return json(await checkout(body.ids ?? [], !!body.pickup));
    if (a === "offer") {
      const ids = [...new Set((body.ids ?? []).map(String))].slice(0, 20) as string[];
      const amount = Math.round(Number(body.amount) * 100), email = String(body.email ?? "").trim().slice(0, 120);
      if (ids.length < 2) throw new Error("Offers are for 2 or more pieces.");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Please add a valid email.");
      const items = await catalog(); if (ids.some((id) => !items.find((x) => x.id === id && x.qty > 0))) throw new Error("Some of these pieces are no longer available.");
      await db("offers", "POST", [{ item_ids: ids, amount_cents: amount > 0 ? amount : null, email, note: String(body.note ?? "").slice(0, 500), status: "new" }]);
      return json({ ok: true });
    }

    if (!samePassword(req.headers.get("x-admin-password") ?? "", ADMIN_PASSWORD) && !await mrspaceAdmin(req)) {
      await new Promise((r) => setTimeout(r, 1000));
      return json({ error: "Wrong password" }, 401);
    }
    if (a === "admin_list") return json({ items: await catalog(true), categories: Object.keys(CATEGORIES) });
    if (a === "admin_create") {
      const r: any = await createItems([body.item]);
      if (SB_URL && r.var_ids?.length) await db("publish_queue", "POST", r.var_ids.map((id: string) => ({ item_id: id, status: "draft" })));
      return json(r);
    }
    if (a === "admin_offers") {
      const rows = await db("offers?select=*&order=created_at.desc&limit=100"); const items = await catalog(true);
      return json({ rows: rows.map((r: any) => ({ ...r, items: r.item_ids.map((id: string) => items.find((x) => x.id === id)).filter(Boolean) })) });
    }
    if (a === "admin_offer_answer") {
      const [o] = await db(`offers?id=eq.${Number(body.id)}&select=*`);
      if (!o) throw new Error("Offer not found");
      let link = "";
      const cents = body.amount ? Math.round(Number(body.amount) * 100) : o.amount_cents;
      if (body.accept && !cents) throw new Error("Type the price you want to give");
      if (body.accept) link = (await checkout(o.item_ids, false, cents)).url;
      await db(`offers?id=eq.${o.id}`, "PATCH", { status: body.accept ? "accepted" : "declined", link, ...(body.accept ? { amount_cents: cents } : {}) });
      return json({ link, email: o.email });
    }
    if (a === "admin_queue") {
      const rows = await db("publish_queue?select=*&order=created_at.asc");
      const items = await catalog(true);
      return json({ rows: rows.map((r: any) => ({ ...r, item: items.find((x) => x.id === r.item_id) })).filter((r: any) => r.item) });
    }
    if (a === "admin_queue_set") {
      // mode "now": publish all picked now. mode "daily": perDay pieces per day, starting at `start` (YYYY-MM-DD, 10:00 LA time)
      const ids: string[] = body.ids ?? []; const per = Math.max(1, Number(body.perDay ?? 1));
      const base = body.mode === "daily" ? Date.parse(`${body.start}T10:00:00-07:00`) : Date.now();
      const rows = ids.map((id, i) => ({ item_id: id, status: "approved", publish_at: new Date(base + Math.floor(i / per) * 864e5).toISOString() }));
      if (rows.length) await db("publish_queue", "POST", rows);
      cache = null; return json({ scheduled: rows.length, last: rows.at(-1)?.publish_at });
    }
    if (a === "admin_import") return json(await createItems(body.rows ?? [], true));
    if (a === "admin_add_photos") { await uploadImages(body.item_id, body.images ?? [], body.sku ?? "photo"); cache = null; return json({ ok: true }); }
    if (a === "admin_general") {
      // store-only items with one shared barcode each (not tracked, not shown online)
      const have = new Set((await catalog(true)).map((x) => x.sku));
      const list = (body.items ?? []).filter((r: any) => r.code && !have.has("HC-G-" + r.code));
      if (list.length) {
        const cats = await ensureCategories(["Store items"]);
        await sq("/v2/catalog/batch-upsert", "POST", { idempotency_key: crypto.randomUUID(), batches: [{ objects: list.map((r: any, k: number) => ({
          type: "ITEM", id: `#g${k}`, item_data: { name: r.name, categories: [{ id: cats["Store items"] }], reporting_category: { id: cats["Store items"] },
            variations: [{ type: "ITEM_VARIATION", id: `#gv${k}`, item_variation_data: { item_id: `#g${k}`, name: "Regular", sku: "HC-G-" + r.code, track_inventory: false,
              ...(r.price ? { pricing_type: "FIXED_PRICING", price_money: { amount: Math.round(Number(r.price) * 100), currency: "USD" } } : { pricing_type: "VARIABLE_PRICING" }) } }] } })) }] });
      }
      cache = null; return json({ created: list.length });
    }
    if (a === "admin_recent") {
      const location = await locationId();
      const pays = (await sq(`/v2/payments?location_id=${location}&sort_order=DESC&limit=25`)).payments ?? [];
      const oids = pays.map((p: any) => p.order_id).filter(Boolean);
      const orders = oids.length ? (await sq("/v2/orders/batch-retrieve", "POST", { location_id: location, order_ids: oids })).orders ?? [] : [];
      return json({ rows: pays.filter((p: any) => p.status === "COMPLETED").map((p: any) => { const o = orders.find((o: any) => o.id === p.order_id);
        return { id: p.id, at: p.created_at, total: p.total_money?.amount ?? 0, method: p.source_type === "CASH" ? "Cash" : (p.card_details?.card?.card_brand ?? p.source_type ?? "Card") + (p.card_details?.card?.last_4 ? " •••• " + p.card_details.card.last_4 : ""),
          lines: (o?.line_items ?? []).map((l: any) => ({ name: l.name + (l.variation_name && l.variation_name !== "Regular" ? " (" + l.variation_name + ")" : ""), qty: l.quantity, total: l.total_money?.amount ?? 0 })),
          tax: o?.total_tax_money?.amount ?? 0, discount: o?.total_discount_money?.amount ?? 0 }; }) });
    }
    if (a === "admin_cash_sale") {
      // records a sale paid outside Square (cash). Marks the picked pieces sold and keeps a log for bookkeeping/sales tax.
      const ids = [...new Set((body.ids ?? []).map(String))].slice(0, 50) as string[];
      const lines = (body.lines ?? []).slice(0, 50);
      const total = lines.reduce((t: number, l: any) => t + Math.round(Number(l.price) * 100), 0);
      if (ids.length) await setStock(ids, 0);
      cache = null; return json({ ok: true, total });
    }
    if (a === "admin_receipt_log") {
      const r = body.receipt ?? {};
      const [row] = await db("receipts", "POST", [{ ref: String(r.no ?? "").slice(0, 40), method: String(r.method ?? "").slice(0, 60), lines: r.lines ?? [], total_cents: Math.round(Number(r.total ?? 0)), source: String(r.source ?? "manual") }]);
      return json({ no: row?.id, at: row?.created_at });
    }
    if (a === "admin_receipts") return json({ rows: await db("receipts?select=*&order=created_at.desc&limit=200") });
    if (a === "admin_reprice") {
      // body.changes: [{ id: variationId, price: dollars }]
      const ch: any[] = (body.changes ?? []).slice(0, 500); let done = 0;
      for (let i = 0; i < ch.length; i += 100) {
        const part = ch.slice(i, i + 100);
        const got = await sq("/v2/catalog/batch-retrieve", "POST", { object_ids: part.map((c) => c.id) });
        const objs = (got.objects ?? []).filter((o: any) => o.type === "ITEM_VARIATION").map((o: any) => {
          const c = part.find((c) => c.id === o.id); o.item_variation_data.price_money = { amount: Math.round(Number(c.price) * 100), currency: "USD" }; return o; });
        if (objs.length) { await sq("/v2/catalog/batch-upsert", "POST", { idempotency_key: crypto.randomUUID(), batches: [{ objects: objs }] }); done += objs.length; }
      }
      cache = null; return json({ done });
    }
    if (a === "admin_consign") {
      // re-code SKUs as consignment: HC-V-XX-0001 -> HC-K-XX-0001 (50% goes to the owner)
      const ids = [...new Set((body.ids ?? []).map(String))].slice(0, 200) as string[];
      let changed = 0;
      for (let i = 0; i < ids.length; i += 100) {
        const got = await sq("/v2/catalog/batch-retrieve", "POST", { object_ids: ids.slice(i, i + 100) });
        const objs = (got.objects ?? []).filter((o: any) => o.type === "ITEM_VARIATION").map((o: any) => {
          const d = o.item_variation_data; const old = d.sku ?? "";
          d.sku = /^HC-V-/.test(old) ? old.replace(/^HC-V-/, "HC-K-") : (old.startsWith("HC-K-") ? old : "HC-K-" + (old || o.id.slice(-6)));
          if (d.sku !== old) changed++;
          return o;
        });
        if (objs.length) await sq("/v2/catalog/batch-upsert", "POST", { idempotency_key: crypto.randomUUID(), batches: [{ objects: objs }] });
      }
      cache = null; return json({ changed });
    }
    if (a === "admin_mark_sold") {
      const ids = [...new Set((body.ids ?? []).map(String))].slice(0, 200) as string[];
      if (ids.length) await setStock(ids, 0);
      cache = null; return json({ marked: ids.length });
    }
    if (a === "admin_ebay_photos") {
      const imgs = await ebayImages(body.ebay);
      if (!imgs.length) return json({ error: "No photos found on that eBay listing" }, 404);
      await uploadImages(body.item_id, imgs, body.sku ?? "photo"); cache = null; return json({ added: imgs.length });
    }
    if (a === "admin_ai") return json({ error: "AI text is not enabled yet." }, 400);
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
