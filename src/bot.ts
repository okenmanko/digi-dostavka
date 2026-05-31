import { Telegraf, Markup } from "telegraf";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";

dotenv.config();

type OrderStatus = "created" | "assembled" | "delivered" | "cancelled" | "scheduled";
type OrderType = "normal" | "storage" | "moysklad";
type PaymentType = "paid" | "cash";
type Currency = "USD" | "UZS";

type Courier = {
  id: number;
  name: string;
};

type Warehouse = {
  id: string;
  name: string;
};

type OrderItem = {
  name: string;
  warehouseId: string;
  warehouseName: string;
  quantity?: number;
};

type Order = {
  id: string;
  type: OrderType;
  clientName: string;
  clientPhone: string;
  address: string;
  items: OrderItem[];
  deliveryTime: string;
  paymentType: PaymentType;
  amount?: number;
  currency?: Currency;
  courierId: number;
  courierName: string;
  status: OrderStatus;
  scheduledAt?: string;
  deliveryGroupMessageId?: number;
  deliveredPhotoFileId?: string;
  createdBy: number;
  createdAt: string;
  assembledAt?: string;
  deliveredAt?: string;
  cancelledAt?: string;

  moyskladId?: string;
  moyskladHref?: string;
  moyskladName?: string;
};

type Draft = Partial<Order> & {
  step?: string;
  tempItemName?: string;
};

const TOKEN = process.env.BOT_TOKEN || "";
if (!TOKEN) throw new Error("BOT_TOKEN topilmadi");

const bot = new Telegraf(TOKEN);

const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((x) => Number(x.trim()))
  .filter((x) => Number.isFinite(x) && x > 0);

const DELIVERY_GROUP_ID = Number(process.env.DELIVERY_GROUP_ID);
const REPORT_GROUP_ID = Number(process.env.REPORT_GROUP_ID);

const COURIERS: Courier[] = (process.env.COURIERS || "")
  .split(",")
  .map((x) => {
    const [idRaw, nameRaw] = x.split(":");
    return {
      id: Number((idRaw || "").trim()),
      name: (nameRaw || "").trim()
    };
  })
  .filter((x) => Number.isFinite(x.id) && x.id > 0 && x.name.length > 0);

const DEFAULT_COURIER_ID = Number(process.env.MOYSKLAD_DEFAULT_COURIER_ID || COURIERS[0]?.id || 0);
const DEFAULT_COURIER = COURIERS.find((x) => x.id === DEFAULT_COURIER_ID) || COURIERS[0];

const MOYSKLAD_TOKEN = process.env.MOYSKLAD_TOKEN || "";
const MOYSKLAD_BASE = "https://api.moysklad.ru/api/remap/1.2";
const MOYSKLAD_DELIVERY_STATE_NAME = process.env.MOYSKLAD_DELIVERY_STATE_NAME || "доставка";
const MOYSKLAD_DELIVERED_STATE_NAME = process.env.MOYSKLAD_DELIVERED_STATE_NAME || "Доставлен";
const MOYSKLAD_SYNC_INTERVAL_SECONDS = Number(process.env.MOYSKLAD_SYNC_INTERVAL_SECONDS || 60);

const DATA_DIR = path.join(process.cwd(), "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const WAREHOUSES_FILE = path.join(DATA_DIR, "warehouses.json");

const drafts = new Map<number, Draft>();
const waitingPhoto = new Map<number, string>();
const locks = new Set<string>();
let moyskladSyncRunning = false;

function htmlOptions(extra?: any): any {
  return {
    parse_mode: "HTML",
    ...(extra || {})
  };
}

function escapeHtml(text: any): string {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isAdmin(id?: number): boolean {
  return !!id && ADMIN_IDS.includes(id);
}

function isCourier(id?: number): boolean {
  return !!id && COURIERS.some((x) => x.id === id);
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const data = await fs.readFile(file, "utf-8");
    return JSON.parse(data) as T;
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(file, JSON.stringify(fallback, null, 2), "utf-8");
    return fallback;
  }
}

async function writeJson<T>(file: string, data: T): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
}

async function getOrders(): Promise<Order[]> {
  return readJson<Order[]>(ORDERS_FILE, []);
}

async function saveOrders(orders: Order[]): Promise<void> {
  return writeJson(ORDERS_FILE, orders);
}

async function getWarehouses(): Promise<Warehouse[]> {
  return readJson<Warehouse[]>(WAREHOUSES_FILE, []);
}

async function saveWarehouses(warehouses: Warehouse[]): Promise<void> {
  return writeJson(WAREHOUSES_FILE, warehouses);
}

function adminMenu() {
  return Markup.keyboard([
    ["➕ Zayavka yaratish"],
    ["📦 Xraneniya"],
    ["📋 Aktiv zayavkalar"],
    ["🏬 Skladlar"],
    ["📊 Otchetlar", "❌ Bekor qilinganlar"]
  ]).resize();
}

function courierKeyboard() {
  return Markup.inlineKeyboard(
    COURIERS.map((x) => [Markup.button.callback("🚚 " + x.name, "courier:" + x.id)])
  );
}

function paymentText(order: Partial<Order>): string {
  if (order.paymentType === "paid") return "✅ To‘langan";
  if (order.paymentType === "cash") return "💰 Pul olish kerak";
  return "➖ Tanlanmagan";
}

function statusText(status?: OrderStatus): string {
  if (status === "scheduled") return "📦 Xraneniya";
  if (status === "created") return "🆕 Yangi";
  if (status === "assembled") return "📦 Sobrano";
  if (status === "delivered") return "✅ Dostavlena";
  if (status === "cancelled") return "❌ Bekor qilingan";
  return "📝 Draft";
}

function formatItems(items: OrderItem[] = []): string {
  if (!items.length) return "Mahsulot yo‘q";

  const groups = new Map<string, string[]>();

  for (const item of items) {
    const sklad = item.warehouseName || "-";
    if (!groups.has(sklad)) groups.set(sklad, []);
    const qtyText = item.quantity && item.quantity > 0 ? ` - ${item.quantity}X` : "";
    groups.get(sklad)!.push(`<b>${escapeHtml(item.name.toUpperCase() + qtyText)}</b>`);
  }

  return Array.from(groups.entries())
    .map(([sklad, names]) => `${names.join("\n")}\n\n Sklad: ${escapeHtml(sklad)}`)
    .join("\n\n");
}

function formatOrder(order: Partial<Order>): string {
  const lines = [
    "━━━━━━━━━━━━━━━━━━━━",
    `📋 ZAYAVKA: ${escapeHtml(order.id || "YANGI")}`,
    `📌 Status: ${statusText(order.status)}`,
    "━━━━━━━━━━━━━━━━━━━━",
    "",
    `👤 Klient: ${escapeHtml(order.clientName || "-")}`,
    `📞 Telefon: ${escapeHtml(order.clientPhone || "-")}`,
    "",
    "📍 Manzil:",
    escapeHtml(order.address || "-"),
    "",
    "🛒 Mahsulotlar:",
    "",
    formatItems(order.items || []),
    "",
    `🕒 Yetkazish vaqti: ${escapeHtml(order.deliveryTime || "-")}`,
    `🚚 Dostavshik: ${escapeHtml(order.courierName || "-")}`,
    "",
    `💳 To‘lov: ${paymentText(order)}`
  ];

  if (order.amount !== undefined && order.amount !== null) {
    lines.push(`💵 Summa: ${order.amount} ${order.currency || ""}`);
  }

  if (order.type === "storage") {
    lines.push("");
    lines.push("📦 XRANENIYA");
    lines.push(`⏰ Chiqish vaqti: ${escapeHtml(order.scheduledAt || "-")}`);
  }

  if (order.moyskladName) {
    lines.push("");
    lines.push(`🔗 MoySklad: ${escapeHtml(order.moyskladName)}`);
  }

  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━");

  return lines.join("\n").trim();
}

function deliveryButtons(order: Order): any {
  if (order.status === "created") {
    return Markup.inlineKeyboard([
      [Markup.button.callback("📦 SOBRANO", "assemble:" + order.id)],
      [Markup.button.callback("❌ BEKOR QILISH", "cancel_real:" + order.id)]
    ]);
  }

  if (order.status === "assembled") {
    return Markup.inlineKeyboard([
      [Markup.button.callback("✅ DOSTAVLENA", "deliver:" + order.id)]
    ]);
  }

  return undefined;
}

function parseScheduleInput(input: string): string {
  const text = input.trim();
  const direct = new Date(text.replace(" ", "T"));

  if (!Number.isNaN(direct.getTime())) return direct.toISOString();

  const lower = text.toLowerCase();
  const now = new Date();

  if (lower.includes("hafta")) {
    now.setDate(now.getDate() + 7);
    return now.toISOString();
  }

  if (lower.includes("oy")) {
    now.setMonth(now.getMonth() + 1);
    return now.toISOString();
  }

  now.setMinutes(now.getMinutes() + 1);
  return now.toISOString();
}

async function showConfirm(ctx: any, draft: Draft) {
  await ctx.reply(
    formatOrder(draft),
    htmlOptions(
      Markup.inlineKeyboard([
        [Markup.button.callback("✅ Tasdiqlash", "confirm")],
        [Markup.button.callback("✏️ Tahrirlash", "edit")],
        [Markup.button.callback("❌ Bekor qilish", "cancel")]
      ])
    )
  );
}

/* =========================
   MOYSKLAD API
========================= */

async function msFetch(urlOrPath: string, options: any = {}): Promise<any> {
  if (!MOYSKLAD_TOKEN) throw new Error("MOYSKLAD_TOKEN topilmadi");

  const url = urlOrPath.startsWith("http") ? urlOrPath : MOYSKLAD_BASE + urlOrPath;

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${MOYSKLAD_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json;charset=utf-8",
      ...(options.headers || {})
    }
  });

  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    console.error("MOYSKLAD API ERROR", res.status, data);
    throw new Error(`MoySklad API xato: ${res.status}`);
  }

  return data;
}

function moneyFromMs(value: any): number {
  const n = Number(value || 0);
  return Math.round((n / 100) * 100) / 100;
}

function detectCurrency(msOrder: any): Currency {
  const raw = [
    msOrder?.rate?.currency?.name,
    msOrder?.rate?.currency?.fullName,
    msOrder?.rate?.currency?.isoCode,
    msOrder?.currency?.name,
    msOrder?.currency?.isoCode
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (raw.includes("usd") || raw.includes("дол") || raw.includes("dollar")) return "USD";
  return "UZS";
}

function getAgentPhone(agent: any): string {
  const phones = [
    agent?.phone,
    agent?.mobile,
    agent?.fax
  ].filter(Boolean);

  if (Array.isArray(agent?.contactpersons?.rows)) {
    for (const c of agent.contactpersons.rows) {
      if (c?.phone) phones.push(c.phone);
      if (c?.mobile) phones.push(c.mobile);
    }
  }

  return String(phones[0] || "-");
}

function getAgentAddress(msOrder: any): string {
  return (
    msOrder?.shipmentAddress ||
    msOrder?.agent?.actualAddress ||
    msOrder?.agent?.legalAddress ||
    msOrder?.agent?.address ||
    "-"
  );
}

async function findCustomerOrderStateByName(name: string): Promise<any | null> {
  const meta = await msFetch("/entity/customerorder/metadata");
  const states = meta?.states || [];

  return (
    states.find((x: any) => String(x.name || "").toLowerCase() === name.toLowerCase()) ||
    null
  );
}

async function fetchPositions(msOrder: any): Promise<any[]> {
  if (msOrder?.positions?.rows) return msOrder.positions.rows;
  const href = msOrder?.positions?.meta?.href;
  if (!href) return [];
  const data = await msFetch(href + "?expand=assortment,store&limit=100");
  return data?.rows || [];
}

function msOrderNumber(msOrder: any): string {
  return String(msOrder?.name || msOrder?.id || Date.now());
}

async function convertMsOrderToLocalOrder(msOrder: any): Promise<Order> {
  const positions = await fetchPositions(msOrder);
  const currency = detectCurrency(msOrder);
  const sum = moneyFromMs(msOrder?.sum);
  const payedSum = moneyFromMs(msOrder?.payedSum);
  const debt = Math.max(0, Math.round((sum - payedSum) * 100) / 100);
  const isPaid = sum > 0 && payedSum >= sum;

  const items: OrderItem[] = positions.map((p: any) => {
    const productName =
      p?.assortment?.name ||
      p?.name ||
      p?.assortment?.code ||
      "Mahsulot";

    const warehouseName =
      p?.store?.name ||
      msOrder?.store?.name ||
      "-";

    return {
      name: productName,
      warehouseId: p?.store?.id || msOrder?.store?.id || "",
      warehouseName,
      quantity: Number(p?.quantity || 1)
    };
  });

  return {
    id: "MS-" + msOrderNumber(msOrder),
    type: "moysklad",
    clientName: msOrder?.agent?.name || "-",
    clientPhone: getAgentPhone(msOrder?.agent),
    address: getAgentAddress(msOrder),
    items,
    deliveryTime: msOrder?.shipmentAddressFull?.comment || msOrder?.deliveryPlannedMoment || "-",
    paymentType: isPaid ? "paid" : "cash",
    amount: isPaid ? undefined : debt || sum,
    currency,
    courierId: DEFAULT_COURIER?.id || 0,
    courierName: DEFAULT_COURIER?.name || "-",
    status: "created",
    createdBy: 0,
    createdAt: new Date().toISOString(),
    moyskladId: msOrder?.id,
    moyskladHref: msOrder?.meta?.href,
    moyskladName: msOrder?.name
  };
}

async function syncMoySkladDeliveryOrders(): Promise<void> {
  if (!MOYSKLAD_TOKEN) return;
  if (moyskladSyncRunning) return;

  moyskladSyncRunning = true;

  try {
    const deliveryState = await findCustomerOrderStateByName(MOYSKLAD_DELIVERY_STATE_NAME);

    if (!deliveryState?.meta?.href) {
      console.error("MoySklad status topilmadi:", MOYSKLAD_DELIVERY_STATE_NAME);
      return;
    }

    const url =
      `/entity/customerorder?limit=50` +
      `&order=updated,desc` +
      `&expand=agent,store,state`;

    const data = await msFetch(url);
    const rows = data?.rows || [];
    const orders = await getOrders();

    for (const msOrder of rows) {
      const stateName = String(msOrder?.state?.name || "");
      if (stateName.toLowerCase() !== MOYSKLAD_DELIVERY_STATE_NAME.toLowerCase()) continue;

      const alreadyExists = orders.some((x) => x.moyskladHref === msOrder?.meta?.href);
      if (alreadyExists) continue;

      const localOrder = await convertMsOrderToLocalOrder(msOrder);

      const msg = await bot.telegram.sendMessage(
        DELIVERY_GROUP_ID,
        formatOrder(localOrder),
        htmlOptions(deliveryButtons(localOrder))
      );

      localOrder.deliveryGroupMessageId = msg.message_id;
      orders.push(localOrder);
      await saveOrders(orders);

      console.log("MoySklad zayavka yuborildi:", localOrder.id);
    }
  } catch (err) {
    console.error("MoySklad sync error:", err);
  } finally {
    moyskladSyncRunning = false;
  }
}

async function updateMoySkladOrderToDelivered(order: Order): Promise<void> {
  if (!MOYSKLAD_TOKEN) return;
  if (!order.moyskladHref) return;

  const deliveredState = await findCustomerOrderStateByName(MOYSKLAD_DELIVERED_STATE_NAME);

  if (!deliveredState?.meta) {
    console.error("MoySklad delivered status topilmadi:", MOYSKLAD_DELIVERED_STATE_NAME);
    return;
  }

  await msFetch(order.moyskladHref, {
    method: "PUT",
    body: JSON.stringify({
      state: deliveredState
    })
  });

  console.log("MoySklad status Доставлен qilindi:", order.id);
}

/* =========================
   BOT HANDLERS
========================= */

bot.start(async (ctx: any) => {
  const userId = ctx.from?.id;

  if (isAdmin(userId)) {
    return ctx.reply("👨‍💼 Admin panel", adminMenu());
  }

  if (isCourier(userId)) {
    return ctx.reply("🚚 Courier panel. Zayavkalar delivery guruhga keladi.");
  }

  return ctx.reply("⛔ Ruxsat yo‘q");
});

bot.command("id", async (ctx: any) => {
  await ctx.reply("🆔 User ID: " + ctx.from.id + "\n💬 Chat ID: " + ctx.chat.id);
});

bot.command("syncms", async (ctx: any) => {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.reply("🔄 MoySklad tekshirilmoqda...");
  await syncMoySkladDeliveryOrders();
  await ctx.reply("✅ MoySklad sync tugadi");
});

bot.command("msdebug", async (ctx: any) => {
  if (!isAdmin(ctx.from.id)) return;

  try {
    await ctx.reply("🔍 Debug boshlandi...");

    const meta = await msFetch("/entity/customerorder/metadata");
    const states = (meta?.states || []).map((s: any) => s.name).join("\n");

    const data = await msFetch("/entity/customerorder?limit=10&order=updated,desc&expand=agent,store,state");
    const ordersText = (data?.rows || [])
      .map((o: any) => `${o.name} | STATUS: ${o.state?.name || "-"} | CLIENT: ${o.agent?.name || "-"}`)
      .join("\n");

    await ctx.reply("📌 STATUSLAR:\n" + states);
    await ctx.reply("📦 OXIRGI ZAKAZLAR:\n" + (ordersText || "Zakaz topilmadi"));
  } catch (e: any) {
    console.error(e);
    await ctx.reply("❌ MS DEBUG ERROR: " + e.message);
  }
});

bot.command("msdebug", async (ctx: any) => {
  if (!isAdmin(ctx.from.id)) return;

  try {
    const meta = await msFetch("/entity/customerorder/metadata");
    const states = (meta?.states || []).map((s: any) => s.name).join("\n");

    const data = await msFetch("/entity/customerorder?limit=10&order=updated,desc&expand=agent,store,state");
    const ordersText = (data?.rows || [])
      .map((o: any) => {
        return `${o.name} | STATUS: ${o.state?.name || "-"} | CLIENT: ${o.agent?.name || "-"}`;
      })
      .join("\n");

    await ctx.reply(
      "📌 STATUSLAR:\n" + states + "\n\n📦 OXIRGI ZAKAZLAR:\n" + ordersText
    );
  } catch (e: any) {
    console.error(e);
    await ctx.reply("❌ MS DEBUG ERROR: " + e.message);
  }
});

bot.hears("🏬 Skladlar", async (ctx: any) => {
  if (!isAdmin(ctx.from.id)) return;

  const warehouses = await getWarehouses();
  const text = warehouses.length
    ? warehouses.map((x, i) => `${i + 1}. ${x.name}`).join("\n")
    : "📭 Sklad yo‘q";

  await ctx.reply(
    text,
    Markup.inlineKeyboard([[Markup.button.callback("➕ Sklad qo‘shish", "add_warehouse")]])
  );
});

bot.action("add_warehouse", async (ctx: any) => {
  if (!isAdmin(ctx.from.id)) return;

  drafts.set(ctx.from.id, { step: "warehouse_name" });
  await ctx.answerCbQuery();
  await ctx.reply("🏬 Sklad nomini kiriting");
});

bot.hears("➕ Zayavka yaratish", async (ctx: any) => {
  if (!isAdmin(ctx.from.id)) return;

  drafts.set(ctx.from.id, {
    type: "normal",
    items: [],
    step: "client_name"
  });

  await ctx.reply("👤 Klient ismi");
});

bot.hears("📦 Xraneniya", async (ctx: any) => {
  if (!isAdmin(ctx.from.id)) return;

  drafts.set(ctx.from.id, {
    type: "storage",
    items: [],
    step: "client_name"
  });

  await ctx.reply("👤 Klient ismi");
});

bot.hears("📋 Aktiv zayavkalar", async (ctx: any) => {
  if (!isAdmin(ctx.from.id)) return;

  const orders = await getOrders();
  const active = orders.filter(
    (x) => x.status === "created" || x.status === "assembled" || x.status === "scheduled"
  );

  if (!active.length) return ctx.reply("📭 Aktiv zayavka yo‘q");

  for (const order of active.slice(-10)) {
    await ctx.reply(formatOrder(order), htmlOptions());
  }
});

bot.hears("❌ Bekor qilinganlar", async (ctx: any) => {
  if (!isAdmin(ctx.from.id)) return;

  const orders = await getOrders();
  const cancelled = orders.filter((x) => x.status === "cancelled").slice(-10);

  if (!cancelled.length) return ctx.reply("📭 Bekor qilingan zayavka yo‘q");

  for (const order of cancelled) {
    await ctx.reply(formatOrder(order), htmlOptions());
  }
});

bot.hears("📊 Otchetlar", async (ctx: any) => {
  if (!isAdmin(ctx.from.id)) return;

  const orders = await getOrders();
  const today = new Date().toISOString().slice(0, 10);
  const todayOrders = orders.filter((x) => x.createdAt?.slice(0, 10) === today);

  const created = todayOrders.filter((x) => x.status === "created").length;
  const assembled = todayOrders.filter((x) => x.status === "assembled").length;
  const delivered = todayOrders.filter((x) => x.status === "delivered").length;
  const scheduled = todayOrders.filter((x) => x.status === "scheduled").length;
  const cancelled = todayOrders.filter((x) => x.status === "cancelled").length;
  const itemCount = todayOrders.reduce((sum, x) => sum + (x.items?.length || 0), 0);

  await ctx.reply([
    "📊 BUGUNGI OTCHET",
    "━━━━━━━━━━━━━━━━━━━━",
    "📋 Jami zayavka: " + todayOrders.length,
    "🛒 Tovar soni: " + itemCount,
    "",
    "🆕 Yangi: " + created,
    "📦 Sobrano: " + assembled,
    "✅ Yetkazilgan: " + delivered,
    "📦 Xraneniya: " + scheduled,
    "❌ Bekor: " + cancelled,
    "━━━━━━━━━━━━━━━━━━━━"
  ].join("\n"));
});

bot.on("text", async (ctx: any) => {
  const userId = ctx.from.id;
  if (!isAdmin(userId)) return;

  const draft = drafts.get(userId);
  if (!draft?.step) return;

  const text = ctx.message.text.trim();

  if (draft.step === "warehouse_name") {
    const warehouses = await getWarehouses();
    warehouses.push({ id: Date.now().toString(), name: text });
    await saveWarehouses(warehouses);
    drafts.delete(userId);
    return ctx.reply("✅ Sklad qo‘shildi", adminMenu());
  }

  if (draft.step === "client_name") {
    draft.clientName = text;
    draft.step = "client_phone";
    drafts.set(userId, draft);
    return ctx.reply("📞 Telefon raqam");
  }

  if (draft.step === "client_phone") {
    draft.clientPhone = text;
    draft.step = "address";
    drafts.set(userId, draft);
    return ctx.reply("📍 Manzil");
  }

  if (draft.step === "address") {
    draft.address = text;
    draft.step = "item_name";
    drafts.set(userId, draft);
    return ctx.reply("🛒 Mahsulot nomi");
  }

  if (draft.step === "item_name") {
    draft.tempItemName = text;
    const warehouses = await getWarehouses();

    if (!warehouses.length) return ctx.reply("Avval sklad qo‘shing: 🏬 Skladlar");

    draft.step = "item_warehouse";
    drafts.set(userId, draft);

    return ctx.reply(
      "🏬 Qaysi skladdan olinadi?",
      Markup.inlineKeyboard(warehouses.map((x) => [Markup.button.callback(x.name, "warehouse:" + x.id)]))
    );
  }

  if (draft.step === "delivery_time") {
    draft.deliveryTime = text;
    draft.step = "payment";
    drafts.set(userId, draft);

    return ctx.reply(
      "💳 To‘lov turini tanlang",
      Markup.inlineKeyboard([
        [Markup.button.callback("✅ To‘langan", "payment:paid")],
        [Markup.button.callback("💰 Pul olish kerak", "payment:cash")]
      ])
    );
  }

  if (draft.step === "amount") {
    const amount = Number(text.replace(/\s/g, "").replace(",", "."));

    if (!Number.isFinite(amount)) return ctx.reply("Summa faqat raqam bo‘lishi kerak");

    draft.amount = amount;
    draft.step = "currency";
    drafts.set(userId, draft);

    return ctx.reply(
      "💱 Valyutani tanlang",
      Markup.inlineKeyboard([[
        Markup.button.callback("USD", "currency:USD"),
        Markup.button.callback("UZS", "currency:UZS")
      ]])
    );
  }

  if (draft.step === "scheduled_at") {
    draft.scheduledAt = parseScheduleInput(text);
    draft.step = "confirm";
    drafts.set(userId, draft);
    return showConfirm(ctx, draft);
  }

  if (draft.step === "edit_client_name") {
    draft.clientName = text;
    draft.step = "confirm";
    drafts.set(userId, draft);
    return showConfirm(ctx, draft);
  }

  if (draft.step === "edit_client_phone") {
    draft.clientPhone = text;
    draft.step = "confirm";
    drafts.set(userId, draft);
    return showConfirm(ctx, draft);
  }

  if (draft.step === "edit_address") {
    draft.address = text;
    draft.step = "confirm";
    drafts.set(userId, draft);
    return showConfirm(ctx, draft);
  }

  if (draft.step === "edit_delivery_time") {
    draft.deliveryTime = text;
    draft.step = "confirm";
    drafts.set(userId, draft);
    return showConfirm(ctx, draft);
  }
});

bot.action(/^warehouse:(.+)$/, async (ctx: any) => {
  if (!isAdmin(ctx.from.id)) return;

  const draft = drafts.get(ctx.from.id);
  if (!draft) return;

  const warehouses = await getWarehouses();
  const warehouse = warehouses.find((x) => x.id === ctx.match[1]);

  if (!warehouse || !draft.tempItemName) {
    await ctx.answerCbQuery("Xatolik");
    return;
  }

  draft.items = draft.items || [];
  draft.items.push({
    name: draft.tempItemName,
    warehouseId: warehouse.id,
    warehouseName: warehouse.name
  });

  draft.tempItemName = undefined;
  draft.step = "add_more";
  drafts.set(ctx.from.id, draft);

  await ctx.answerCbQuery();

  return ctx.reply(
    "➕ Yana mahsulot qo‘shasizmi?",
    Markup.inlineKeyboard([
      [Markup.button.callback("✅ Ha", "add_more")],
      [Markup.button.callback("➡️ Davom etish", "finish_items")]
    ])
  );
});

bot.action("add_more", async (ctx: any) => {
  const draft = drafts.get(ctx.from.id);
  if (!draft) return;

  draft.step = "item_name";
  drafts.set(ctx.from.id, draft);

  await ctx.answerCbQuery();
  await ctx.reply("🛒 Mahsulot nomi");
});

bot.action("finish_items", async (ctx: any) => {
  const draft = drafts.get(ctx.from.id);
  if (!draft) return;

  draft.step = "delivery_time";
  drafts.set(ctx.from.id, draft);

  await ctx.answerCbQuery();
  await ctx.reply("🕒 Yetkazish vaqti. Masalan: 18:00");
});

bot.action(/^payment:(.+)$/, async (ctx: any) => {
  const draft = drafts.get(ctx.from.id);
  if (!draft) return;

  const type = ctx.match[1];

  if (type === "paid") {
    draft.paymentType = "paid";
    draft.amount = undefined;
    draft.currency = undefined;
    draft.step = "courier";
    drafts.set(ctx.from.id, draft);

    await ctx.answerCbQuery();
    return ctx.reply("🚚 Dostavshik tanlang", courierKeyboard());
  }

  draft.paymentType = "cash";
  draft.step = "amount";
  drafts.set(ctx.from.id, draft);

  await ctx.answerCbQuery();
  return ctx.reply("💰 Qancha pul olish kerak?");
});

bot.action(/^currency:(USD|UZS)$/, async (ctx: any) => {
  const draft = drafts.get(ctx.from.id);
  if (!draft) return;

  draft.currency = ctx.match[1] as Currency;
  draft.step = "courier";
  drafts.set(ctx.from.id, draft);

  await ctx.answerCbQuery();
  return ctx.reply("🚚 Dostavshik tanlang", courierKeyboard());
});

bot.action(/^courier:(.+)$/, async (ctx: any) => {
  const draft = drafts.get(ctx.from.id);
  if (!draft) return;

  const courier = COURIERS.find((x) => x.id === Number(ctx.match[1]));

  if (!courier) {
    await ctx.answerCbQuery("Dostavshik topilmadi");
    return;
  }

  draft.courierId = courier.id;
  draft.courierName = courier.name;

  if (draft.type === "storage") {
    draft.step = "scheduled_at";
    drafts.set(ctx.from.id, draft);
    await ctx.answerCbQuery();
    return ctx.reply("📦 Xraneniya uchun sana/vaqt kiriting. Masalan: 2026-06-01 18:00 yoki 1 hafta");
  }

  draft.step = "confirm";
  drafts.set(ctx.from.id, draft);
  await ctx.answerCbQuery();
  return showConfirm(ctx, draft);
});

bot.action("edit", async (ctx: any) => {
  if (!isAdmin(ctx.from.id)) return;

  await ctx.answerCbQuery();

  await ctx.reply(
    "✏️ Nimani tahrirlaymiz?",
    Markup.inlineKeyboard([
      [Markup.button.callback("👤 Klient ismi", "edit:client_name")],
      [Markup.button.callback("📞 Telefon", "edit:client_phone")],
      [Markup.button.callback("📍 Manzil", "edit:address")],
      [Markup.button.callback("🛒 Tovarlarni qayta kiritish", "edit:items")],
      [Markup.button.callback("🕒 Vaqt", "edit:delivery_time")],
      [Markup.button.callback("💳 To‘lov", "edit:payment")],
      [Markup.button.callback("🚚 Dostavshik", "edit:courier")]
    ])
  );
});

bot.action(/^edit:(.+)$/, async (ctx: any) => {
  const draft = drafts.get(ctx.from.id);
  if (!draft) return;

  const field = ctx.match[1];
  await ctx.answerCbQuery();

  if (field === "client_name") {
    draft.step = "edit_client_name";
    drafts.set(ctx.from.id, draft);
    return ctx.reply("👤 Yangi klient ismini yozing");
  }

  if (field === "client_phone") {
    draft.step = "edit_client_phone";
    drafts.set(ctx.from.id, draft);
    return ctx.reply("📞 Yangi telefon yozing");
  }

  if (field === "address") {
    draft.step = "edit_address";
    drafts.set(ctx.from.id, draft);
    return ctx.reply("📍 Yangi manzil yozing");
  }

  if (field === "items") {
    draft.items = [];
    draft.step = "item_name";
    drafts.set(ctx.from.id, draft);
    return ctx.reply("🛒 Mahsulotlarni boshidan kiriting");
  }

  if (field === "delivery_time") {
    draft.step = "edit_delivery_time";
    drafts.set(ctx.from.id, draft);
    return ctx.reply("🕒 Yangi vaqt yozing");
  }

  if (field === "payment") {
    draft.step = "payment";
    drafts.set(ctx.from.id, draft);
    return ctx.reply(
      "💳 To‘lov turini tanlang",
      Markup.inlineKeyboard([
        [Markup.button.callback("✅ To‘langan", "payment:paid")],
        [Markup.button.callback("💰 Pul olish kerak", "payment:cash")]
      ])
    );
  }

  if (field === "courier") {
    draft.step = "courier";
    drafts.set(ctx.from.id, draft);
    return ctx.reply("🚚 Dostavshik tanlang", courierKeyboard());
  }
});

bot.action("cancel", async (ctx: any) => {
  drafts.delete(ctx.from.id);
  await ctx.answerCbQuery();
  await ctx.reply("❌ Bekor qilindi", adminMenu());
});

bot.action("confirm", async (ctx: any) => {
  if (!isAdmin(ctx.from.id)) return;

  const draft = drafts.get(ctx.from.id);

  if (!draft) {
    await ctx.answerCbQuery("Draft topilmadi");
    return;
  }

  const order: Order = {
    id: "ORD-" + Date.now(),
    type: (draft.type || "normal") as OrderType,
    clientName: draft.clientName || "",
    clientPhone: draft.clientPhone || "",
    address: draft.address || "",
    items: draft.items || [],
    deliveryTime: draft.deliveryTime || "",
    paymentType: (draft.paymentType || "paid") as PaymentType,
    amount: draft.amount,
    currency: draft.currency,
    courierId: draft.courierId || 0,
    courierName: draft.courierName || "",
    status: draft.type === "storage" ? "scheduled" : "created",
    scheduledAt: draft.scheduledAt,
    createdBy: ctx.from.id,
    createdAt: new Date().toISOString()
  };

  const orders = await getOrders();

  if (order.type === "normal") {
    const msg = await bot.telegram.sendMessage(
      DELIVERY_GROUP_ID,
      formatOrder(order),
      htmlOptions(deliveryButtons(order))
    );

    order.deliveryGroupMessageId = msg.message_id;
  }

  orders.push(order);
  await saveOrders(orders);
  drafts.delete(ctx.from.id);

  await ctx.answerCbQuery();
  await ctx.reply("✅ Zayavka saqlandi", adminMenu());
});

bot.action(/^assemble:(.+)$/, async (ctx: any) => {
  const orderId = ctx.match[1];

  if (locks.has(orderId)) return;
  locks.add(orderId);

  try {
    const orders = await getOrders();
    const order = orders.find((x) => x.id === orderId);

    if (!order) {
      await ctx.answerCbQuery("Zayavka topilmadi");
      return;
    }

    if (!isAdmin(ctx.from.id) && order.courierId !== ctx.from.id) {
      await ctx.answerCbQuery("Bu sizning zayavkangiz emas");
      return;
    }

    if (order.status !== "created") {
      await ctx.answerCbQuery("Bu statusni o‘zgartirib bo‘lmaydi");
      return;
    }

    order.status = "assembled";
    order.assembledAt = new Date().toISOString();
    await saveOrders(orders);

    if (order.deliveryGroupMessageId) {
      await bot.telegram.editMessageText(
        DELIVERY_GROUP_ID,
        order.deliveryGroupMessageId,
        undefined,
        formatOrder(order),
        htmlOptions(deliveryButtons(order))
      );
    }

    await ctx.answerCbQuery("📦 SOBRANO");
  } finally {
    locks.delete(orderId);
  }
});

bot.action(/^deliver:(.+)$/, async (ctx: any) => {
  const orderId = ctx.match[1];
  const orders = await getOrders();
  const order = orders.find((x) => x.id === orderId);

  if (!order) {
    await ctx.answerCbQuery("Zayavka topilmadi");
    return;
  }

  if (!isAdmin(ctx.from.id) && order.courierId !== ctx.from.id) {
    await ctx.answerCbQuery("Bu sizning zayavkangiz emas");
    return;
  }

  if (order.status !== "assembled") {
    await ctx.answerCbQuery("Avval SOBRANO bosilishi kerak");
    return;
  }

  waitingPhoto.set(ctx.from.id, orderId);
  await ctx.answerCbQuery();
  await ctx.reply("📸 Yetkazilganini tasdiqlash uchun rasm yuboring");
});

bot.on("photo", async (ctx: any) => {
  const orderId = waitingPhoto.get(ctx.from.id);
  if (!orderId) return;

  if (locks.has(orderId)) return;
  locks.add(orderId);

  try {
    const orders = await getOrders();
    const order = orders.find((x) => x.id === orderId);

    if (!order) {
      await ctx.reply("Zayavka topilmadi");
      return;
    }

    const photos = ctx.message.photo;
    const photo = photos[photos.length - 1];

    order.status = "delivered";
    order.deliveredAt = new Date().toISOString();
    order.deliveredPhotoFileId = photo.file_id;

    await saveOrders(orders);
    waitingPhoto.delete(ctx.from.id);

    if (order.deliveryGroupMessageId) {
      await bot.telegram.editMessageText(
        DELIVERY_GROUP_ID,
        order.deliveryGroupMessageId,
        undefined,
        formatOrder(order),
        htmlOptions()
      );
    }

    if (order.moyskladHref) {
      await updateMoySkladOrderToDelivered(order);
    }

    await bot.telegram.sendPhoto(REPORT_GROUP_ID, photo.file_id, {
      parse_mode: "HTML",
      caption: [
        "✅ YETKAZILDI",
        "",
        formatOrder(order),
        "",
        "🕒 Yetkazilgan vaqt:",
        escapeHtml(new Date().toLocaleString("ru-RU"))
      ].join("\n")
    });

    await ctx.reply("✅ Yetkazildi va otchet yuborildi");
  } catch (err) {
    console.error("Photo delivery error:", err);
    await ctx.reply("⚠️ Rasm qabul qilindi, lekin MoySklad/status update paytida xato chiqdi");
  } finally {
    locks.delete(orderId);
  }
});

bot.action(/^cancel_real:(.+)$/, async (ctx: any) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.answerCbQuery("Faqat admin bekor qila oladi");
    return;
  }

  const orderId = ctx.match[1];
  const orders = await getOrders();
  const order = orders.find((x) => x.id === orderId);

  if (!order) {
    await ctx.answerCbQuery("Zayavka topilmadi");
    return;
  }

  if (order.status === "delivered") {
    await ctx.answerCbQuery("Yetkazilgan zayavkani bekor qilib bo‘lmaydi");
    return;
  }

  order.status = "cancelled";
  order.cancelledAt = new Date().toISOString();
  await saveOrders(orders);

  if (order.deliveryGroupMessageId) {
    await bot.telegram.editMessageText(
      DELIVERY_GROUP_ID,
      order.deliveryGroupMessageId,
      undefined,
      formatOrder(order),
      htmlOptions()
    );
  }

  await ctx.answerCbQuery("❌ Bekor qilindi");
});

setInterval(async () => {
  const orders = await getOrders();
  const now = Date.now();
  let changed = false;

  for (const order of orders) {
    if (order.type !== "storage") continue;
    if (order.status !== "scheduled") continue;
    if (!order.scheduledAt) continue;

    const time = new Date(order.scheduledAt).getTime();
    if (!Number.isFinite(time)) continue;
    if (time > now) continue;

    order.status = "created";

    const msg = await bot.telegram.sendMessage(
      DELIVERY_GROUP_ID,
      "📦 XRANENIYADAN CHIQDI\n\n" + formatOrder(order),
      htmlOptions(deliveryButtons(order))
    );

    order.deliveryGroupMessageId = msg.message_id;
    changed = true;
  }

  if (changed) await saveOrders(orders);
}, 60000);

if (MOYSKLAD_TOKEN) {
  setTimeout(() => {
    syncMoySkladDeliveryOrders();
  }, 5000);

  setInterval(() => {
    syncMoySkladDeliveryOrders();
  }, Math.max(15, MOYSKLAD_SYNC_INTERVAL_SECONDS) * 1000);
}

bot.catch((err) => {
  console.error("BOT ERROR:", err);
});

bot.launch();

console.log("DIGI DOSTAVKA — MOYSKLAD FULL CODE RUNNING");

process.once("SIGINT", () => {
  bot.stop("SIGINT");
});

process.once("SIGTERM", () => {
  bot.stop("SIGTERM");
});
