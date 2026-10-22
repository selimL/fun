// Settings in localStorage, chat history in IndexedDB (room for images).
window.SC = window.SC || {};

SC.DEFAULT_SETTINGS = {
  host: 'http://localhost:11434',
  defaultModel: '', mathModel: '', codeModel: '', visionModel: '',
  subjectModels: {},
  useTools: true, useThink: true, verify: true,
  rounds: 1, numCtx: 16384, keepAlive: '30m',
};

SC.loadSettings = () => {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('sc-settings') || '{}'); } catch { /* ignore */ }
  SC.settings = { ...SC.DEFAULT_SETTINGS, ...saved };
};
SC.saveSettings = () => {
  try { localStorage.setItem('sc-settings', JSON.stringify(SC.settings)); } catch { /* ignore */ }
};

SC.DB = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('study-council', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('chats', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('chats', mode);
      const req = fn(t.objectStore('chats'));
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    all: async () => {
      try { return ((await tx('readonly', s => s.getAll())) || []).sort((a, b) => b.updatedAt - a.updatedAt); }
      catch { return []; }
    },
    get: id => tx('readonly', s => s.get(id)),
    put: chat => tx('readwrite', s => s.put(chat)).catch(() => {}),
    del: id => tx('readwrite', s => s.delete(id)).catch(() => {}),
  };
})();
