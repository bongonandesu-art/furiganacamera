/* OCRの窓口
 *   await OCR.init(onLog)                       … エンジンの準備（1回だけ）
 *   await OCR.recognize(canvas, {psm}, onLog)   … 文字と座標のリストを返す
 *
 * 返り値: [{ text, bbox:{x0,y0,x1,y1}, chars:[{ ch, start, end, bbox, isKanji }] }]
 *   - 座標は、渡した画像（canvas）のピクセル単位
 *   - text は chars の ch を連結した文字列。start/end はその中の位置
 *     （形態素解析の結果と文字位置を突き合わせるために使う）
 *
 * 後でML Kitのプラグインに差し替える場合も、この返り値の形さえ守れば他は触らずに済む。
 */
const OCR = (() => {
  // Tesseract.jsのworkerはBlob経由で読まれるため、パスは絶対URLにしておく
  const BASE = new URL('lib/tesseract', document.baseURI).href;
  const KANJI = /[\u3400-\u4DBF\u4E00-\u9FFF\u3005\u3006\u3007]/;

  const RECYCLE_EVERY = 1; // 1枚ごとにOCRエンジンを作り直し、メモリの増加を持ち越さない（候補を選んでいる間に裏で済む）

  let worker = null;
  let logCb = null;
  let runs = 0;
  let ready = Promise.resolve();

  // OCRエンジンを止めて作り直す（wasmのメモリを手放す）
  async function recycle() {
    if (worker) {
      try { await worker.terminate(); } catch (e) { /* 無視 */ }
      worker = null;
    }
    runs = 0;
    await init();
  }
  const release = async () => { await ready; await recycle(); };

  async function init(onLog) {
    if (worker) return;
    logCb = onLog || null;
    worker = await Tesseract.createWorker('jpn', 1, {
      workerPath: BASE + '/worker.min.js',
      corePath: BASE,
      langPath: BASE + '/lang',
      cacheMethod: 'none', // テスト中は、ブラウザに古いモデルが残って使われるのを防ぐ
      logger: (m) => { if (logCb) logCb(m); },
    });
  }

  async function recognize(image, opts, onLog) {
    await ready; // 作り直しの最中なら待つ
    if (!worker) throw new Error('OCRが準備されていません');
    logCb = onLog || null;
    await worker.setParameters({
      tessedit_pageseg_mode: String((opts && opts.psm) || 6),
      preserve_interword_spaces: '0',
    });
    const target = opts && opts.normalize ? normalize(image) : image;
    const { data } = await worker.recognize(target);
    logCb = null;
    if (++runs >= RECYCLE_EVERY) ready = recycle().catch((e) => console.warn('OCRの作り直しに失敗', e));
    return toLines(data);
  }

  // 影や明るさのムラを補正する：ぼかした画像を「その場所の紙の明るさ」とみなし、画素をそれで割る
  // （元の画像と同じ大きさで返すので、座標はそのまま使える）
  function normalize(src) {
    const w = src.width;
    const h = src.height;
    const sw = Math.max(8, Math.round(w / 16));
    const sh = Math.max(8, Math.round(h / 16));
    const small = document.createElement('canvas');
    small.width = sw; small.height = sh;
    const sg = small.getContext('2d');
    sg.imageSmoothingQuality = 'high';
    sg.drawImage(src, 0, 0, sw, sh);
    const bgc = document.createElement('canvas');
    bgc.width = w; bgc.height = h;
    const bg = bgc.getContext('2d');
    bg.imageSmoothingQuality = 'high';
    bg.drawImage(small, 0, 0, w, h);

    const a = src.getContext('2d').getImageData(0, 0, w, h).data;
    const b = bg.getImageData(0, 0, w, h).data;
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const og = out.getContext('2d');
    const o = og.createImageData(w, h);
    const od = o.data;
    for (let i = 0; i < a.length; i += 4) {
      const g = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
      const k = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
      let v = Math.min(255, (g * 255) / Math.max(k, 1));
      v = ((v - 70) * 255) / (225 - 70); // コントラストを少し強める
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      od[i] = od[i + 1] = od[i + 2] = v;
      od[i + 3] = 255;
    }
    og.putImageData(o, 0, 0);
    return out;
  }

  function toLines(data) {
    const lines = [];
    for (const ln of data.lines || []) {
      const chars = [];
      let text = '';
      for (const w of ln.words || []) {
        for (const s of w.symbols || []) {
          const t = (s.text || '').replace(/\s+/g, '');
          if (!t || !s.bbox) continue;
          chars.push({
            ch: t,
            start: text.length,
            end: text.length + t.length,
            bbox: s.bbox,
            isKanji: KANJI.test(t),
            conf: s.confidence, // OCR自身の確信度（0〜100）
          });
          text += t;
        }
      }
      if (chars.length) lines.push({ text, bbox: ln.bbox, chars });
    }
    return lines;
  }

  return { init, recognize, release };
})();
