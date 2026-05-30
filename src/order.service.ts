import { randomUUID } from "crypto";

import {
  readJson,
  writeJson,
  ORDERS_FILE,
  WAREHOUSES_FILE,
} from "./storage";

import {
  Order,
  Warehouse,
} from "./types";

export async function getOrders() {
  return readJson<Order[]>(
    ORDERS_FILE,
    []
  );
}

export async function saveOrders(
  orders: Order[]
) {
  return writeJson(
    ORDERS_FILE,
    orders
  );
}

export async function getWarehouses() {
  return readJson<Warehouse[]>(
    WAREHOUSES_FILE,
    []
  );
}

export async function saveWarehouses(
  warehouses: Warehouse[]
) {
  return writeJson(
    WAREHOUSES_FILE,
    warehouses
  );
}

export function createWarehouse(
  name: string
): Warehouse {
  return {
    id: randomUUID(),
    name,
  };
}