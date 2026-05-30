import { Markup } from "telegraf";

export function adminMenu() {
  return Markup.keyboard([
    ["➕ Zayavka yaratish"],
    ["📦 Xraneniya"],

    ["📦 Aktiv zayavkalar"],

    ["🏬 Skladlar"],
    ["📊 Otchetlar"],

    ["❌ Bekor qilinganlar"],
  ]).resize();
}