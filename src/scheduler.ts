import { Telegraf } from "telegraf";

import {
  DELIVERY_GROUP_ID,
} from "./config";

import {
  getOrders,
  saveOrders,
} from "./order.service";

import { Order } from "./types";

export function startScheduler(
  bot: Telegraf
) {
  setInterval(async () => {
    const orders =
      await getOrders();

    const now = Date.now();

    for (const order of orders) {
      if (
        order.type !== "storage"
      )
        continue;

      if (
        order.status !==
        "scheduled"
      )
        continue;

      if (
        !order.scheduledAt
      )
        continue;

      const scheduled =
        new Date(
          order.scheduledAt
        ).getTime();

      if (scheduled > now)
        continue;

      order.status =
        "created";

      const msg =
        await bot.telegram.sendMessage(
          DELIVERY_GROUP_ID,
          `
📦 XRANENIYADAN CHIQDI

👤 ${order.clientName}

📍 ${order.address}

🚚 ${order.courierName}
`.trim()
        );

      order.deliveryGroupMessageId =
        msg.message_id;
    }

    await saveOrders(
      orders
    );
  }, 60000);
}