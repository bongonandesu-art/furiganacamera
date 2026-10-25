/* 補正辞書：形態素解析の辞書が読み違える語を、先に正しい読みで返すための対応表
 *
 * 追加の仕方：下の LIST に ['表記', 'ひらがなの読み'] を1行足すだけ。
 * 長い語が優先され、タップした位置を含む語だけが対象になる。
 */
const Corrections = (() => {
  const LIST = [
    ['西京焼', 'さいきょうやき'],
    ['塩麹', 'しおこうじ'],
    ['麹', 'こうじ'],
    ['干物', 'ひもの'],
    ['唐揚', 'からあげ'],
    ['竜田揚', 'たつたあげ'],
    ['惣菜', 'そうざい'],
    ['煮物', 'にもの'],
    ['焼鮭', 'やきざけ'],
  ];

  // text の中で、offset（タップした文字の位置）を含む最長の登録語を探す
  function find(text, offset) {
    let best = null;
    for (const [surface, reading] of LIST) {
      let from = 0;
      let i;
      while ((i = text.indexOf(surface, from)) >= 0) {
        const covers = offset >= i && offset < i + surface.length;
        if (covers && (!best || surface.length > best.surface.length)) {
          best = { surface, reading, start: i, end: i + surface.length };
        }
        from = i + 1;
      }
    }
    return best;
  }

  return { find };
})();
