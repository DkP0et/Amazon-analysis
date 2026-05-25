import { SKUPerformance, Store } from "../types";

export const skuService = {
  async getStores(): Promise<Store[]> {
    try {
      const resp = await fetch("/api/stores");
      if (!resp.ok) {
        throw new Error(`Failed to load stores: ${resp.statusText}`);
      }
      return await resp.json();
    } catch (error) {
      console.error('Remote Storage Error (Read Stores):', error);
      return [];
    }
  },

  async saveStore(store: Store): Promise<void> {
    try {
      const resp = await fetch("/api/stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(store)
      });
      if (!resp.ok) {
        throw new Error(`Failed to save store: ${resp.statusText}`);
      }
    } catch (error) {
      console.error('Remote Storage Error (Save Store):', error);
    }
  },

  async deleteStore(storeId: string): Promise<void> {
    try {
      const resp = await fetch(`/api/stores/${storeId}`, {
        method: "DELETE"
      });
      if (!resp.ok) {
        throw new Error(`Failed to delete store: ${resp.statusText}`);
      }
    } catch (error) {
      console.error('Remote Storage Error (Delete Store):', error);
    }
  },

  async getAllSkus(): Promise<SKUPerformance[]> {
    try {
      const resp = await fetch("/api/skus");
      if (!resp.ok) {
        throw new Error(`Failed to load SKUs: ${resp.statusText}`);
      }
      return await resp.json();
    } catch (error) {
      console.error('Remote Storage Error (Read SKUs):', error);
      return [];
    }
  },

  async getSkusByStore(storeId: string): Promise<SKUPerformance[]> {
    try {
      const resp = await fetch(`/api/skus?storeId=${encodeURIComponent(storeId)}`);
      if (!resp.ok) {
        throw new Error(`Failed to load SKUs for store: ${resp.statusText}`);
      }
      return await resp.json();
    } catch (error) {
      console.error('Remote Storage Error (Read SKUs by Store):', error);
      return [];
    }
  },

  async saveSku(skuData: SKUPerformance): Promise<void> {
    try {
      const resp = await fetch("/api/skus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(skuData)
      });
      if (!resp.ok) {
        throw new Error(`Failed to save SKU: ${resp.statusText}`);
      }
    } catch (error) {
      console.error('Remote Storage Error (Save SKU):', error);
    }
  },

  async bulkSaveSkus(skus: SKUPerformance[]): Promise<void> {
    try {
      const resp = await fetch("/api/skus/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(skus)
      });
      if (!resp.ok) {
        throw new Error(`Failed to bulk save SKUs: ${resp.statusText}`);
      }
    } catch (error) {
      console.error('Remote Storage Error (Bulk Save SKUs):', error);
    }
  },

  async clearAllData(): Promise<void> {
    try {
      const resp = await fetch("/api/clear", {
        method: "POST"
      });
      if (!resp.ok) {
        throw new Error(`Failed to clear database: ${resp.statusText}`);
      }
    } catch (error) {
      console.error('Remote Storage Error (Clear Data):', error);
    }
  }
};
