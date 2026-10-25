#!/usr/bin/env node
/* 日本郵便の郵便番号データ（utf_ken_all.zip）から、アプリ用の住所データを作る（Node.js 18以上）
 *
 * 手順: 日本郵便の「郵便番号データダウンロード」ページから、全国一括の全データ（zip）を保存し、
 *       このフォルダ（build-address-data.js と同じ場所）に置いてから実行する。
 *
 *   node build-address-data.js                 … このフォルダの ken_all のzip/csv を自動で探して変換
 *   node build-address-data.js ファイルのパス   … 場所を指定して変換
 *
 * UTF-8形式（utf_ken_all.zip）でも、従来形式（KEN_ALL.ZIP / KEN_ALL.CSV, Shift_JIS）でも読める。
 *
 * 出力: data/address/index.json … 都道府県の一覧（コード・名前・読み）
 *       data/address/01.json 〜 47.json … 都道府県ごとの「市区町村 → 町域」と読み（ひらがな）
 * 都道府県ごとに分けてあるので、アプリは選ばれた県の分だけをメモリに読み込む。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// 自動取得の候補（ページの構成が変わると取得できなくなるため、手元のファイルを優先する）
const URLS = [
  'https://www.post.japanpost.jp/zipcode/dl/utf/zip/utf_ken_all.zip',
  'https://www.post.japanpost.jp/zipcode/dl/kogaki/zip/ken_all.zip',
];
const OUT = path.join(__dirname, 'data', 'address');

// zipの先頭のファイルを取り出す（外部ライブラリなし）
function readZipFirstEntry(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('zipファイルとして読めません');
  const cd = buf.readUInt32LE(e + 16);
  if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error('zipの構造を読めません');
  const method = buf.readUInt16LE(cd + 10);
  const csize = buf.readUInt32LE(cd + 20);
  const lho = buf.readUInt32LE(cd + 42);
  const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
  const data = buf.subarray(start, start + csize);
  return method === 0 ? data : zlib.inflateRawSync(data);
}

// カタカナ → ひらがな（半角カナが混じっていても全角にそろえる）
const hira = (s) => s.normalize('NFKC').replace(/[\u30A1-\u30F6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

// 町域名の整理：丁目・番地などの補足を落とし、「掲載がない場合」などは町域なしとして扱う
function cleanTown(kanji, kana) {
  if (/以下に掲載がない場合|次に番地がくる場合/.test(kanji)) return null;
  let k = kanji.replace(/[（(].*$/, '').trim();
  let r = kana.replace(/[（(].*$/, '').trim();
  if (k.endsWith('一円')) { k = k.slice(0, -2); r = r.replace(/イチエン$/, ''); }
  return k ? [k, hira(r)] : null;
}

async function loadBuffer() {
  const arg = process.argv[2];
  if (arg) return fs.readFileSync(arg);
  const local = fs.readdirSync(__dirname).filter((f) => /ken_all\.(zip|csv)$/i.test(f));
  if (local.length) {
    console.log('見つけたファイルを使います: ' + local[0]);
    return fs.readFileSync(path.join(__dirname, local[0]));
  }
  for (const u of URLS) {
    try {
      console.log('サイトから取得を試します: ' + u);
      const res = await fetch(u);
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      console.log('  → 取得できません (HTTP ' + res.status + ')');
    } catch (e) {
      console.log('  → 取得できません (' + e.message + ')');
    }
  }
  throw new Error('自動では取得できませんでした。日本郵便の「郵便番号データダウンロード」のページで、全国一括の全データ（zip）を保存し、このフォルダに置いてからもう一度実行してください');
}

// UTF-8として読めなければ、従来形式のShift_JISとして読む
function decode(buf) {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, ''), enc: 'UTF-8' };
  } catch (e) {
    return { text: new TextDecoder('shift_jis').decode(buf), enc: 'Shift_JIS（従来形式）' };
  }
}

(async () => {
  const raw = await loadBuffer();
  const isZip = raw.readUInt32LE(0) === 0x04034b50;
  const { text, enc } = decode(isZip ? readZipFirstEntry(raw) : raw);
  console.log('文字コード: ' + enc);

  const prefs = new Map(); // code -> { name, kana, cities: Map(name -> { kana, towns: Map }) }
  let rows = 0;
  let open = false; // 従来形式: 括弧が次の行にまたがっている間は、続きの行を読み飛ばす
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const f = line.replace(/\r$/, '').split(',').map((x) => x.replace(/^"|"$/g, ''));
    if (f.length < 9) continue;
    if (open) { if (/[）)]/.test(f[8])) open = false; continue; }
    rows++;
    const code = f[0].slice(0, 2);
    if (!prefs.has(code)) prefs.set(code, { name: f[6], kana: hira(f[3]), cities: new Map() });
    const p = prefs.get(code);
    if (!p.cities.has(f[7])) p.cities.set(f[7], { kana: hira(f[4]), towns: new Map() });
    const t = cleanTown(f[8], f[5]);
    if (t && !p.cities.get(f[7]).towns.has(t[0])) p.cities.get(f[7]).towns.set(t[0], t[1]);
    if (/[（(]/.test(f[8]) && !/[）)]/.test(f[8])) open = true;
  }
  if (!rows) throw new Error('データを読み取れませんでした');

  fs.mkdirSync(OUT, { recursive: true });
  const index = [];
  for (const code of [...prefs.keys()].sort()) {
    const p = prefs.get(code);
    index.push([code, p.name, p.kana]);
    const body = { c: [...p.cities].map(([name, c]) => [name, c.kana, [...c.towns]]) };
    fs.writeFileSync(path.join(OUT, code + '.json'), JSON.stringify(body));
  }
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));

  console.log(rows + ' 行を読み、' + index.length + ' 都道府県のデータを作りました → data/address/');
  // 読みの表記を目で確認するための見本
  const first = prefs.get(index[0][0]);
  const sample = [...first.cities].slice(0, 3).map(([n, c]) => n + '（' + c.kana + '）').join('、');
  console.log('見本: ' + index[0][1] + '（' + index[0][2] + '）の市区町村 → ' + sample);
  if (/つ/.test(index[0][2]) && index[0][1] === '北海道') {
    console.log('注意: 促音が大きい「つ」の表記になっています（ほっかいどう → ほつかいどう）。');
  }
})().catch((e) => { console.error('エラー: ' + e.message); process.exit(1); });
