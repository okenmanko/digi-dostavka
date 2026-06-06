"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.COURIERS = exports.REPORT_GROUP_ID = exports.DELIVERY_GROUP_ID = exports.ADMIN_IDS = exports.BOT_TOKEN = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.BOT_TOKEN = process.env.BOT_TOKEN || "";
exports.ADMIN_IDS = (process.env.ADMIN_IDS || "")
    .split(",")
    .map((x) => Number(x.trim()))
    .filter(Boolean);
exports.DELIVERY_GROUP_ID = Number(process.env.DELIVERY_GROUP_ID);
exports.REPORT_GROUP_ID = Number(process.env.REPORT_GROUP_ID);
exports.COURIERS = (process.env.COURIERS || "")
    .split(",")
    .map((part) => {
    const [id, name] = part.split(":");
    return {
        id: Number(id.trim()),
        name: name?.trim() || "Courier",
    };
})
    .filter((x) => x.id);
