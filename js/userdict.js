/* ユーザー辞書の枠（Ver.1では中身は空。Ver.2で登録機能を追加する）
 * - 保存先はブラウザのIndexedDBのみ（Ver.1ではこれ以上の保持はしない）
 * - 起動時に全件をメモリ(Map)へ読み込み、get() は同期で即答する（タップ応答を落とさないため）
 */
const UserDict = (() => {
  const DB_NAME = 'furigana-userdict';
  const STORE = 'entries'; // { surface: 表記, reading: 読み（ひらがな） }
  const cache = new Map();

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE, { keyPath: 'surface' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function init() {
    try {
      const db = await open();
      await new Promise((resolve, reject) => {
        const q = db.transaction(STORE).objectStore(STORE).getAll();
        q.onsuccess = () => {
          for (const e of q.result) cache.set(e.surface, e.reading);
          resolve();
        };
        q.onerror = () => reject(q.error);
      });
      db.close();
    } catch (e) {
      // IndexedDBが使えない環境でもアプリ本体は動かす
      console.warn('ユーザー辞書を初期化できませんでした', e);
    }
  }

  // 登録済みの読みを返す。なければ null
  function get(surface) {
    return cache.get(surface) || null;
  }

  // Ver.2: put(surface, reading) / remove(surface) をここに追加する

  return { init, get };
})();
