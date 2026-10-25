/* ふりがな（読み）の取得
 *   await Furigana.load(onProgress)       … 辞書を一度だけメモリへロード（以後は保持）
 *   Furigana.lookup(lineText, offset)     … 行の文字列と、タップした文字の位置から読みを返す
 *
 * 文字単体ではなく「行全体」を形態素解析し、タップ位置を含む単語の読みを返す。
 * （「行った」「人気」など、前後の文字で読みが変わる語を正しく拾うため）
 */
const Furigana = (() => {
  // 注意: kuromojiのdicPathに絶対URL(https://...)を渡すと内部のpath.joinで壊れるため、相対パスで指定する
  const DICT_DIR = 'lib/kuromoji/dict/';
  const DICT_FILES = [
    'base.dat.gz', 'check.dat.gz', 'tid.dat.gz', 'tid_pos.dat.gz', 'tid_map.dat.gz',
    'cc.dat.gz', 'unk.dat.gz', 'unk_pos.dat.gz', 'unk_map.dat.gz',
    'unk_char.dat.gz', 'unk_compat.dat.gz', 'unk_invoke.dat.gz',
  ];

  let tokenizer = null; // 一度ロードしたら、ページを閉じるまで保持する
  let lastText = null;
  let lastTokens = null;

  const nextPaint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

  // onProgress(0〜1, メッセージ, 展開中フラグ)
  async function load(onProgress) {
    if (tokenizer) return;
    const report = onProgress || (() => {});

    // 1) 辞書ファイルを先に取得して、進み具合を見せる（ブラウザのキャッシュにも載る）
    let done = 0;
    for (const f of DICT_FILES) {
      const res = await fetch(DICT_DIR + f, { cache: 'force-cache' });
      if (!res.ok) throw new Error('辞書ファイルを取得できません: ' + f + ' (' + res.status + ')');
      await res.arrayBuffer();
      done++;
      report((done / DICT_FILES.length) * 0.5, '辞書ファイルを読み込み中 ' + done + '/' + DICT_FILES.length, false);
    }

    // 2) 展開してメモリ上に構築（ここが重い。この間は画面が止まって見えることがある）
    report(0.5, '辞書を展開中…（端末によって数十秒〜数分かかります）', true);
    await nextPaint();
    tokenizer = await new Promise((resolve, reject) => {
      kuromoji.builder({ dicPath: DICT_DIR }).build((err, t) => (err ? reject(err) : resolve(t)));
    });
    report(1, '辞書の準備ができました', false);
  }

  function toHiragana(s) {
    if (!s || s === '*') return '';
    return s.replace(/[\u30A1-\u30F6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  }

  function tokensOf(text) {
    if (text !== lastText) {
      lastTokens = tokenizer.tokenize(text);
      lastText = text;
    }
    return lastTokens;
  }

  // 名詞の連なり（西京＋焼）や、動詞＋助動詞（食べ＋まし＋た）を一つの語として扱う
  const isNounish = (t) => t.pos === '名詞' || t.pos === '接頭詞';
  const isTail = (t) => t.pos === '助動詞' || (t.pos === '動詞' && t.pos_detail_1 === '非自立');
  const MAX_COMPOUND = 10; // まとめる文字数の上限（長くなりすぎ防止）
  const HAS_KANJI = /[\u3400-\u9FFF]/;

  // 戻り値: { surface, reading, start, end } / 見つからなければ null
  function lookup(lineText, offset) {
    if (!tokenizer) return null;

    // 1) 補正辞書：登録済みの語は最優先
    const fixed = Corrections.find(lineText, offset);
    if (fixed) return fixed;

    // 2) 行全体を形態素解析し、タップ位置のトークンを探す
    const toks = tokensOf(lineText);
    const pos = (t) => t.word_position - 1; // kuromojiのword_positionは1始まり
    const i = toks.findIndex((t) => offset >= pos(t) && offset < pos(t) + t.surface_form.length);
    if (i < 0) return null;

    // 3) 前後のトークンを、一つの語としてまとめる
    let lo = i;
    let hi = i;
    const span = (a, b) => pos(toks[b]) + toks[b].surface_form.length - pos(toks[a]);
    if (isNounish(toks[i])) {
      while (lo > 0 && isNounish(toks[lo - 1]) && span(lo - 1, hi) <= MAX_COMPOUND) lo--;
      while (hi < toks.length - 1 && isNounish(toks[hi + 1]) && span(lo, hi + 1) <= MAX_COMPOUND) hi++;
    } else if (toks[i].pos === '動詞' || toks[i].pos === '形容詞') {
      while (hi < toks.length - 1 && isTail(toks[hi + 1])) hi++;
    }

    const members = toks.slice(lo, hi + 1);
    const start = pos(toks[lo]);
    const end = pos(toks[hi]) + toks[hi].surface_form.length;
    const surface = lineText.slice(start, end);

    // 4) 読み：まとめた語の登録 → 各トークンの登録/辞書の読み、の順
    let reading = UserDict.get(surface);
    if (!reading) {
      const parts = members.map((t) => UserDict.get(t.surface_form) || toHiragana(t.reading));
      const missing = members.some((t, k) => !parts[k] && HAS_KANJI.test(t.surface_form));
      reading = missing ? '' : parts.join('');
    }
    return { surface, reading, start, end };
  }

  return { load, lookup };
})();
