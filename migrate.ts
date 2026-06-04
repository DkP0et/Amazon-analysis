/**
 * 数据迁移脚本：本地 JSON → Firebase Firestore
 *
 * 用法：
 *   1. 确保 .env 里已填好 FIREBASE_PROJECT_ID
 *   2. 把你的本地数据文件（db.json）放在项目根目录
 *   3. 运行：npx tsx migrate.ts
 */

import fs from "fs";
import path from "path";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import dotenv from "dotenv";

dotenv.config();

// ── 初始化 Firebase Admin ──────────────────────────────────────────────────
function initFirebase() {
  if (!getApps().length) {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (serviceAccountJson) {
      try {
        const serviceAccount = JSON.parse(serviceAccountJson);
        initializeApp({
          credential: cert(serviceAccount),
          projectId: process.env.FIREBASE_PROJECT_ID,
        });
        console.log("✅ Firebase 初始化成功（Service Account 模式）");
      } catch {
        initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID });
        console.log("✅ Firebase 初始化成功（projectId 模式）");
      }
    } else {
      initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID });
      console.log("✅ Firebase 初始化成功（projectId 模式）");
    }
  }
  return getFirestore();
}

// ── 查找本地数据文件 ───────────────────────────────────────────────────────
function findLocalDbFile(): string | null {
  // 常见的数据文件路径，按优先级查找
  const candidates = [
    "data/db.json",       // 你的项目实际路径（最优先）
    "data/data.json",
    "db.json",
    "data.json",
    "server/db.json",
    "server/data.json",
    "database.json",
  ];

  console.log("🔍 搜索数据文件中...");
  for (const candidate of candidates) {
    const fullPath = path.resolve(process.cwd(), candidate);
    console.log(`   检查：${fullPath}`);
    if (fs.existsSync(fullPath)) {
      // 额外验证：确保是合法 JSON 文件而不是 TypeScript 源码
      try {
        const content = fs.readFileSync(fullPath, "utf-8").trim();
        if (!content.startsWith("{") && !content.startsWith("[")) {
          console.log(`   ⚠️  跳过（不是 JSON 格式）：${candidate}`);
          continue;
        }
        return fullPath;
      } catch {
        continue;
      }
    }
  }
  return null;
}

// ── 主迁移逻辑 ─────────────────────────────────────────────────────────────
async function migrate() {
  console.log("\n🚀 开始数据迁移：本地 JSON → Firebase Firestore\n");

  // 1. 检查环境变量
  if (!process.env.FIREBASE_PROJECT_ID) {
    console.error("❌ 错误：请在 .env 文件里设置 FIREBASE_PROJECT_ID");
    console.error("   示例：FIREBASE_PROJECT_ID=analysis-75a54");
    process.exit(1);
  }

  // 2. 查找本地数据文件
  const dbFilePath = findLocalDbFile();
  if (!dbFilePath) {
    console.log("⚠️  未找到本地数据文件（db.json / data.json 等）");
    console.log("   这可能是全新安装，跳过迁移。");
    console.log("   如果你有数据文件，请把它放在项目根目录并命名为 db.json");
    process.exit(0);
  }

  console.log(`📂 找到数据文件：${dbFilePath}`);

  // 3. 读取并解析
  let rawData: any;
  try {
    const content = fs.readFileSync(dbFilePath, "utf-8");
    rawData = JSON.parse(content);
  } catch (e) {
    console.error("❌ 读取或解析数据文件失败：", e);
    process.exit(1);
  }

  const stores: any[] = rawData.stores || [];
  const skus: any[] = rawData.skus || [];

  console.log(`📊 数据统计：${stores.length} 个店铺，${skus.length} 个 SKU\n`);

  if (stores.length === 0 && skus.length === 0) {
    console.log("⚠️  数据文件为空，没有需要迁移的数据。");
    process.exit(0);
  }

  // 4. 初始化 Firebase
  const db = initFirebase();

  // 5. 迁移店铺数据
  if (stores.length > 0) {
    console.log(`⏳ 正在迁移店铺数据（${stores.length} 条）...`);
    const BATCH_SIZE = 400;
    let migratedStores = 0;

    for (let i = 0; i < stores.length; i += BATCH_SIZE) {
      const chunk = stores.slice(i, i + BATCH_SIZE);
      const batch = db.batch();

      for (const store of chunk) {
        if (!store.id) {
          console.warn(`  ⚠️  跳过没有 id 的店铺：`, store);
          continue;
        }
        const ref = db.collection("stores").doc(String(store.id));
        batch.set(ref, store, { merge: true });
        migratedStores++;
      }

      await batch.commit();
      console.log(`  ✓ 已迁移 ${migratedStores}/${stores.length} 个店铺`);
    }
    console.log(`✅ 店铺迁移完成：${migratedStores} 条\n`);
  }

  // 6. 迁移 SKU 数据
  if (skus.length > 0) {
    console.log(`⏳ 正在迁移 SKU 数据（${skus.length} 条）...`);
    const BATCH_SIZE = 400;
    let migratedSkus = 0;
    let skippedSkus = 0;

    for (let i = 0; i < skus.length; i += BATCH_SIZE) {
      const chunk = skus.slice(i, i + BATCH_SIZE);
      const batch = db.batch();

      for (const sku of chunk) {
        if (!sku.sku || !sku.storeId) {
          console.warn(`  ⚠️  跳过数据不完整的 SKU：`, sku);
          skippedSkus++;
          continue;
        }
        // 清理不需要存储的字段
        const dataToSave = { ...sku };
        delete dataToSave.analysisLoading;

        const docId = `${sku.storeId}_${sku.sku}`;
        const ref = db.collection("skus").doc(docId);
        batch.set(ref, dataToSave, { merge: true });
        migratedSkus++;
      }

      await batch.commit();
      console.log(`  ✓ 已迁移 ${migratedSkus}/${skus.length - skippedSkus} 个 SKU`);
    }

    console.log(`✅ SKU 迁移完成：${migratedSkus} 条`);
    if (skippedSkus > 0) {
      console.log(`⚠️  跳过 ${skippedSkus} 条数据不完整的 SKU`);
    }
  }

  // 7. 备份原始文件
  const backupPath = dbFilePath + ".backup_" + Date.now();
  fs.copyFileSync(dbFilePath, backupPath);
  console.log(`\n💾 原始数据已备份至：${backupPath}`);

  console.log("\n🎉 迁移完成！现在可以启动程序，数据将从 Firebase 读取。\n");
}

// 运行
migrate().catch((err) => {
  console.error("❌ 迁移过程中发生错误：", err);
  process.exit(1);
});
