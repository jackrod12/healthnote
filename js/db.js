import { openDB } from "https://cdn.jsdelivr.net/npm/idb@8/+esm";

const DB_NAME = "healthnote-db";
const DB_VERSION = 4;

export const STORE_NAMES = ["settings", "equipment", "workoutLogs", "inbodyRecords", "drinkLog2"];

let dbPromise = null;

/*
 * Migration policy: onupgradeneeded must never delete or clear an existing
 * object store — only ever create new ones (each guarded by a
 * contains() check so re-running an upgrade is a no-op). If a store's shape
 * needs to change, create a new store under a new name and copy the old
 * data into it; leave the old store in place untouched.
 */
function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      async upgrade(db, _oldVersion, _newVersion, transaction) {
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains("equipment")) {
          const store = db.createObjectStore("equipment", { keyPath: "id", autoIncrement: true });
          store.createIndex("category", "category");
        }
        if (!db.objectStoreNames.contains("workoutLogs")) {
          const store = db.createObjectStore("workoutLogs", { keyPath: "id", autoIncrement: true });
          store.createIndex("date", "date");
        }
        if (!db.objectStoreNames.contains("inbodyRecords")) {
          const store = db.createObjectStore("inbodyRecords", { keyPath: "id", autoIncrement: true });
          store.createIndex("date", "date");
        }

        if (!db.objectStoreNames.contains("drinkLog2")) {
          const store = db.createObjectStore("drinkLog2", { keyPath: "id", autoIncrement: true });
          store.createIndex("date", "date");

          // Earlier app versions used a store named "drinkLog" (either
          // keyPath: "date", or later keyPath: "id"). Copy any existing
          // entries into the new store without touching the old one.
          if (db.objectStoreNames.contains("drinkLog")) {
            const oldStore = transaction.objectStore("drinkLog");
            const oldRecords = await oldStore.getAll();
            for (const rec of oldRecords) {
              store.add({ date: rec.date, type: rec.type });
            }
          }
        }
      },
    });
  }
  return dbPromise;
}

/* ---------- settings ---------- */
export async function getSetting(key, fallback = null) {
  const db = await getDB();
  const row = await db.get("settings", key);
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  const db = await getDB();
  await db.put("settings", { key, value });
}

export async function deleteSetting(key) {
  const db = await getDB();
  await db.delete("settings", key);
}

/* ---------- equipment ---------- */
export async function getEquipmentList() {
  const db = await getDB();
  return db.getAll("equipment");
}

export async function addEquipment(data) {
  const db = await getDB();
  return db.add("equipment", data);
}

export async function updateEquipment(id, data) {
  const db = await getDB();
  await db.put("equipment", { ...data, id });
}

export async function deleteEquipment(id) {
  const db = await getDB();
  await db.delete("equipment", id);
}

export async function seedDefaultEquipmentIfEmpty(defaultList) {
  const db = await getDB();
  const existing = await db.getAll("equipment");
  if (existing.length > 0) return;
  const tx = db.transaction("equipment", "readwrite");
  await Promise.all([
    ...defaultList.map((item) =>
      tx.store.add({ name: item.name, category: item.category, photo: null, memo: "" })
    ),
    tx.done,
  ]);
}

/* ---------- workout logs ---------- */
export async function addWorkoutLog(log) {
  const db = await getDB();
  return db.add("workoutLogs", log);
}

export async function deleteWorkoutLog(id) {
  const db = await getDB();
  await db.delete("workoutLogs", id);
}

export async function getWorkoutLogsByDate(date) {
  const db = await getDB();
  return db.getAllFromIndex("workoutLogs", "date", date);
}

export async function getWorkoutLogsBetween(startDateInclusive, endDateExclusive) {
  const db = await getDB();
  const range = IDBKeyRange.bound(startDateInclusive, endDateExclusive, false, true);
  return db.getAllFromIndex("workoutLogs", "date", range);
}

export async function getAllWorkoutLogs() {
  const db = await getDB();
  return db.getAll("workoutLogs");
}

/**
 * Keeps workoutLogs in sync with an equipment rename: any weight log already
 * linked by equipmentId gets its equipmentName updated, and any legacy log
 * that predates equipmentId (matched by its old equipmentName instead) gets
 * both equipmentId backfilled and equipmentName updated.
 */
export async function renameEquipmentInWorkoutLogs(equipmentId, oldName, newName) {
  const db = await getDB();
  const all = await db.getAll("workoutLogs");
  const toUpdate = all.filter(
    (log) =>
      log.type === "weight" &&
      (log.equipmentId === equipmentId || (log.equipmentId == null && log.equipmentName === oldName))
  );
  if (!toUpdate.length) return;
  const tx = db.transaction("workoutLogs", "readwrite");
  await Promise.all([
    ...toUpdate.map((log) => tx.store.put({ ...log, equipmentId, equipmentName: newName })),
    tx.done,
  ]);
}

export async function getRecentWorkoutLogs(days = 7) {
  const db = await getDB();
  const all = await db.getAll("workoutLogs");
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().slice(0, 10);
  return all
    .filter((log) => log.date >= sinceStr)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

/* ---------- inbody records ---------- */
export async function addInbodyRecord(record) {
  const db = await getDB();
  return db.add("inbodyRecords", record);
}

export async function deleteInbodyRecord(id) {
  const db = await getDB();
  await db.delete("inbodyRecords", id);
}

export async function getAllInbodyRecords() {
  const db = await getDB();
  const all = await db.getAll("inbodyRecords");
  return all.sort((a, b) => (a.date > b.date ? 1 : -1));
}

/* ---------- drink log (alcohol + protein tracking; multiple entries per date) ---------- */
export async function getDrinkLogsByDate(date) {
  const db = await getDB();
  return db.getAllFromIndex("drinkLog2", "date", date);
}

export async function addDrinkLog(date, type) {
  const db = await getDB();
  return db.add("drinkLog2", { date, type });
}

export async function deleteDrinkLogById(id) {
  const db = await getDB();
  await db.delete("drinkLog2", id);
}

export async function getDrinkLogsBetween(startDateInclusive, endDateExclusive) {
  const db = await getDB();
  const range = IDBKeyRange.bound(startDateInclusive, endDateExclusive, false, true);
  return db.getAllFromIndex("drinkLog2", "date", range);
}

/* ---------- backup / restore ---------- */
export async function exportAllData() {
  const db = await getDB();
  const data = {};
  for (const storeName of STORE_NAMES) {
    data[storeName] = await db.getAll(storeName);
  }
  return data;
}

export async function importAllData(data) {
  const db = await getDB();
  const tx = db.transaction(STORE_NAMES, "readwrite");
  await Promise.all([
    ...STORE_NAMES.flatMap((storeName) => {
      const store = tx.objectStore(storeName);
      const rows = data[storeName] || [];
      return [store.clear(), ...rows.map((row) => store.put(row))];
    }),
    tx.done,
  ]);
}
