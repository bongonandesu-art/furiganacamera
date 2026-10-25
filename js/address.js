/* 住所データの読み込みと、OCR結果に近い候補の並べ替え
 *
 *   await Address.loadIndex()          … 都道府県の一覧 [[code, 名前, 読み], ...]
 *   await Address.loadPref(code)       … その県のデータ { c: [[市区町村, 読み, [[町域, 読み], ...]], ...] }
 *   Address.rank(items, text)          … items を、text（OCRの文字列）に近い順に並べる
 *   Address.normalizeText(s)           … OCR結果の整形
 *   Address.detectPref(index, text)    … OCR結果に含まれる都道府県名を探す
 *
 * 読みはOCRの文字ではなく、住所データ側の読みを使う。
 * OCRが似た文字を取り違えても（干/千 など）、データ上の候補から正しい地名を選べる。
 * メモリ節約のため、読み込むのは選ばれた1県分だけ（切り替えると前の県は破棄される）。
 */
const Address = (() => {
  const DIR = 'data/address/';
  let index = null;
  let current = null; // { code, data }

  async function getJson(name) {
    const res = await fetch(DIR + name);
    if (!res.ok) {
      throw new Error('住所データ ' + name + ' を取得できません。README の手順で build-address-data.js を実行し、data/ をアップロードしてください');
    }
    return res.json();
  }

  async function loadIndex() {
    if (!index) index = await getJson('index.json');
    return index;
  }

  async function loadPref(code) {
    if (current && current.code === code) return current.data;
    current = null; // 前の県のデータを先に手放す
    const data = await getJson(code + '.json');
    current = { code, data };
    return data;
  }

  const normalizeText = (s) => s.normalize('NFKC').replace(/\s+/g, '').replace(/大字/g, '');

  function detectPref(idx, text) {
    let best = null;
    for (const p of idx) {
      if (text.includes(p[1]) && (!best || p[1].length > best[1].length)) best = p;
    }
    return best ? best[0] : null;
  }

  // 候補の表記を text に当てはめ、同じ位置で一致した文字数が最も多い箇所を探す（1〜2文字の誤認識に強い）
  // 戻り値: [{ item, matched, ratio, end }]  ratio=一致した割合 / end=text内で候補が終わる位置
  function rank(items, text) {
    const out = [];
    for (const item of items) {
      const s = item[0];
      const m = s.length;
      if (!m) continue;
      let best = 0;
      let bestPos = 0;
      for (let i = 0; i + m <= text.length; i++) {
        let c = 0;
        for (let j = 0; j < m; j++) if (text[i + j] === s[j]) c++;
        if (c > best) { best = c; bestPos = i; }
      }
      if (m > text.length) { // 候補のほうが長いときは、先頭から比べる
        for (let j = 0; j < text.length; j++) if (text[j] === s[j]) best++;
      }
      out.push({ item, matched: best, ratio: best / m, end: Math.min(text.length, bestPos + m) });
    }
    out.sort((a, b) => b.ratio - a.ratio || b.matched - a.matched || a.item[0].length - b.item[0].length);
    return out;
  }

  return { loadIndex, loadPref, rank, normalizeText, detectPref };
})();
