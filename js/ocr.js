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

  let worker = null;
  let logCb = null;

  async function init(onLog) {
    if (worker) return;
    logCb = onLog || null;
    worker = await Tesseract.createWorker('jpn', 1, {
      workerPath: BASE + '/worker.min.js',
      corePath: BASE,
      langPath: BASE + '/lang',
      logger: (m) => { if (logCb) logCb(m); },
    });
  }

  async function recognize(image, opts, onLog) {
    if (!worker) throw new Error('OCRが準備されていません');
    logCb = onLog || null;
    await worker.setParameters({
      tessedit_pageseg_mode: String((opts && opts.psm) || 6),
      preserve_interword_spaces: '0',
    });
    const { data } = await worker.recognize(image);
    logCb = null;
    return toLines(data);
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
          });
          text += t;
        }
      }
      if (chars.length) lines.push({ text, bbox: ln.bbox, chars });
    }
    return lines;
  }

  return { init, recognize };
})();
