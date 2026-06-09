"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const telegraf_1 = require("telegraf");
const dotenv_1 = __importDefault(require("dotenv"));
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const XLSX = __importStar(require("xlsx"));
dotenv_1.default.config();
const TOKEN = process.env.BOT_TOKEN || "";
if (!TOKEN)
    throw new Error("BOT_TOKEN topilmadi");
const bot = new telegraf_1.Telegraf(TOKEN);
const BOT_USERNAME = process.env.BOT_USERNAME || "";
const ADMINS = (process.env.ADMIN_IDS || "")
    .split(",")
    .map((x) => {
    const [idRaw, nameRaw] = x.split(":");
    const id = Number((idRaw || "").trim());
    const name = (nameRaw || "").trim();
    return {
        id,
        name: name || String(id)
    };
})
    .filter((x) => Number.isFinite(x.id) && x.id > 0);
const ADMIN_IDS = ADMINS.map((x) => x.id);
const DELIVERY_GROUP_ID = Number(process.env.DELIVERY_GROUP_ID);
const REPORT_GROUP_ID = Number(process.env.REPORT_GROUP_ID);
const COURIERS = (process.env.COURIERS || "")
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
const DATA_DIR = path_1.default.join(process.cwd(), "data");
const ORDERS_FILE = path_1.default.join(DATA_DIR, "orders.json");
const WAREHOUSES_FILE = path_1.default.join(DATA_DIR, "warehouses.json");
const EXCEL_DEFAULT_WAREHOUSE_NAME = process.env.EXCEL_DEFAULT_WAREHOUSE_NAME || "25/24";
const EXCEL_DEFAULT_CURRENCY = (process.env.EXCEL_DEFAULT_CURRENCY || "USD");
const drafts = new Map();
const waitingPhoto = new Map();
const deliveryPhotoSessions = new Map();
const waitingComment = new Map();
const locks = new Set();
let moyskladSyncRunning = false;
function htmlOptions(extra) {
    return {
        parse_mode: "HTML",
        ...(extra || {})
    };
}
function escapeHtml(text) {
    return String(text || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}
function isAdmin(id) {
    return !!id && ADMIN_IDS.includes(id);
}
function getAdminName(id) {
    if (!id)
        return "-";
    return ADMINS.find((x) => x.id === id)?.name || String(id);
}
function isCourier(id) {
    return !!id && COURIERS.some((x) => x.id === id);
}
async function readJson(file, fallback) {
    try {
        const data = await promises_1.default.readFile(file, "utf-8");
        return JSON.parse(data);
    }
    catch {
        await promises_1.default.mkdir(DATA_DIR, { recursive: true });
        await promises_1.default.writeFile(file, JSON.stringify(fallback, null, 2), "utf-8");
        return fallback;
    }
}
async function writeJson(file, data) {
    await promises_1.default.mkdir(DATA_DIR, { recursive: true });
    await promises_1.default.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
}
async function getOrders() {
    return readJson(ORDERS_FILE, []);
}
async function saveOrders(orders) {
    return writeJson(ORDERS_FILE, orders);
}
async function getWarehouses() {
    return readJson(WAREHOUSES_FILE, []);
}
async function saveWarehouses(warehouses) {
    return writeJson(WAREHOUSES_FILE, warehouses);
}
function adminMenu() {
    return telegraf_1.Markup.keyboard([
        ["➕ Zayavka yaratish"],
        ["📦 Xraneniya"],
        ["📋 Aktiv zayavkalar"],
        ["🏬 Skladlar"],
        ["📊 Otchetlar", "❌ Bekor qilinganlar"]
    ]).resize();
}
function courierMenu() {
    return telegraf_1.Markup.keyboard([
        ["➕ Shoshilinch zayavka"]
    ]).resize();
}
function courierKeyboard() {
    return telegraf_1.Markup.inlineKeyboard(COURIERS.map((x) => [telegraf_1.Markup.button.callback("🚚 " + x.name, "courier:" + x.id)]));
}
function getBotUsername() {
    return BOT_USERNAME || (bot.botInfo?.username || "");
}
function deliveryDoneKeyboard() {
    return telegraf_1.Markup.inlineKeyboard([
        [telegraf_1.Markup.button.callback("✅ Tayyor", "finish_delivery_photos")]
    ]);
}
function paymentText(order) {
    if (order.paymentType === "paid")
        return "✅ To‘langan";
    if (order.paymentType === "cash")
        return "💰 Pul olish kerak";
    return "➖ Tanlanmagan";
}
function statusText(status) {
    if (status === "scheduled")
        return "📦 Xraneniya";
    if (status === "created")
        return "🆕 Yangi";
    if (status === "assembled")
        return "📦 Sobrano";
    if (status === "delivered")
        return "✅ Dostavlena";
    if (status === "cancelled")
        return "❌ Bekor qilingan";
    return "📝 Draft";
}
function formatItems(items = []) {
    if (!items.length)
        return "Mahsulot yo‘q";
    const groups = new Map();
    let index = 1;
    for (const item of items) {
        const sklad = item.warehouseName || "-";
        if (!groups.has(sklad))
            groups.set(sklad, []);
        const unit = (item.unit || "X").toUpperCase();
        const qtyText = item.quantity && item.quantity > 0 ? ` - ${item.quantity}${unit}` : "";
        const name = String(item.name || "").toUpperCase();
        groups.get(sklad).push(`<b>${index}) ${escapeHtml(name + qtyText)}</b>`);
        index++;
    }
    return Array.from(groups.entries())
        .map(([sklad, names]) => `${names.join("\n\n")}\n\n Sklad: ${escapeHtml(sklad)}`)
        .join("\n\n");
}
function formatOrder(order) {
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
        `🕒 Yetkazish vaqti: ${escapeHtml(order.deliveryTime || "-")}`
    ];
    if (order.type !== "moysklad") {
        lines.push(`🚚 Dostavshik: ${escapeHtml(order.courierName || "-")}`);
    }
    if (order.comment) {
        lines.push("");
        lines.push("📝 KOMMENTARIYA:");
        lines.push(escapeHtml(order.comment));
    }
    if (order.courierComment) {
        lines.push("");
        lines.push("💬 Dostavshik kommenti:");
        lines.push(escapeHtml(order.courierComment));
    }
    if (order.type !== "moysklad") {
        lines.push("");
        lines.push(`💳 To‘lov: ${paymentText(order)}`);
        if (order.amount !== undefined && order.amount !== null) {
            lines.push(`💵 Summa: ${order.amount} ${order.currency || ""}`);
        }
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
    if (order.managerName) {
        lines.push("");
        lines.push(`👨‍💼 Manager: ${escapeHtml(order.managerName)}`);
    }
    lines.push("");
    lines.push("━━━━━━━━━━━━━━━━━━━━");
    return lines.join("\n").trim();
}
function deliveryButtons(order) {
    if (order.status === "created") {
        return telegraf_1.Markup.inlineKeyboard([
            [telegraf_1.Markup.button.callback("📦 SOBRANO", "assemble:" + order.id)],
            [telegraf_1.Markup.button.callback("💬 KOMMENTARIYA", "comment:" + order.id)]
        ]);
    }
    if (order.status === "assembled") {
        const username = getBotUsername();
        if (username) {
            return telegraf_1.Markup.inlineKeyboard([
                [telegraf_1.Markup.button.url("✅ DOSTAVLENA", `https://t.me/${username}?start=deliver_${order.id}`)],
                [telegraf_1.Markup.button.callback("💬 KOMMENTARIYA", "comment:" + order.id)]
            ]);
        }
        return telegraf_1.Markup.inlineKeyboard([
            [telegraf_1.Markup.button.callback("✅ DOSTAVLENA", "deliver:" + order.id)],
            [telegraf_1.Markup.button.callback("💬 KOMMENTARIYA", "comment:" + order.id)]
        ]);
    }
    return undefined;
}
function parseScheduleInput(input) {
    const text = input.trim();
    const direct = new Date(text.replace(" ", "T"));
    if (!Number.isNaN(direct.getTime()))
        return direct.toISOString();
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
async function showConfirm(ctx, draft) {
    await ctx.reply(formatOrder(draft), htmlOptions(telegraf_1.Markup.inlineKeyboard([
        [telegraf_1.Markup.button.callback("✅ Tasdiqlash", "confirm")],
        [telegraf_1.Markup.button.callback("✏️ Tahrirlash", "edit")],
        [telegraf_1.Markup.button.callback("❌ Bekor qilish", "cancel")]
    ])));
}
/* =========================
   MOYSKLAD API
========================= */
async function msFetch(urlOrPath, options = {}) {
    if (!MOYSKLAD_TOKEN)
        throw new Error("MOYSKLAD_TOKEN topilmadi");
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
    let data = {};
    try {
        data = text ? JSON.parse(text) : {};
    }
    catch {
        data = { raw: text };
    }
    if (!res.ok) {
        console.error("MOYSKLAD API ERROR", res.status, data);
        throw new Error(`MoySklad API xato: ${res.status}`);
    }
    return data;
}
function moneyFromMs(value) {
    const n = Number(value || 0);
    return Math.round((n / 100) * 100) / 100;
}
function detectCurrency(msOrder) {
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
    if (raw.includes("usd") || raw.includes("дол") || raw.includes("dollar"))
        return "USD";
    return "UZS";
}
function getAgentPhone(agent) {
    const phones = [
        agent?.phone,
        agent?.mobile,
        agent?.fax
    ].filter(Boolean);
    if (Array.isArray(agent?.contactpersons?.rows)) {
        for (const c of agent.contactpersons.rows) {
            if (c?.phone)
                phones.push(c.phone);
            if (c?.mobile)
                phones.push(c.mobile);
        }
    }
    return String(phones[0] || "-");
}
function getAgentAddress(msOrder) {
    return (msOrder?.shipmentAddress ||
        msOrder?.agent?.actualAddress ||
        msOrder?.agent?.legalAddress ||
        msOrder?.agent?.address ||
        "-");
}
function getMsComment(msOrder) {
    const attrs = Array.isArray(msOrder?.attributes) ? msOrder.attributes : [];
    const attrComment = attrs.find((a) => {
        const name = String(a?.name || "").toLowerCase();
        return (name.includes("comment") ||
            name.includes("коммент") ||
            name.includes("izoh") ||
            name.includes("изоҳ"));
    })?.value;
    return String(msOrder?.description ||
        msOrder?.comment ||
        msOrder?.shipmentAddressFull?.comment ||
        attrComment ||
        "").trim();
}
async function findCustomerOrderStateByName(name) {
    const meta = await msFetch("/entity/customerorder/metadata");
    const states = meta?.states || [];
    return (states.find((x) => String(x.name || "").toLowerCase() === name.toLowerCase()) ||
        null);
}
async function fetchPositions(msOrder) {
    if (msOrder?.positions?.rows)
        return msOrder.positions.rows;
    const href = msOrder?.positions?.meta?.href;
    if (!href)
        return [];
    const data = await msFetch(href + "?expand=assortment,store&limit=100");
    return data?.rows || [];
}
function msOrderNumber(msOrder) {
    return String(msOrder?.name || msOrder?.id || Date.now());
}
async function convertMsOrderToLocalOrder(msOrder) {
    const positions = await fetchPositions(msOrder);
    const currency = detectCurrency(msOrder);
    const sum = moneyFromMs(msOrder?.sum);
    const payedSum = moneyFromMs(msOrder?.payedSum);
    const debt = Math.max(0, Math.round((sum - payedSum) * 100) / 100);
    const isPaid = sum > 0 && payedSum >= sum;
    const items = positions.map((p) => {
        const productName = p?.assortment?.name ||
            p?.name ||
            p?.assortment?.code ||
            "Mahsulot";
        const warehouseName = p?.store?.name ||
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
        deliveryTime: msOrder?.deliveryPlannedMoment || "-",
        paymentType: isPaid ? "paid" : "cash",
        amount: debt || sum,
        currency,
        courierId: 0,
        courierName: "",
        status: "created",
        createdBy: 0,
        createdAt: new Date().toISOString(),
        comment: getMsComment(msOrder),
        moyskladId: msOrder?.id,
        moyskladHref: msOrder?.meta?.href,
        moyskladName: msOrder?.name
    };
}
async function syncMoySkladDeliveryOrders() {
    if (!MOYSKLAD_TOKEN)
        return;
    if (moyskladSyncRunning)
        return;
    moyskladSyncRunning = true;
    try {
        const deliveryState = await findCustomerOrderStateByName(MOYSKLAD_DELIVERY_STATE_NAME);
        if (!deliveryState?.meta?.href) {
            console.error("MoySklad status topilmadi:", MOYSKLAD_DELIVERY_STATE_NAME);
            return;
        }
        const url = `/entity/customerorder?limit=50` +
            `&order=updated,desc` +
            `&expand=agent,store,state`;
        const data = await msFetch(url);
        const rows = data?.rows || [];
        const orders = await getOrders();
        for (const msOrder of rows) {
            const stateName = String(msOrder?.state?.name || "");
            if (stateName.toLowerCase() !== MOYSKLAD_DELIVERY_STATE_NAME.toLowerCase())
                continue;
            const msId = String(msOrder?.id || "");
            const msHref = String(msOrder?.meta?.href || "");
            const msName = String(msOrder?.name || "");
            const alreadyExists = orders.some((x) => {
                return ((msId && x.moyskladId === msId) ||
                    (msHref && x.moyskladHref === msHref) ||
                    (msName && x.moyskladName === msName) ||
                    (msName && x.id === "MS-" + msName));
            });
            if (alreadyExists) {
                continue;
            }
            const localOrder = await convertMsOrderToLocalOrder(msOrder);
            const msg = await bot.telegram.sendMessage(DELIVERY_GROUP_ID, formatOrder(localOrder), htmlOptions(deliveryButtons(localOrder)));
            localOrder.deliveryGroupMessageId = msg.message_id;
            orders.push(localOrder);
            await saveOrders(orders);
            console.log("MoySklad zayavka yuborildi:", localOrder.id);
        }
    }
    catch (err) {
        console.error("MoySklad sync error:", err);
    }
    finally {
        moyskladSyncRunning = false;
    }
}
async function updateMoySkladOrderToDelivered(order) {
    if (!MOYSKLAD_TOKEN)
        return;
    if (!order.moyskladHref)
        return;
    const deliveredState = await findCustomerOrderStateByName(MOYSKLAD_DELIVERED_STATE_NAME);
    if (!deliveredState?.meta) {
        console.error("MoySklad delivered status topilmadi:", MOYSKLAD_DELIVERED_STATE_NAME);
        return;
    }
    await msFetch(order.moyskladHref, {
        method: "PUT",
        body: JSON.stringify({
            state: {
                meta: deliveredState.meta
            }
        })
    });
    console.log("MoySklad status Доставлен qilindi:", order.id);
}
async function startDeliveryPhotoSession(ctx, orderId) {
    const orders = await getOrders();
    const order = orders.find((x) => x.id === orderId);
    if (!order) {
        await ctx.reply("Zayavka topilmadi");
        return;
    }
    if (order.status !== "assembled") {
        await ctx.reply("Avval SOBRANO bosilishi kerak");
        return;
    }
    deliveryPhotoSessions.set(ctx.from.id, {
        orderId,
        photos: []
    });
    await ctx.reply([
        "📸 Yetkazilganini tasdiqlash uchun rasmlarni shu chatga yuboring.",
        "",
        "1 tadan 10 tagacha rasm yuborishingiz mumkin.",
        "Hammasini yuborib bo‘lgach ✅ Tayyor tugmasini bosing.",
        "",
        `📋 Zayavka: ${order.id}`
    ].join("\n"), deliveryDoneKeyboard());
}
async function finishDeliveryPhotoSession(ctx) {
    const session = deliveryPhotoSessions.get(ctx.from.id);
    if (!session) {
        await ctx.answerCbQuery?.("Aktiv rasm sessiyasi yo‘q");
        return;
    }
    if (!session.photos.length) {
        await ctx.answerCbQuery?.("Avval kamida 1 ta rasm yuboring");
        await ctx.reply("Avval kamida 1 ta rasm yuboring 📸");
        return;
    }
    const orderId = session.orderId;
    if (locks.has(orderId))
        return;
    locks.add(orderId);
    try {
        const orders = await getOrders();
        const order = orders.find((x) => x.id === orderId);
        if (!order) {
            deliveryPhotoSessions.delete(ctx.from.id);
            await ctx.reply("Zayavka topilmadi");
            return;
        }
        order.status = "delivered";
        order.deliveredAt = new Date().toISOString();
        order.deliveredPhotoFileId = session.photos[0];
        if (order.moyskladHref) {
            try {
                await updateMoySkladOrderToDelivered(order);
            }
            catch (e) {
                console.error("MoySklad delivered update error:", e);
                await ctx.reply("⚠️ Telegramda yetkazildi, lekin MoySkladda status o‘zgarmadi. Railway logsni tekshir.");
            }
        }
        await saveOrders(orders);
        deliveryPhotoSessions.delete(ctx.from.id);
        waitingPhoto.delete(ctx.from.id);
        if (order.deliveryGroupMessageId) {
            await bot.telegram.editMessageText(DELIVERY_GROUP_ID, order.deliveryGroupMessageId, undefined, formatOrder(order), htmlOptions());
            console.log("DELETE TIMER STARTED", order.deliveryGroupMessageId);
            setTimeout(async () => {
                console.log("DELETING MESSAGE", order.deliveryGroupMessageId);
                try {
                    await bot.telegram.deleteMessage(DELIVERY_GROUP_ID, order.deliveryGroupMessageId);
                }
                catch (e) {
                    console.error("Delivery group message delete error:", e);
                }
            }, 60000);
        }
        const caption = [
            "✅ YETKAZILDI",
            "",
            formatOrder(order),
            "",
            "🕒 Yetkazilgan vaqt:",
            escapeHtml(new Date().toLocaleString("ru-RU"))
        ].join("\n");
        const photos = session.photos.slice(0, 10);
        if (photos.length === 1) {
            await bot.telegram.sendPhoto(REPORT_GROUP_ID, photos[0], {
                parse_mode: "HTML",
                caption
            });
        }
        else {
            await bot.telegram.sendMediaGroup(REPORT_GROUP_ID, photos.map((fileId, index) => ({
                type: "photo",
                media: fileId,
                ...(index === 0 ? { caption, parse_mode: "HTML" } : {})
            })));
        }
        await ctx.answerCbQuery?.("✅ Tayyor");
        await ctx.reply("✅ Yetkazildi, rasmlar otchet gruppaga yuborildi va status yangilandi");
    }
    finally {
        locks.delete(orderId);
    }
}
/* =========================
   EXCEL DELIVERY IMPORT
========================= */
function excelCell(sheet, address) {
    const cell = sheet[address];
    if (!cell || cell.v === undefined || cell.v === null)
        return "";
    return String(cell.v).trim();
}
function afterColon(value) {
    const text = String(value || "").trim();
    const idx = text.indexOf(":");
    if (idx === -1)
        return text;
    return text.slice(idx + 1).trim();
}
function extractPhone(text) {
    const match = String(text || "").match(/(?:\+?998)?[\s\-()]*\d[\d\s\-()]{6,}\d/g);
    if (!match?.length)
        return "";
    return match[0].replace(/[^\d+]/g, "");
}
function stripPhoneFromName(text) {
    return String(text || "")
        .replace(/(?:\+?998)?[\s\-()]*\d[\d\s\-()]{6,}\d/g, "")
        .replace(/[:;]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function parseQty(value) {
    const text = String(value || "").replace(",", ".");
    const match = text.match(/\d+(\.\d+)?/);
    if (!match)
        return 1;
    const n = Number(match[0]);
    return Number.isFinite(n) && n > 0 ? n : 1;
}
function parseQtyWithUnit(value) {
    const text = String(value || "").trim();
    const quantity = parseQty(text);
    const unitMatch = text.match(/[A-Za-zА-Яа-яЁё]+/);
    const unit = unitMatch ? unitMatch[0].toUpperCase() : "X";
    return { quantity, unit };
}
function parseMoney(value) {
    const text = String(value || "")
        .replace(/\s/g, "")
        .replace(",", ".")
        .replace(/[^\d.]/g, "");
    const n = Number(text);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}
function detectPaymentFromExcel(sheet) {
    const row8Values = [];
    for (const col of ["G", "H", "I", "J", "K", "L"]) {
        const value = excelCell(sheet, `${col}8`);
        if (value)
            row8Values.push(value);
    }
    const row8Text = row8Values.join(" ").trim();
    if (!row8Text) {
        return {};
    }
    const afterLabel = afterColon(row8Text);
    const amount = parseMoney(afterLabel) || parseMoney(row8Text);
    if (!amount) {
        return {};
    }
    // 4 xonali songacha: USD. 6 xonali va undan katta: UZS.
    // 5 xonali kam uchraydi, xavfsiz default sifatida USD qoldiramiz.
    const currency = amount >= 100000 ? "UZS" : "USD";
    return { amount, currency };
}
function findFirstNonEmpty(sheet, addresses) {
    for (const address of addresses) {
        const value = excelCell(sheet, address);
        if (value)
            return value;
    }
    return "";
}
function getExcelComment(sheet) {
    const values = [
        excelCell(sheet, "A10"),
        excelCell(sheet, "B10"),
        excelCell(sheet, "C10"),
        excelCell(sheet, "G10"),
        excelCell(sheet, "H10")
    ]
        .map((x) => String(x || "").trim())
        .filter(Boolean);
    const cleaned = values
        .filter((x) => !/^ком+ент/i.test(x) && !/^comment/i.test(x))
        .join("\n")
        .trim();
    return cleaned || "Excel orqali yaratildi";
}
function parseExcelOrder(buffer, createdBy) {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    let clientRaw = afterColon(findFirstNonEmpty(sheet, ["G5", "F5", "H5"]));
    const addressRaw = afterColon(findFirstNonEmpty(sheet, ["G6", "F6", "H6"]));
    let phoneRaw = afterColon(findFirstNonEmpty(sheet, ["G7", "F7", "H7"]));
    const phoneFromClient = extractPhone(clientRaw);
    if (!phoneRaw && phoneFromClient)
        phoneRaw = phoneFromClient;
    const clientName = stripPhoneFromName(clientRaw) || clientRaw || "-";
    const clientPhone = extractPhone(phoneRaw) || phoneRaw || "-";
    const address = addressRaw || "-";
    const managerRaw = afterColon(findFirstNonEmpty(sheet, ["A7", "B7", "C7"]));
    const managerName = managerRaw || getAdminName(createdBy);
    const items = [];
    for (let row = 14; row <= 60; row++) {
        const productNameRaw = excelCell(sheet, `B${row}`) ||
            excelCell(sheet, `C${row}`) ||
            excelCell(sheet, `D${row}`);
        const productName = String(productNameRaw || "").trim();
        if (!productName)
            continue;
        const lower = productName.toLowerCase();
        if (lower.includes("жами") ||
            lower.includes("jami") ||
            lower.includes("итого") ||
            lower.includes("имзо") ||
            lower.includes("подп")) {
            break;
        }
        const qtyRaw = excelCell(sheet, `G${row}`) ||
            excelCell(sheet, `F${row}`) ||
            excelCell(sheet, `H${row}`);
        const parsedQty = parseQtyWithUnit(qtyRaw);
        items.push({
            name: productName.toUpperCase(),
            warehouseId: "",
            warehouseName: EXCEL_DEFAULT_WAREHOUSE_NAME,
            quantity: parsedQty.quantity,
            unit: parsedQty.unit
        });
    }
    const payment = detectPaymentFromExcel(sheet);
    return {
        id: "XLS-" + Date.now(),
        type: "normal",
        clientName,
        clientPhone,
        address,
        items: items.length ? items : [{
                name: "EXCELDAN MAHSULOT TOPILMADI",
                warehouseId: "",
                warehouseName: EXCEL_DEFAULT_WAREHOUSE_NAME,
                quantity: 1,
                unit: "X"
            }],
        deliveryTime: "-",
        paymentType: payment.amount ? "cash" : "paid",
        amount: payment.amount,
        currency: payment.currency,
        courierId: 0,
        courierName: "",
        managerName,
        status: "created",
        createdBy,
        createdAt: new Date().toISOString(),
        comment: getExcelComment(sheet)
    };
}
async function handleExcelDocument(ctx) {
    const document = ctx.message?.document;
    if (!document)
        return;
    const fileName = String(document.file_name || "").toLowerCase();
    if (!fileName.endsWith(".xlsx") && !fileName.endsWith(".xls")) {
        return;
    }
    try {
        await ctx.reply("📄 Excel qabul qilindi. Zayavka yaratilmoqda...");
        const fileLink = await ctx.telegram.getFileLink(document.file_id);
        const response = await fetch(fileLink.href);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const order = parseExcelOrder(buffer, ctx.from.id);
        const orders = await getOrders();
        const msg = await bot.telegram.sendMessage(DELIVERY_GROUP_ID, formatOrder(order), htmlOptions(deliveryButtons(order)));
        order.deliveryGroupMessageId = msg.message_id;
        orders.push(order);
        await saveOrders(orders);
        await ctx.reply("✅ Excel o‘qildi va zayavka delivery gruppaga yuborildi.");
    }
    catch (e) {
        console.error("EXCEL IMPORT ERROR:", e);
        await ctx.reply("❌ Excel o‘qishda xatolik. Railway Logsda EXCEL IMPORT ERROR ni tekshir.");
    }
}
/* =========================
   BOT HANDLERS
========================= */
bot.start(async (ctx) => {
    const userId = ctx.from?.id;
    const text = ctx.message?.text || "";
    const payload = text.split(" ")[1] || "";
    if (payload.startsWith("deliver_")) {
        const orderId = payload.replace("deliver_", "");
        return startDeliveryPhotoSession(ctx, orderId);
    }
    if (isAdmin(userId)) {
        return ctx.reply("👨‍💼 Admin panel", adminMenu());
    }
    if (isCourier(userId)) {
        return ctx.reply("🚚 Courier panel", courierMenu());
    }
    return ctx.reply("⛔ Ruxsat yo‘q");
});
bot.command("id", async (ctx) => {
    await ctx.reply("🆔 User ID: " + ctx.from.id + "\n💬 Chat ID: " + ctx.chat.id);
});
bot.on("document", async (ctx) => {
    await handleExcelDocument(ctx);
});
bot.command("deliver", async (ctx) => {
    const text = ctx.message?.text || "";
    const orderId = text.split(" ")[1];
    if (!orderId) {
        return ctx.reply("Format: /deliver MS-00031");
    }
    return startDeliveryPhotoSession(ctx, orderId);
});
bot.command("syncms", async (ctx) => {
    if (!isAdmin(ctx.from.id))
        return;
    await ctx.reply("🔄 MoySklad tekshirilmoqda...");
    await syncMoySkladDeliveryOrders();
    await ctx.reply("✅ MoySklad sync tugadi");
});
bot.command("dedupe", async (ctx) => {
    if (!isAdmin(ctx.from.id))
        return;
    const orders = await getOrders();
    const seen = new Set();
    const cleaned = [];
    for (const order of orders) {
        const key = order.moyskladId ||
            order.moyskladHref ||
            order.moyskladName ||
            order.id;
        if (seen.has(key))
            continue;
        seen.add(key);
        cleaned.push(order);
    }
    await saveOrders(cleaned);
    await ctx.reply(`✅ Dublikatlar tozalandi. Oldin: ${orders.length}, hozir: ${cleaned.length}`);
});
bot.command("msdebug", async (ctx) => {
    if (!isAdmin(ctx.from.id))
        return;
    try {
        await ctx.reply("🔍 Debug boshlandi...");
        const meta = await msFetch("/entity/customerorder/metadata");
        const states = (meta?.states || []).map((s) => s.name).join("\n");
        const data = await msFetch("/entity/customerorder?limit=10&order=updated,desc&expand=agent,store,state");
        const ordersText = (data?.rows || [])
            .map((o) => `${o.name} | STATUS: ${o.state?.name || "-"} | CLIENT: ${o.agent?.name || "-"}`)
            .join("\n");
        await ctx.reply("📌 STATUSLAR:\n" + states);
        await ctx.reply("📦 OXIRGI ZAKAZLAR:\n" + (ordersText || "Zakaz topilmadi"));
    }
    catch (e) {
        console.error(e);
        await ctx.reply("❌ MS DEBUG ERROR: " + e.message);
    }
});
bot.hears("🏬 Skladlar", async (ctx) => {
    if (!isAdmin(ctx.from.id))
        return;
    const warehouses = await getWarehouses();
    const text = warehouses.length
        ? warehouses.map((x, i) => `${i + 1}. ${x.name}`).join("\n")
        : "📭 Sklad yo‘q";
    await ctx.reply(text, telegraf_1.Markup.inlineKeyboard([[telegraf_1.Markup.button.callback("➕ Sklad qo‘shish", "add_warehouse")]]));
});
bot.action("add_warehouse", async (ctx) => {
    if (!isAdmin(ctx.from.id))
        return;
    drafts.set(ctx.from.id, { step: "warehouse_name" });
    await ctx.answerCbQuery();
    await ctx.reply("🏬 Sklad nomini kiriting");
});
bot.hears("➕ Zayavka yaratish", async (ctx) => {
    if (!isAdmin(ctx.from.id))
        return;
    drafts.set(ctx.from.id, {
        type: "normal",
        items: [],
        step: "client_name"
    });
    await ctx.reply("👤 Klient ismi");
});
bot.hears("📦 Xraneniya", async (ctx) => {
    if (!isAdmin(ctx.from.id))
        return;
    drafts.set(ctx.from.id, {
        type: "storage",
        items: [],
        step: "client_name"
    });
    await ctx.reply("👤 Klient ismi");
});
bot.hears("📋 Aktiv zayavkalar", async (ctx) => {
    if (!isAdmin(ctx.from.id))
        return;
    const orders = await getOrders();
    const active = orders.filter((x) => x.status === "created" || x.status === "assembled" || x.status === "scheduled");
    if (!active.length)
        return ctx.reply("📭 Aktiv zayavka yo‘q");
    for (const order of active.slice(-10)) {
        await ctx.reply(formatOrder(order), htmlOptions());
    }
});
bot.hears("❌ Bekor qilinganlar", async (ctx) => {
    if (!isAdmin(ctx.from.id))
        return;
    const orders = await getOrders();
    const cancelled = orders.filter((x) => x.status === "cancelled").slice(-10);
    if (!cancelled.length)
        return ctx.reply("📭 Bekor qilingan zayavka yo‘q");
    for (const order of cancelled) {
        await ctx.reply(formatOrder(order), htmlOptions());
    }
});
bot.hears("📊 Otchetlar", async (ctx) => {
    if (!isAdmin(ctx.from.id))
        return;
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
bot.hears("➕ Shoshilinch zayavka", async (ctx) => {
    if (!isCourier(ctx.from.id) && !isAdmin(ctx.from.id))
        return;
    drafts.set(ctx.from.id, {
        type: "normal",
        items: [],
        step: "urgent_model",
        courierId: ctx.from.id,
        courierName: COURIERS.find((x) => x.id === ctx.from.id)?.name || ctx.from.first_name || "Dostavshik",
        status: "delivered",
        createdBy: ctx.from.id,
        createdAt: new Date().toISOString()
    });
    await ctx.reply("🛒 Model/tovar nomini yozing");
});
bot.on("text", async (ctx) => {
    const userId = ctx.from.id;
    const commentOrderId = waitingComment.get(userId);
    if (commentOrderId) {
        const orders = await getOrders();
        const order = orders.find((x) => x.id === commentOrderId);
        if (!order) {
            waitingComment.delete(userId);
            return ctx.reply("Zayavka topilmadi");
        }
        const courier = COURIERS.find((x) => x.id === userId);
        const name = courier?.name || ctx.from.first_name || order.courierName || "Dostavshik";
        order.courierComment = `${name}: ${ctx.message.text.trim()}`;
        await saveOrders(orders);
        waitingComment.delete(userId);
        if (order.deliveryGroupMessageId) {
            await bot.telegram.editMessageText(DELIVERY_GROUP_ID, order.deliveryGroupMessageId, undefined, formatOrder(order), htmlOptions(deliveryButtons(order)));
        }
        return ctx.reply("✅ Kommentariya saqlandi");
    }
    const draft = drafts.get(userId);
    const text = ctx.message.text.trim();
    if (draft?.step === "urgent_model") {
        draft.items = [{
                name: text.toUpperCase(),
                warehouseId: "",
                warehouseName: "-"
            }];
        draft.step = "urgent_comment";
        drafts.set(userId, draft);
        return ctx.reply("💬 Izoh yozing. Masalan: aka Avaz olib ketdilar");
    }
    if (draft?.step === "urgent_comment") {
        const courierName = COURIERS.find((x) => x.id === userId)?.name || ctx.from.first_name || "Dostavshik";
        const order = {
            id: "URG-" + Date.now(),
            type: "normal",
            clientName: "-",
            clientPhone: "-",
            address: "-",
            items: draft.items || [],
            deliveryTime: new Date().toLocaleString("ru-RU"),
            paymentType: "paid",
            courierId: userId,
            courierName,
            status: "delivered",
            createdBy: userId,
            createdAt: new Date().toISOString(),
            deliveredAt: new Date().toISOString(),
            courierComment: `${courierName}: ${text}`
        };
        const orders = await getOrders();
        orders.push(order);
        await saveOrders(orders);
        drafts.delete(userId);
        await bot.telegram.sendMessage(REPORT_GROUP_ID, [
            "🚨 SHOSHILINCH ZAYAVKA",
            "",
            formatOrder(order)
        ].join("\n"), htmlOptions());
        return ctx.reply("✅ Shoshilinch zayavka otchet gruppaga yuborildi", courierMenu());
    }
    if (!isAdmin(userId))
        return;
    if (!draft?.step)
        return;
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
        if (!warehouses.length)
            return ctx.reply("Avval sklad qo‘shing: 🏬 Skladlar");
        draft.step = "item_warehouse";
        drafts.set(userId, draft);
        return ctx.reply("🏬 Qaysi skladdan olinadi?", telegraf_1.Markup.inlineKeyboard(warehouses.map((x) => [telegraf_1.Markup.button.callback(x.name, "warehouse:" + x.id)])));
    }
    if (draft.step === "delivery_time") {
        draft.deliveryTime = text;
        draft.step = "payment";
        drafts.set(userId, draft);
        return ctx.reply("💳 To‘lov turini tanlang", telegraf_1.Markup.inlineKeyboard([
            [telegraf_1.Markup.button.callback("✅ To‘langan", "payment:paid")],
            [telegraf_1.Markup.button.callback("💰 Pul olish kerak", "payment:cash")]
        ]));
    }
    if (draft.step === "amount") {
        const amount = Number(text.replace(/\s/g, "").replace(",", "."));
        if (!Number.isFinite(amount))
            return ctx.reply("Summa faqat raqam bo‘lishi kerak");
        draft.amount = amount;
        draft.step = "currency";
        drafts.set(userId, draft);
        return ctx.reply("💱 Valyutani tanlang", telegraf_1.Markup.inlineKeyboard([[
                telegraf_1.Markup.button.callback("USD", "currency:USD"),
                telegraf_1.Markup.button.callback("UZS", "currency:UZS")
            ]]));
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
bot.action(/^comment:(.+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    const orders = await getOrders();
    const order = orders.find((x) => x.id === orderId);
    if (!order) {
        await ctx.answerCbQuery("Zayavka topilmadi");
        return;
    }
    if (!isAdmin(ctx.from.id) && !isCourier(ctx.from.id)) {
        await ctx.answerCbQuery("Ruxsat yo‘q");
        return;
    }
    waitingComment.set(ctx.from.id, orderId);
    await ctx.answerCbQuery();
    await ctx.reply("💬 Kommentariya yozing. Masalan: yetkazib berdim 1600$ oldim");
});
bot.action("finish_delivery_photos", async (ctx) => {
    await finishDeliveryPhotoSession(ctx);
});
bot.action(/^warehouse:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id))
        return;
    const draft = drafts.get(ctx.from.id);
    if (!draft)
        return;
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
    return ctx.reply("➕ Yana mahsulot qo‘shasizmi?", telegraf_1.Markup.inlineKeyboard([
        [telegraf_1.Markup.button.callback("✅ Ha", "add_more")],
        [telegraf_1.Markup.button.callback("➡️ Davom etish", "finish_items")]
    ]));
});
bot.action("add_more", async (ctx) => {
    const draft = drafts.get(ctx.from.id);
    if (!draft)
        return;
    draft.step = "item_name";
    drafts.set(ctx.from.id, draft);
    await ctx.answerCbQuery();
    await ctx.reply("🛒 Mahsulot nomi");
});
bot.action("finish_items", async (ctx) => {
    const draft = drafts.get(ctx.from.id);
    if (!draft)
        return;
    draft.step = "delivery_time";
    drafts.set(ctx.from.id, draft);
    await ctx.answerCbQuery();
    await ctx.reply("🕒 Yetkazish vaqti. Masalan: 18:00");
});
bot.action(/^payment:(.+)$/, async (ctx) => {
    const draft = drafts.get(ctx.from.id);
    if (!draft)
        return;
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
bot.action(/^currency:(USD|UZS)$/, async (ctx) => {
    const draft = drafts.get(ctx.from.id);
    if (!draft)
        return;
    draft.currency = ctx.match[1];
    draft.step = "courier";
    drafts.set(ctx.from.id, draft);
    await ctx.answerCbQuery();
    return ctx.reply("🚚 Dostavshik tanlang", courierKeyboard());
});
bot.action(/^courier:(.+)$/, async (ctx) => {
    const draft = drafts.get(ctx.from.id);
    if (!draft)
        return;
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
bot.action("edit", async (ctx) => {
    if (!isAdmin(ctx.from.id))
        return;
    await ctx.answerCbQuery();
    await ctx.reply("✏️ Nimani tahrirlaymiz?", telegraf_1.Markup.inlineKeyboard([
        [telegraf_1.Markup.button.callback("👤 Klient ismi", "edit:client_name")],
        [telegraf_1.Markup.button.callback("📞 Telefon", "edit:client_phone")],
        [telegraf_1.Markup.button.callback("📍 Manzil", "edit:address")],
        [telegraf_1.Markup.button.callback("🛒 Tovarlarni qayta kiritish", "edit:items")],
        [telegraf_1.Markup.button.callback("🕒 Vaqt", "edit:delivery_time")],
        [telegraf_1.Markup.button.callback("💳 To‘lov", "edit:payment")],
        [telegraf_1.Markup.button.callback("🚚 Dostavshik", "edit:courier")]
    ]));
});
bot.action(/^edit:(.+)$/, async (ctx) => {
    const draft = drafts.get(ctx.from.id);
    if (!draft)
        return;
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
        return ctx.reply("💳 To‘lov turini tanlang", telegraf_1.Markup.inlineKeyboard([
            [telegraf_1.Markup.button.callback("✅ To‘langan", "payment:paid")],
            [telegraf_1.Markup.button.callback("💰 Pul olish kerak", "payment:cash")]
        ]));
    }
    if (field === "courier") {
        draft.step = "courier";
        drafts.set(ctx.from.id, draft);
        return ctx.reply("🚚 Dostavshik tanlang", courierKeyboard());
    }
});
bot.action("cancel", async (ctx) => {
    drafts.delete(ctx.from.id);
    await ctx.answerCbQuery();
    await ctx.reply("❌ Bekor qilindi", adminMenu());
});
bot.action("confirm", async (ctx) => {
    const userId = ctx.from.id;
    try {
        const draft = drafts.get(userId);
        if (!draft) {
            await ctx.answerCbQuery("Draft topilmadi");
            await ctx.reply("❌ Draft topilmadi. Zayavkani boshidan yarating.");
            return;
        }
        const order = {
            id: "ORD-" + Date.now(),
            type: (draft.type || "normal"),
            clientName: draft.clientName || "",
            clientPhone: draft.clientPhone || "",
            address: draft.address || "",
            items: draft.items || [],
            deliveryTime: draft.deliveryTime || "",
            paymentType: (draft.paymentType || "paid"),
            amount: draft.amount,
            currency: draft.currency,
            courierId: draft.courierId || 0,
            courierName: draft.courierName || "",
            managerName: getAdminName(userId),
            status: draft.type === "storage" ? "scheduled" : "created",
            scheduledAt: draft.scheduledAt,
            createdBy: userId,
            createdAt: new Date().toISOString(),
            comment: draft.comment,
            courierComment: draft.courierComment
        };
        const orders = await getOrders();
        if (order.type === "normal") {
            const msg = await bot.telegram.sendMessage(DELIVERY_GROUP_ID, formatOrder(order), htmlOptions(deliveryButtons(order)));
            order.deliveryGroupMessageId = msg.message_id;
        }
        orders.push(order);
        await saveOrders(orders);
        drafts.delete(userId);
        await ctx.answerCbQuery("✅ Tasdiqlandi");
        await ctx.reply("✅ Zayavka saqlandi", adminMenu());
    }
    catch (e) {
        console.error("CONFIRM ERROR:", e);
        await ctx.answerCbQuery("Xatolik");
        await ctx.reply("❌ Zayavka yuborilmadi. Railway Logsda CONFIRM ERROR ni ko‘r.");
    }
});
bot.action(/^assemble:(.+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    if (locks.has(orderId))
        return;
    locks.add(orderId);
    try {
        const orders = await getOrders();
        const order = orders.find((x) => x.id === orderId);
        if (!order) {
            await ctx.answerCbQuery("Zayavka topilmadi");
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
            await bot.telegram.editMessageText(DELIVERY_GROUP_ID, order.deliveryGroupMessageId, undefined, formatOrder(order), htmlOptions(deliveryButtons(order)));
        }
        await ctx.answerCbQuery("📦 SOBRANO");
    }
    finally {
        locks.delete(orderId);
    }
});
bot.action(/^deliver:(.+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    await ctx.answerCbQuery();
    return startDeliveryPhotoSession(ctx, orderId);
});
bot.on("photo", async (ctx) => {
    const session = deliveryPhotoSessions.get(ctx.from.id);
    if (!session)
        return;
    if (session.photos.length >= 10) {
        return ctx.reply("10 ta rasm qabul qilindi. Endi ✅ Tayyor tugmasini bosing.", deliveryDoneKeyboard());
    }
    const photos = ctx.message.photo;
    const photo = photos[photos.length - 1];
    session.photos.push(photo.file_id);
    deliveryPhotoSessions.set(ctx.from.id, session);
    if (session.photos.length === 1) {
        await ctx.reply("📸 Yetkazilgan mahsulot rasmlarini yuboring.\n\nBir nechta rasm yuborishingiz mumkin.\n\nTugatgach pastdagi ✅ Tayyor tugmasini bosing.", deliveryDoneKeyboard());
    }
});
bot.action(/^cancel_real:(.+)$/, async (ctx) => {
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
        await bot.telegram.editMessageText(DELIVERY_GROUP_ID, order.deliveryGroupMessageId, undefined, formatOrder(order), htmlOptions());
    }
    await ctx.answerCbQuery("❌ Bekor qilindi");
});
setInterval(async () => {
    const orders = await getOrders();
    const now = Date.now();
    let changed = false;
    for (const order of orders) {
        if (order.type !== "storage")
            continue;
        if (order.status !== "scheduled")
            continue;
        if (!order.scheduledAt)
            continue;
        const time = new Date(order.scheduledAt).getTime();
        if (!Number.isFinite(time))
            continue;
        if (time > now)
            continue;
        order.status = "created";
        const msg = await bot.telegram.sendMessage(DELIVERY_GROUP_ID, "📦 XRANENIYADAN CHIQDI\n\n" + formatOrder(order), htmlOptions(deliveryButtons(order)));
        order.deliveryGroupMessageId = msg.message_id;
        changed = true;
    }
    if (changed)
        await saveOrders(orders);
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
console.log("DIGI DOSTAVKA — EXCEL ITEM FORMAT UPDATE RUNNING");
process.once("SIGINT", () => {
    bot.stop("SIGINT");
});
process.once("SIGTERM", () => {
    bot.stop("SIGTERM");
});
