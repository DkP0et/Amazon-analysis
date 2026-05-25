import fs from "fs/promises";
import path from "path";
import { existsSync } from "fs";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

interface DbSchema {
  stores: any[];
  skus: any[];
}

const defaultDb: DbSchema = {
  stores: [],
  skus: []
};

async function ensureDb(): Promise<void> {
  try {
    if (!existsSync(DATA_DIR)) {
      await fs.mkdir(DATA_DIR, { recursive: true });
    }
    if (!existsSync(DB_FILE)) {
      await fs.writeFile(DB_FILE, JSON.stringify(defaultDb, null, 2), "utf-8");
    }
  } catch (error) {
    console.error("Failed to ensure DB exists:", error);
  }
}

export async function readDb(): Promise<DbSchema> {
  await ensureDb();
  try {
    const content = await fs.readFile(DB_FILE, "utf-8");
    return JSON.parse(content) as DbSchema;
  } catch (error) {
    console.error("Failed to read DB file, returning default:", error);
    return { ...defaultDb };
  }
}

export async function writeDb(data: DbSchema): Promise<void> {
  await ensureDb();
  try {
    await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    console.error("Failed to write to DB file:", error);
    throw error;
  }
}
