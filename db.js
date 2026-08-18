(function () {
  const DB_NAME_BASE = "boss_exchange_collector";
  const DB_VERSION = 1;

  function normalizeNamespace(v) {
    const t = String(v || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_-]/g, "");
    return t || "default";
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("transaction aborted"));
    });
  }

  class CollectorDB {
    constructor(namespace = "default") {
      this._db = null;
      this.namespace = normalizeNamespace(namespace);
      this.dbName = this.namespace === "default" ? DB_NAME_BASE : `${DB_NAME_BASE}__${this.namespace}`;
    }

    async open() {
      if (this._db) return this._db;
      this._db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(this.dbName, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("contacts")) {
            const s = db.createObjectStore("contacts", { keyPath: "dedupe_key" });
            s.createIndex("collected_at", "collected_at", { unique: false });
          }
          if (!db.objectStoreNames.contains("session_signatures")) {
            db.createObjectStore("session_signatures", { keyPath: "key" });
          }
          if (!db.objectStoreNames.contains("runs")) {
            db.createObjectStore("runs", { keyPath: "id", autoIncrement: true });
          }
          if (!db.objectStoreNames.contains("kv")) {
            db.createObjectStore("kv", { keyPath: "key" });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return this._db;
    }

    close() {
      if (this._db) {
        try {
          this._db.close();
        } catch (_err) {
          // ignore
        }
      }
      this._db = null;
    }

    async getSignature(key) {
      const db = await this.open();
      const tx = db.transaction("session_signatures", "readonly");
      const row = await reqToPromise(tx.objectStore("session_signatures").get(key));
      return row ? row.signature : "";
    }

    async setSignature(key, signature) {
      const db = await this.open();
      const tx = db.transaction("session_signatures", "readwrite");
      tx.objectStore("session_signatures").put({
        key,
        signature: String(signature || ""),
        updated_at: new Date().toISOString(),
      });
      await txDone(tx);
    }

    async putContact(contact) {
      const db = await this.open();
      const tx = db.transaction("contacts", "readwrite");
      const store = tx.objectStore("contacts");
      const existed = await reqToPromise(store.get(contact.dedupe_key));
      if (!existed) {
        store.put(contact);
      }
      await txDone(tx);
      return !existed;
    }

    async listContacts() {
      const db = await this.open();
      const tx = db.transaction("contacts", "readonly");
      const rows = await reqToPromise(tx.objectStore("contacts").getAll());
      rows.sort((a, b) => String(a.collected_at || "").localeCompare(String(b.collected_at || "")));
      return rows;
    }

    async addRun(payload) {
      const db = await this.open();
      const tx = db.transaction("runs", "readwrite");
      const req = tx.objectStore("runs").add(payload);
      const id = await reqToPromise(req);
      await txDone(tx);
      return id;
    }

    async updateRun(id, patch) {
      const db = await this.open();
      const tx = db.transaction("runs", "readwrite");
      const store = tx.objectStore("runs");
      const row = (await reqToPromise(store.get(id))) || { id };
      store.put({ ...row, ...patch });
      await txDone(tx);
    }

    async listRuns(limit = 15) {
      const db = await this.open();
      const tx = db.transaction("runs", "readonly");
      const rows = await reqToPromise(tx.objectStore("runs").getAll());
      rows.sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
      return rows.slice(0, limit);
    }

    async getKV(key, fallback = "") {
      const db = await this.open();
      const tx = db.transaction("kv", "readonly");
      const row = await reqToPromise(tx.objectStore("kv").get(key));
      return row ? row.value : fallback;
    }

    async setKV(key, value) {
      const db = await this.open();
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put({ key, value, updated_at: new Date().toISOString() });
      await txDone(tx);
    }

    async clearHistory() {
      const db = await this.open();
      const tx = db.transaction(["contacts", "session_signatures", "runs"], "readwrite");
      tx.objectStore("contacts").clear();
      tx.objectStore("session_signatures").clear();
      tx.objectStore("runs").clear();
      await txDone(tx);
    }
  }

  window.CollectorDB = CollectorDB;
})();
