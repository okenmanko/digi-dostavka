import dotenv from "dotenv";

dotenv.config();

export const BOT_TOKEN = process.env.BOT_TOKEN || "";

export const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((x) => Number(x.trim()))
  .filter(Boolean);

export const DELIVERY_GROUP_ID = Number(
  process.env.DELIVERY_GROUP_ID
);

export const REPORT_GROUP_ID = Number(
  process.env.REPORT_GROUP_ID
);

export type Courier = {
  id: number;
  name: string;
};

export const COURIERS: Courier[] = (
  process.env.COURIERS || ""
)
  .split(",")
  .map((part) => {
    const [id, name] = part.split(":");

    return {
      id: Number(id.trim()),
      name: name?.trim() || "Courier",
    };
  })
  .filter((x) => x.id);