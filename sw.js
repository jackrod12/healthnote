const CACHE_NAME = "healthnote-cache-v4";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/app.js",
  "./js/db.js",
  "./js/chart.js",
  "./js/badges.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never intercept cross-origin calls (idb CDN module, etc.)
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});

/* ---------------- 운동 알림 (workout reminder) ----------------
 * Raw IndexedDB access only (no idb/db.js import) so this stays a classic
 * script and never risks colliding with the app's own DB version upgrades —
 * opening without a version number always attaches at whatever version
 * already exists (or creates an empty v1 shell if the DB doesn't exist yet,
 * which the app then upgrades normally on its next open()).
 */
const NOTIFY_DB_NAME = "healthnote-db";
const NOTIFY_SETTINGS_KEY = "workoutNotify";
const NOTIFY_LAST_FIRED_KEY = "workoutNotifyLastFired";

function openHealthDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(NOTIFY_DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGetSetting(db, key) {
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains("settings")) return resolve(null);
    const tx = db.transaction("settings", "readonly");
    const req = tx.objectStore("settings").get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : null);
    req.onerror = () => resolve(null);
  });
}

function idbSetSetting(db, key, value) {
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains("settings")) return resolve();
    const tx = db.transaction("settings", "readwrite");
    tx.objectStore("settings").put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

function idbGetWorkoutLogsByDate(db, date) {
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains("workoutLogs")) return resolve([]);
    const tx = db.transaction("workoutLogs", "readonly");
    const store = tx.objectStore("workoutLogs");
    const req = store.indexNames.contains("date") ? store.index("date").getAll(date) : store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

function localDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function checkAndNotifyWorkoutReminder() {
  let db;
  try {
    db = await openHealthDB();
  } catch {
    return;
  }

  const settings = await idbGetSetting(db, NOTIFY_SETTINGS_KEY);
  if (!settings || !Array.isArray(settings.notifyDays) || !settings.notifyDays.length || !settings.notifyTime) {
    db.close();
    return;
  }

  const now = new Date();
  if (!settings.notifyDays.includes(now.getDay())) {
    db.close();
    return;
  }

  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  if (`${hh}:${mm}` !== settings.notifyTime) {
    db.close();
    return;
  }

  const todayStr = localDateStr(now);
  const lastFired = await idbGetSetting(db, NOTIFY_LAST_FIRED_KEY);
  if (lastFired === todayStr) {
    db.close();
    return;
  }

  const todayLogs = await idbGetWorkoutLogsByDate(db, todayStr);
  if (todayLogs.length) {
    db.close();
    return;
  }

  await idbSetSetting(db, NOTIFY_LAST_FIRED_KEY, todayStr);
  db.close();

  await self.registration.showNotification("헬스노트", {
    body: "💪 오늘 운동할 시간이에요! 헬스노트를 열어보세요",
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    tag: "workout-reminder",
  });
}

// Best-effort periodic wake-up via the Periodic Background Sync API, where supported.
self.addEventListener("periodicsync", (event) => {
  if (event.tag === "workout-reminder-check") {
    event.waitUntil(checkAndNotifyWorkoutReminder());
  }
});

// Fallback for browsers without periodicsync: a self-rescheduling setTimeout
// chain that checks every minute while this SW instance stays alive.
function scheduleWorkoutReminderCheck() {
  checkAndNotifyWorkoutReminder()
    .catch(() => {})
    .finally(() => {
      setTimeout(scheduleWorkoutReminderCheck, 60 * 1000);
    });
}
scheduleWorkoutReminderCheck();

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "workout-notify-settings-updated") {
    checkAndNotifyWorkoutReminder().catch(() => {});
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("./index.html");
    })
  );
});
