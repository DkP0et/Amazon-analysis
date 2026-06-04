import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";
import { ProxyAgent, setGlobalDispatcher } from "undici";
import dotenv from "dotenv";

dotenv.config();

// ── 代理设置（复用 server.ts 里的 PROXY_URL 配置）────────────────────────
// firebase-admin 底层走 Node.js 原生网络，需要设置全局代理才能走 v2rayN/Clash
if (process.env.PROXY_URL) {
  try {
    const proxyUrl = process.env.PROXY_URL.trim();
    if (proxyUrl) {
      const proxyAgent = new ProxyAgent(proxyUrl);
      setGlobalDispatcher(proxyAgent);
      console.log(`[Firebase] 代理已设置：${proxyUrl}`);
    }
  } catch (e) {
    console.error("[Firebase] 代理设置失败：", e);
  }
}

// ── Firebase Admin 初始化 ─────────────────────────────────────────────────

let db: Firestore;

function getDb(): Firestore {
  if (db) return db;

  if (!getApps().length) {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;

    if (serviceAccountJson) {
      try {
        const serviceAccount = JSON.parse(serviceAccountJson);
        initializeApp({
          credential: cert(serviceAccount),
          projectId: process.env.FIREBASE_PROJECT_ID,
        });
        console.log("[Firebase] 初始化成功（Service Account 模式）");
      } catch (e) {
        console.error("[Firebase] Service Account 解析失败，回退到 projectId 模式", e);
        initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID });
      }
    } else {
      initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID });
      console.log("[Firebase] 初始化成功（projectId 模式）");
    }
  }

  db = getFirestore();
  return db;
}

// ── 数据结构类型 ───────────────────────────────────────────────────────────

export interface Store {
  id: string;
  [key: string]: any;
}

export interface SKU {
  sku: string;
  storeId: string;
  lastUpdated?: string;
  [key: string]: any;
}

export interface DbData {
  stores: Store[];
  skus: SKU[];
}

// ── 兼容旧接口：readDb / writeDb ──────────────────────────────────────────

export async function readDb(): Promise<DbData> {
  const firestore = getDb();

  const [storesSnapshot, skusSnapshot] = await Promise.all([
    firestore.collection("stores").get(),
    firestore.collection("skus").get(),
  ]);

  const stores: Store[] = storesSnapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));

  const skus: SKU[] = skusSnapshot.docs.map((doc) => doc.data() as SKU);

  return { stores, skus };
}

export async function writeDb(data: DbData): Promise<void> {
  const firestore = getDb();
  const batch = firestore.batch();

  for (const store of data.stores) {
    const ref = firestore.collection("stores").doc(store.id);
    batch.set(ref, store, { merge: true });
  }

  for (const sku of data.skus) {
    const docId = `${sku.storeId}_${sku.sku}`;
    const ref = firestore.collection("skus").doc(docId);
    batch.set(ref, sku, { merge: true });
  }

  await batch.commit();
}

// ── 细粒度操作函数 ────────────────────────────────────────────────────────

export async function getStores(): Promise<Store[]> {
  const firestore = getDb();
  const snapshot = await firestore.collection("stores").get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

export async function saveStore(store: Store): Promise<void> {
  const firestore = getDb();
  await firestore.collection("stores").doc(store.id).set(store, { merge: true });
}

export async function deleteStore(storeId: string): Promise<void> {
  const firestore = getDb();
  const batch = firestore.batch();

  batch.delete(firestore.collection("stores").doc(storeId));

  const skusSnapshot = await firestore
    .collection("skus")
    .where("storeId", "==", storeId)
    .get();

  skusSnapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });

  await batch.commit();
}

export async function getSkus(storeId?: string): Promise<SKU[]> {
  const firestore = getDb();
  let query = firestore.collection("skus") as FirebaseFirestore.Query;

  if (storeId) {
    query = query.where("storeId", "==", storeId);
  }

  const snapshot = await query.get();
  return snapshot.docs.map((doc) => doc.data() as SKU);
}

export async function saveSku(skuData: SKU): Promise<SKU> {
  const firestore = getDb();
  const docId = `${skuData.storeId}_${skuData.sku}`;
  const dataToSave = { ...skuData, lastUpdated: new Date().toISOString() };
  delete dataToSave.analysisLoading;

  await firestore.collection("skus").doc(docId).set(dataToSave, { merge: true });
  return dataToSave;
}

export async function bulkSaveSkus(skus: SKU[]): Promise<number> {
  const firestore = getDb();
  const chunkSize = 400;
  let savedCount = 0;

  for (let i = 0; i < skus.length; i += chunkSize) {
    const chunk = skus.slice(i, i + chunkSize);
    const batch = firestore.batch();

    chunk.forEach((sku) => {
      if (!sku.sku || !sku.storeId) return;
      const docId = `${sku.storeId}_${sku.sku}`;
      const dataToSave = { ...sku, lastUpdated: new Date().toISOString() };
      delete dataToSave.analysisLoading;
      batch.set(firestore.collection("skus").doc(docId), dataToSave, { merge: true });
      savedCount++;
    });

    await batch.commit();
  }

  return savedCount;
}
