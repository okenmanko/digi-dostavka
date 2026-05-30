"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const telegraf_1 = require("telegraf");
const dotenv_1 = __importDefault(require("dotenv"));
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
dotenv_1.default.config();
const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN)
    throw new Error("BOT_TOKEN .env ichida yo'q");
const bot = new telegraf_1.Telegraf(TOKEN);
const ADMIN_IDS = parseIds(process.env.ADMIN_IDS);
const COURIER_IDS = parseIds(process.env.COURIER_IDS);
const COURIERS = parseCouriers(process.env.COURIERS, COURIER_IDS);
const DELIVERY_GROUP_ID = Number(process.env.DELIVERY_GROUP_ID);
const REPORT_GROUP_ID = Number(process.env.REPORT_GROUP_ID);
const DATA_DIR = path_1.default.join(process.cwd(), "data");
const ORDERS_FILE = path_1.default.join(DATA_DIR, "orders.json");
const WAREHOUSES_FILE = path_1.default.join(DATA_DIR, "warehouses.json");
const drafts = new Map();
const waitingPhoto = new Map();
const locks = new Set();
function parseIds(value) {
    return (value || "")
        .split(",")
        .map((x) => Number(x.trim()))
        .filter((x) => Number.isFinite(x) && x > 0);
}
function parseCouriers(value, fallbackIds) {
    if (!value) {
        return fallbackIds.map((id) => ({
            id,
            name: `Courier ${id}`,
        }));
    }
    return value
        .split(",")
        .map((part) => {
        const [idRaw, nameRaw] = part.split(":");
        const id = Number(idRaw.trim());
        return {
            id,
            name: nameRaw?.trim() || `Courier ${id}`,
        };
    })
        .filter((x) => Number.isFinite(x.id) && x.id > 0);
}
function isAdmin(id) {
    return !!id && ADMIN_IDS.includes(id);
}
function isCourier(id) {
    return !!id && COURIERS.some((c) => c.id === id);
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
    await writeJson(ORDERS_FILE, orders);
}
async function getWarehouses() {
    return readJson(WAREHOUSES_FILE, []);
}
async function saveWarehouses(warehouses) {
    await writeJson(WAREHOUSES_FILE, warehouses);
}
function adminMenu() {
    return telegraf_1.Markup.keyboard([
        ["➕ Zayavka yaratish"],
        ["📦 Aktiv zayavkalar", "🏬 Skladlar"],
        ["📊 Otchetlar", "❌ Bekor qilinganlar"],
    ]).resize();
}
function paymentText(status) {
    if (status === "paid")
        return "✅ To‘langan";
    if (status === "unpaid")
        return "💰 To‘lanmagan";
    return "🚫 Pul olinmaydi";
}
function statusText(status) {
    if (status === "created")
        return "🆕 Yangi";
    if (status === "assembled")
        return "📦 Собрано";
    if (status === "delivered")
        return "✅ Доставлена";
    return "❌ Bekor qilingan";
}
function formatOrder(order) {
    const items = order.items.length
        ? order.items.map((x, i) => `${i + 1}. ${x.name} → ${x.warehouseName}`).join("\n")
        : "Mahsulot yo‘q";
    return `
📦 ZAYAVKA: ${order.id}

Status: ${statusText(order.status)}

👤 Mijoz: ${order.clientName}
📞 Telefon: ${order.clientPhone}
📍 Manzil: ${order.address}

🛒 Mahsulotlar:
${items}

🕒 Yetkazish vaqti: ${order.deliveryTime}

💰 Summa: ${order.amount} ${order.currency}
💳 To‘lov: ${paymentText(order.paymentStatus)}

🚚 Dostavshik: ${order.courierName}
`.trim();
}
function deliveryButtons(order) {
    if (order.status === "created") {
        return telegraf_1.Markup.inlineKeyboard([
            [telegraf_1.Markup.button.callback("📦 Собрано", `assemble:${order.id}`)],
            [telegraf_1.Markup.button.callback("❌ Bekor qilish", `cancel:${order.id}`)],
        ]);
    }
    if (order.status === "assembled") {
        return telegraf_1.Markup.inlineKeyboard([
            [telegraf_1.Markup.button.callback("✅ Доставлена", `deliver:${order.id}`)],
        ]);
    }
    return undefined;
}
async function updateDeliveryMessage(ctx, order) {
    if (!order.deliveryGroupMessageId)
        return;
    try {
        await ctx.telegram.editMessageText(DELIVERY_GROUP_ID, order.deliveryGroupMessageId, undefined, formatOrder(order), deliveryButtons(order));
    }
    catch (err) {
        console.log("Message update error:", err);
    }
}
async function withLock(orderId, fn) {
    if (locks.has(orderId))
        return;
    locks.add(orderId);
    try {
        await fn();
    }
    finally {
        locks.delete(orderId);
    }
}
bot.start(async (ctx) => {
    const userId = ctx.from?.id;
    if (isAdmin(userId)) {
        return ctx.reply("Admin panel ✅", adminMenu());
    }
    if (isCourier(userId)) {
        return ctx.reply("Dostavshik panel ✅\nZayavkalar guruhga keladi.");
    }
    return ctx.reply("Sizda ruxsat yo‘q ❌");
});
bot.command("id", async (ctx) => {
    await ctx.reply(`User ID: ${ctx.from.id}\nChat ID: ${ctx.chat.id}`);
});
bot.hears("➕ Zayavka yaratish", async (ctx) => {
    if (!isAdmin(ctx.from.id))
        return;
    drafts.set(ctx.from.id, {
        step: "clientName",
        items: [],
        createdBy: ctx.from.id,
    });
    await ctx.reply("👤 Mijoz ismini yozing:");
});
bot.hears("🏬 Skladlar", async (ctx) => {
    if (!isAdmin(ctx.from.id))
        return;
    const warehouses = await getWarehouses();
    const text = warehouses.length
        ? warehouses.map((w, i) => `${i + 1}. ${w.name}`).join("\n")
        : "Skladlar hali yo‘q.";
    await ctx.reply(`🏬 Skladlar:\n\n${text}`, telegraf_1.Markup.inlineKeyboard([
        [telegraf_1.Markup.button.callback("➕ Sklad qo‘shish", "warehouse:add")],
    ]));
});
bot.action("warehouse:add", async (ctx) => {
    if (!isAdmin(ctx.from?.id))
        return;
    drafts.set(ctx.from.id, { step: "addWarehouse" });
    await ctx.answerCbQuery();
    await ctx.reply("Yangi sklad nomini yozing:");
});
bot.hears("📦 Aktiv zayavkalar", async (ctx) => {
    if (!isAdmin(ctx.from.id))
        return;
    const orders = await getOrders();
    const active = orders.filter((o) => o.status === "created" || o.status === "assembled");
    if (!active.length)
        return ctx.reply("Aktiv zayavkalar yo‘q.");
    for (const order of active.slice(-10)) {
        await ctx.reply(formatOrder(order), telegraf_1.Markup.inlineKeyboard([
            [telegraf_1.Markup.button.callback("❌ Bekor qilish", `cancel:${order.id}`)],
        ]));
    }
});
bot.hears("❌ Bekor qilinganlar", async (ctx) => {
    if (!isAdmin(ctx.from.id))
        return;
    const orders = await getOrders();
    const cancelled = orders.filter((o) => o.status === "cancelled").slice(-10);
    if (!cancelled.length)
        return ctx.reply("Bekor qilingan zayavkalar yo‘q.");
    for (const order of cancelled) {
        await ctx.reply(formatOrder(order));
    }
});
bot.hears("📊 Otchetlar", async (ctx) => {
    if (!isAdmin(ctx.from.id))
        return;
    const orders = await getOrders();
    const today = new Date().toISOString().slice(0, 10);
    const todayOrders = orders.filter((o) => o.createdAt.slice(0, 10) === today);
    const created = todayOrders.filter((o) => o.status === "created").length;
    const assembled = todayOrders.filter((o) => o.status === "assembled").length;
    const delivered = todayOrders.filter((o) => o.status === "delivered").length;
    const cancelled = todayOrders.filter((o) => o.status === "cancelled").length;
    const itemCount = todayOrders.reduce((sum, o) => sum + o.items.length, 0);
    await ctx.reply(`
📊 BUGUNGI OTCHET

📦 Jami zayavka: ${todayOrders.length}
🛒 Tovar soni: ${itemCount}

🆕 Yangi: ${created}
📦 Собрано: ${assembled}
✅ Yetkazilgan: ${delivered}
❌ Bekor qilingan: ${cancelled}
`.trim());
});
bot.on("photo", async (ctx) => {
    const userId = ctx.from.id;
    const orderId = waitingPhoto.get(userId);
    if (!orderId)
        return;
    await withLock(orderId, async () => {
        const orders = await getOrders();
        const order = orders.find((o) => o.id === orderId);
        if (!order) {
            await ctx.reply("Zayavka topilmadi.");
            return;
        }
        if (order.status === "delivered") {
            await ctx.reply("Bu zayavka oldin yopilgan.");
            return;
        }
        const photos = ctx.message.photo;
        const fileId = photos[photos.length - 1].file_id;
        order.status = "delivered";
        order.deliveredAt = new Date().toISOString();
        order.deliveredPhotoFileId = fileId;
        await saveOrders(orders);
        waitingPhoto.delete(userId);
        await updateDeliveryMessage(ctx, order);
        await ctx.telegram.sendPhoto(REPORT_GROUP_ID, fileId, {
            caption: `
✅ YETKAZILDI

${formatOrder(order)}

🕒 Yetkazilgan vaqt: ${new Date().toLocaleString("ru-RU")}
`.trim(),
        });
        await ctx.reply("✅ Yetkazildi va otchet yuborildi.");
    });
});
bot.on("text", async (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId))
        return;
    const draft = drafts.get(userId);
    if (!draft?.step)
        return;
    const text = ctx.message.text.trim();
    if (draft.step === "addWarehouse") {
        const warehouses = await getWarehouses();
        warehouses.push({
            id: (0, crypto_1.randomUUID)(),
            name: text,
        });
        await saveWarehouses(warehouses);
        drafts.delete(userId);
        await ctx.reply("✅ Sklad qo‘shildi.", adminMenu());
        return;
    }
    if (draft.step === "clientName") {
        draft.clientName = text;
        draft.step = "clientPhone";
        drafts.set(userId, draft);
        await ctx.reply("📞 Telefon raqamini yozing:");
        return;
    }
    if (draft.step === "clientPhone") {
        draft.clientPhone = text;
        draft.step = "address";
        drafts.set(userId, draft);
        await ctx.reply("📍 Manzilni yozing:");
        return;
    }
    if (draft.step === "address") {
        draft.address = text;
        draft.step = "itemName";
        drafts.set(userId, draft);
        await ctx.reply("🛒 Mahsulot nomini yozing:");
        return;
    }
    if (draft.step === "itemName") {
        draft.tempItemName = text;
        const warehouses = await getWarehouses();
        if (!warehouses.length) {
            await ctx.reply("Avval sklad qo‘shing: 🏬 Skladlar");
            return;
        }
        draft.step = "itemWarehouse";
        drafts.set(userId, draft);
        await ctx.reply("Qaysi skladdan olinadi?", telegraf_1.Markup.inlineKeyboard(warehouses.map((w) => [
            telegraf_1.Markup.button.callback(w.name, `itemwh:${w.id}`),
        ])));
        return;
    }
    if (draft.step === "deliveryTime") {
        draft.deliveryTime = text;
        draft.step = "amount";
        drafts.set(userId, draft);
        await ctx.reply("💰 Summa yozing:");
        return;
    }
    if (draft.step === "amount") {
        const amount = Number(text.replace(/\s/g, "").replace(",", "."));
        if (!Number.isFinite(amount)) {
            await ctx.reply("Summa noto‘g‘ri. Faqat raqam yozing.");
            return;
        }
        draft.amount = amount;
        draft.step = "currency";
        drafts.set(userId, draft);
        await ctx.reply("Valyutani tanlang:", telegraf_1.Markup.inlineKeyboard([
            [
                telegraf_1.Markup.button.callback("USD", "currency:USD"),
                telegraf_1.Markup.button.callback("UZS", "currency:UZS"),
            ],
        ]));
        return;
    }
});
bot.action(/^itemwh:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from?.id))
        return;
    const userId = ctx.from.id;
    const warehouseId = ctx.match[1];
    const draft = drafts.get(userId);
    const warehouses = await getWarehouses();
    const warehouse = warehouses.find((w) => w.id === warehouseId);
    if (!draft || !warehouse || !draft.tempItemName) {
        await ctx.answerCbQuery("Xatolik");
        return;
    }
    draft.items = draft.items || [];
    draft.items.push({
        name: draft.tempItemName,
        warehouseId: warehouse.id,
        warehouseName: warehouse.name,
    });
    draft.tempItemName = undefined;
    draft.step = "addMoreItems";
    drafts.set(userId, draft);
    await ctx.answerCbQuery();
    await ctx.reply("Yana mahsulot qo‘shasizmi?", telegraf_1.Markup.inlineKeyboard([
        [telegraf_1.Markup.button.callback("➕ Ha", "item:addmore")],
        [telegraf_1.Markup.button.callback("➡️ Davom etish", "item:finish")],
    ]));
});
bot.action("item:addmore", async (ctx) => {
    const userId = ctx.from.id;
    const draft = drafts.get(userId);
    if (!draft)
        return;
    draft.step = "itemName";
    drafts.set(userId, draft);
    await ctx.answerCbQuery();
    await ctx.reply("🛒 Mahsulot nomini yozing:");
});
bot.action("item:finish", async (ctx) => {
    const userId = ctx.from.id;
    const draft = drafts.get(userId);
    if (!draft)
        return;
    draft.step = "deliveryTime";
    drafts.set(userId, draft);
    await ctx.answerCbQuery();
    await ctx.reply("🕒 Yetkazish vaqtini yozing. Masalan: 18:00");
});
bot.action(/^currency:(USD|UZS)$/, async (ctx) => {
    const userId = ctx.from.id;
    const draft = drafts.get(userId);
    if (!draft)
        return;
    draft.currency = ctx.match[1];
    draft.step = "payment";
    drafts.set(userId, draft);
    await ctx.answerCbQuery();
    await ctx.reply("To‘lov statusini tanlang:", telegraf_1.Markup.inlineKeyboard([
        [telegraf_1.Markup.button.callback("✅ To‘langan", "payment:paid")],
        [telegraf_1.Markup.button.callback("💰 To‘lanmagan", "payment:unpaid")],
        [telegraf_1.Markup.button.callback("🚫 Pul olinmaydi", "payment:no_payment_required")],
    ]));
});
bot.action(/^payment:(paid|unpaid|no_payment_required)$/, async (ctx) => {
    const userId = ctx.from.id;
    const draft = drafts.get(userId);
    if (!draft)
        return;
    draft.paymentStatus = ctx.match[1];
    draft.step = "courier";
    drafts.set(userId, draft);
    await ctx.answerCbQuery();
    await ctx.reply("🚚 Dostavshik tanlang:", telegraf_1.Markup.inlineKeyboard(COURIERS.map((courier) => [
        telegraf_1.Markup.button.callback(courier.name, `courier:${courier.id}`),
    ])));
});
bot.action(/^courier:(\d+)$/, async (ctx) => {
    const userId = ctx.from.id;
    const draft = drafts.get(userId);
    if (!draft)
        return;
    const courierId = Number(ctx.match[1]);
    const selectedCourier = COURIERS.find((c) => c.id === courierId);
    draft.courierId = courierId;
    draft.courierName = selectedCourier?.name || `Courier ${courierId}`;
    draft.step = "confirm";
    drafts.set(userId, draft);
    const previewOrder = {
        id: "YANGI",
        clientName: draft.clientName || "",
        clientPhone: draft.clientPhone || "",
        address: draft.address || "",
        items: draft.items || [],
        deliveryTime: draft.deliveryTime || "",
        amount: draft.amount || 0,
        currency: draft.currency || "UZS",
        paymentStatus: draft.paymentStatus || "unpaid",
        courierId: draft.courierId || 0,
        courierName: draft.courierName || "",
        status: "created",
        createdBy: userId,
        createdAt: new Date().toISOString(),
    };
    await ctx.answerCbQuery();
    await ctx.reply(`Tekshiring:\n\n${formatOrder(previewOrder)}`, telegraf_1.Markup.inlineKeyboard([
        [telegraf_1.Markup.button.callback("✅ Tasdiqlash", "order:confirm")],
        [telegraf_1.Markup.button.callback("❌ Bekor qilish", "order:draftcancel")],
    ]));
});
bot.action("order:draftcancel", async (ctx) => {
    drafts.delete(ctx.from.id);
    await ctx.answerCbQuery();
    await ctx.reply("Zayavka yaratish bekor qilindi.", adminMenu());
});
bot.action("order:confirm", async (ctx) => {
    const userId = ctx.from?.id;
    if (!isAdmin(userId))
        return;
    const draft = drafts.get(userId);
    if (!draft) {
        await ctx.answerCbQuery("Draft topilmadi");
        return;
    }
    const order = {
        id: "ORD-" + Date.now(),
        clientName: draft.clientName || "",
        clientPhone: draft.clientPhone || "",
        address: draft.address || "",
        items: draft.items || [],
        deliveryTime: draft.deliveryTime || "",
        amount: draft.amount || 0,
        currency: draft.currency || "UZS",
        paymentStatus: draft.paymentStatus || "unpaid",
        courierId: draft.courierId || 0,
        courierName: draft.courierName || "",
        status: "created",
        createdBy: userId,
        createdAt: new Date().toISOString(),
    };
    const msg = await ctx.telegram.sendMessage(DELIVERY_GROUP_ID, formatOrder(order), deliveryButtons(order));
    order.deliveryGroupMessageId = msg.message_id;
    const orders = await getOrders();
    orders.push(order);
    await saveOrders(orders);
    drafts.delete(userId);
    await ctx.answerCbQuery();
    await ctx.reply("✅ Zayavka yaratildi va guruhga yuborildi.", adminMenu());
});
bot.action(/^assemble:(.+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    await withLock(orderId, async () => {
        const orders = await getOrders();
        const order = orders.find((o) => o.id === orderId);
        if (!order) {
            await ctx.answerCbQuery("Zayavka topilmadi");
            return;
        }
        if (!isCourier(ctx.from?.id) && !isAdmin(ctx.from?.id)) {
            await ctx.answerCbQuery("Ruxsat yo‘q");
            return;
        }
        if (order.status !== "created") {
            await ctx.answerCbQuery("Bu statusni o‘zgartirib bo‘lmaydi");
            return;
        }
        order.status = "assembled";
        order.assembledAt = new Date().toISOString();
        await saveOrders(orders);
        await updateDeliveryMessage(ctx, order);
        await ctx.answerCbQuery("Собрано ✅");
    });
});
bot.action(/^deliver:(.+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    const orders = await getOrders();
    const order = orders.find((o) => o.id === orderId);
    if (!order) {
        await ctx.answerCbQuery("Zayavka topilmadi");
        return;
    }
    if (!isCourier(ctx.from?.id) && !isAdmin(ctx.from?.id)) {
        await ctx.answerCbQuery("Ruxsat yo‘q");
        return;
    }
    if (order.status !== "assembled") {
        await ctx.answerCbQuery("Avval Собрано bo‘lishi kerak");
        return;
    }
    waitingPhoto.set(ctx.from.id, orderId);
    await ctx.answerCbQuery();
    await ctx.reply("📸 Yetkazib berilganini tasdiqlovchi rasm yuboring.");
});
bot.action(/^cancel:(.+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    if (!isAdmin(ctx.from?.id)) {
        await ctx.answerCbQuery("Faqat admin bekor qila oladi");
        return;
    }
    await withLock(orderId, async () => {
        const orders = await getOrders();
        const order = orders.find((o) => o.id === orderId);
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
        await updateDeliveryMessage(ctx, order);
        await ctx.answerCbQuery("Bekor qilindi");
        await ctx.reply("❌ Zayavka bekor qilindi.");
    });
});
bot.catch((err) => {
    console.error("BOT ERROR:", err);
});
bot.launch();
console.log("Digi Dostavka bot running ✅");
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
