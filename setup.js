#!/usr/bin/env node
/* lib/ に必要なファイル（OCRエンジンと日本語モデル）をダウンロードするスクリプト（Node.js 18以上）
 *
 *   node setup.js          … 標準の日本語モデル
 *   node setup.js fast     … 軽量モデル（速いが精度はやや下がる）
 *   node setup.js best     … 高精度モデル（ファイルが大きく遅い）
 *
 * 一度実行すれば、以後アプリは外部通信なしで動く。
 */
const fs = require('fs');
const path = require('path');

if (typeof fetch !== 'function') {
  console.error('Node.js 18 以上が必要です。');
  process.exit(1);
}

const variant = process.argv[2] || 'normal';
const LANG_BASE = {
  normal: 'https://tessdata.projectnaptha.com/4.0.0',
  fast: 'https://tessdata.projectnaptha.com/4.0.0_fast',
  best: 'https://tessdata.projectnaptha.com/4.0.0_best',
}[variant];
if (!LANG_BASE) {
  console.error('引数は normal / fast / best のいずれかです。');
  process.exit(1);
}

const JSD = 'https://cdn.jsdelivr.net/npm/';
const files = [
  [JSD + 'tesseract.js@5/dist/tesseract.min.js', 'lib/tesseract/tesseract.min.js'],
  [JSD + 'tesseract.js@5/dist/worker.min.js', 'lib/tesseract/worker.min.js'],
  [JSD + 'tesseract.js-core@5/tesseract-core-lstm.wasm.js', 'lib/tesseract/tesseract-core-lstm.wasm.js'],
  [JSD + 'tesseract.js-core@5/tesseract-core-simd-lstm.wasm.js', 'lib/tesseract/tesseract-core-simd-lstm.wasm.js'],
  [LANG_BASE + '/jpn.traineddata.gz', 'lib/tesseract/lang/jpn.traineddata.gz'],
];

(async () => {
  let failed = 0;
  for (const [url, dest] of files) {
    const out = path.join(__dirname, dest);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, buf);
      console.log('OK   ' + dest + '  (' + (buf.length / 1024 / 1024).toFixed(2) + ' MB)');
    } catch (e) {
      failed++;
      console.error('NG   ' + dest + '  ← ' + url + '  (' + e.message + ')');
    }
  }
  if (failed) {
    console.error('\n' + failed + ' 個のファイルを取得できませんでした。ネットワークを確認して、もう一度実行してください。');
    process.exit(1);
  }
  console.log('\nすべて取得しました。lib/ フォルダごとGitHubにアップロードしてください。');
})();
