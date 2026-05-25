import { SKUPerformance, Store } from "../types";

const LOCAL_STORAGE_KEY = 'seller_pulse_skus';
const STORES_KEY = 'seller_pulse_stores';

export const skuService = {
  async getStores(): Promise<Store[]> {
    try {
      const data = localStorage.getItem(STORES_KEY);
      if (!data) return [];
      return JSON.parse(data);
    } catch (error) {
      console.error('Local Storage Error (Read Stores):', error);
      return [];
    }
  },

  async saveStore(store: Store): Promise<void> {
    try {
      const stores = await this.getStores();
      const index = stores.findIndex(s => s.id === store.id);
      const nextStores = [...stores];
      if (index >= 0) {
        nextStores[index] = store;
      } else {
        nextStores.push(store);
      }
      localStorage.setItem(STORES_KEY, JSON.stringify(nextStores));
    } catch (error) {
      console.error('Local Storage Error (Save Store):', error);
    }
  },

  async deleteStore(storeId: string): Promise<void> {
    try {
      const stores = await this.getStores();
      const nextStores = stores.filter(s => s.id !== storeId);
      localStorage.setItem(STORES_KEY, JSON.stringify(nextStores));
      
      // Also delete all SKUs associated with this store
      const skus = await this.getAllSkus();
      const nextSkus = skus.filter(s => s.storeId !== storeId);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(nextSkus));
    } catch (error) {
      console.error('Local Storage Error (Delete Store):', error);
    }
  },

  async getAllSkus(): Promise<SKUPerformance[]> {
    try {
      const data = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!data) return [];
      return JSON.parse(data);
    } catch (error) {
      console.error('Local Storage Error (Read):', error);
      return [];
    }
  },

  async getSkusByStore(storeId: string): Promise<SKUPerformance[]> {
    const all = await this.getAllSkus();
    return all.filter(s => s.storeId === storeId);
  },

  async saveSku(skuData: SKUPerformance): Promise<void> {
    try {
      const allSkus = await this.getAllSkus();
      const nextSkus = [...allSkus];
      // Use combined key of storeId and sku
      const index = nextSkus.findIndex(s => s.sku === skuData.sku && s.storeId === skuData.storeId);
      
      const dataToSave = {
        ...skuData,
        lastUpdated: new Date().toISOString()
      };
      delete (dataToSave as any).analysisLoading;

      if (index >= 0) {
        nextSkus[index] = dataToSave;
      } else {
        nextSkus.push(dataToSave);
      }

      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(nextSkus));
    } catch (error) {
      console.error('Local Storage Error (Save):', error);
    }
  },

  async bulkSaveSkus(skus: SKUPerformance[]): Promise<void> {
    try {
      const existing = await this.getAllSkus();
      // Store based mapping
      const skuMap = new Map(existing.map(s => [`${s.storeId}_${s.sku}`, s]));
      
      skus.forEach(s => {
        const dataToSave = { ...s, lastUpdated: new Date().toISOString() };
        delete (dataToSave as any).analysisLoading;
        skuMap.set(`${s.storeId}_${s.sku}`, dataToSave);
      });

      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(Array.from(skuMap.values())));
    } catch (error) {
      console.error('Local Storage Error (Bulk Save):', error);
    }
  },

  async clearAllData(): Promise<void> {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    localStorage.removeItem(STORES_KEY);
  }
};
