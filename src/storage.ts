import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.join(
  process.cwd(),
  "data"
);

export const ORDERS_FILE = path.join(
  DATA_DIR,
  "orders.json"
);

export const WAREHOUSES_FILE = path.join(
  DATA_DIR,
  "warehouses.json"
);

export async function readJson<T>(
  file: string,
  fallback: T
): Promise<T> {
  try {
    const data = await fs.readFile(
      file,
      "utf-8"
    );

    return JSON.parse(data);
  } catch {
    await fs.mkdir(DATA_DIR, {
      recursive: true,
    });

    await fs.writeFile(
      file,
      JSON.stringify(fallback, null, 2)
    );

    return fallback;
  }
}

export async function writeJson<T>(
  file: string,
  data: T
) {
  await fs.writeFile(
    file,
    JSON.stringify(data, null, 2)
  );
}