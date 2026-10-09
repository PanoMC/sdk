// Small source scanners shared by check-static.js, check-locales.mjs and check-theme.js.
// No AST: the rules are deliberately simple and each one has a unit test in scan.test.js.

const blank = (m) => m.replace(/[^\n]/g, ' ');

export function splitSvelte(source) {
  const scripts = [];
  let markup = source.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/g, (m, attrs, code, off) => {
    scripts.push({
      attrs,
      code,
      offset: off + m.indexOf('>') + 1,
      module: /\b(module|context\s*=\s*["']module["'])/.test(attrs),
    });
    return blank(m);
  });
  const styles = [];
  markup = markup.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, (m, off) => {
    styles.push({ index: off });
    return blank(m);
  });
  markup = markup.replace(/<!--[\s\S]*?-->/g, blank);
  return { markup, scripts, styles };
}

// Opening tags of markup: [{ name, attrs, index }]; honours quotes and {braces} in attributes.
export function parseTags(markup) {
  const tags = [];
  let i = 0;
  while (i < markup.length) {
    if (markup[i] === '{') {
      i = skipBraces(markup, i);
      continue;
    }
    if (markup[i] === '<' && /[A-Za-z]/.test(markup[i + 1] ?? '')) {
      const m = /^<([A-Za-z][\w.:-]*)/.exec(markup.slice(i, i + 80));
      const name = m[1];
      let j = i + m[0].length;
      let quote = '';
      while (j < markup.length) {
        const c = markup[j];
        if (quote) {
          if (c === quote) quote = '';
        } else if (c === '"' || c === "'") quote = c;
        else if (c === '{') {
          j = skipBraces(markup, j);
          continue;
        } else if (c === '>') break;
        j++;
      }
      tags.push({ name, attrs: markup.slice(i + m[0].length, j), index: i });
      i = j + 1;
      continue;
    }
    i++;
  }
  return tags;
}

function skipBraces(s, start) {
  let depth = 0;
  let quote = '';
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  return s.length;
}

// Text nodes with letters that sit outside {...} and outside tags.
export function hardcodedTexts(markup) {
  const found = [];
  let i = 0;
  let textStart = 0;
  const flush = (end) => {
    const text = markup.slice(textStart, end).replace(/&[a-zA-Z#0-9]+;/g, ' ');
    if (/\p{L}/u.test(text)) found.push({ index: textStart, text: text.trim().slice(0, 60) });
  };
  while (i < markup.length) {
    const c = markup[i];
    if (c === '{') {
      flush(i);
      i = skipBraces(markup, i);
      textStart = i;
    } else if (c === '<' && /[A-Za-z\/!]/.test(markup[i + 1] ?? '')) {
      flush(i);
      let quote = '';
      let j = i + 1;
      while (j < markup.length) {
        const d = markup[j];
        if (quote) {
          if (d === quote) quote = '';
        } else if (d === '"' || d === "'") quote = d;
        else if (d === '{') {
          j = skipBraces(markup, j);
          continue;
        } else if (d === '>') break;
        j++;
      }
      i = j + 1;
      textStart = i;
    } else i++;
  }
  flush(markup.length);
  return found;
}

// {@html expr} occurrences: [{ expr, index }]
export function htmlSinks(markup) {
  const out = [];
  const re = /\{@html\s/g;
  let m;
  while ((m = re.exec(markup))) {
    const end = skipBraces(markup, m.index);
    out.push({ expr: markup.slice(m.index + m[0].length, end - 1).trim(), index: m.index });
  }
  return out;
}

// Replace comments and string contents so brace/keyword scans are not fooled.
function maskJs(code) {
  let out = '';
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    const n = code[i + 1];
    if (c === '/' && n === '/') {
      while (i < code.length && code[i] !== '\n') ((out += ' '), i++);
    } else if (c === '/' && n === '*') {
      const end = code.indexOf('*/', i + 2);
      const stop = end === -1 ? code.length : end + 2;
      out += blank(code.slice(i, stop));
      i = stop;
    } else if (c === '"' || c === "'" || c === '`') {
      out += c;
      i++;
      while (i < code.length && code[i] !== c) {
        if (code[i] === '\\') ((out += ' '), i++);
        out += code[i] === '\n' ? '\n' : ' ';
        i++;
      }
      out += c;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// Browser-global reads at module top level: brace depth 0 and no arrow / function in the
// statement before the identifier. Returns [{ name, index }]. `names` e.g. ['localStorage'].
export function topLevelGlobals(code, names) {
  const masked = maskJs(code);
  const hits = [];
  const re = new RegExp(`(?<![\\w$.])(${names.join('|')})\\b(?!\\s*:)`, 'g');
  let m;
  while ((m = re.exec(masked))) {
    let depth = 0;
    for (let k = 0; k < m.index; k++) {
      if (masked[k] === '{') depth++;
      else if (masked[k] === '}') depth--;
    }
    if (depth !== 0) continue;
    let s = m.index;
    while (s > 0 && masked[s - 1] !== ';' && masked[s - 1] !== '}' && masked[s - 1] !== '{') s--;
    const stmt = masked.slice(s, m.index);
    if (/=>|\bfunction\b/.test(stmt)) continue;
    // import specifiers and object keys are not reads
    if (/^\s*import\b/.test(stmt)) continue;
    hits.push({ name: m[1], index: m.index });
  }
  return hits;
}

// Static class tokens of a tag's attributes: class="a b {x}" and string literals in class={...}.
export function classTokens(attrs) {
  const tokens = [];
  const re = /(?:^|\s)class(?::[\w-]+)?\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([\s\S]*?)\}(?=\s|$|\/))/g;
  let m;
  while ((m = re.exec(attrs))) {
    if (m[1] !== undefined || m[2] !== undefined) {
      const val = (m[1] ?? m[2]).replace(/\{[^}]*\}/g, ' ');
      tokens.push(...val.split(/\s+/).filter(Boolean));
    } else {
      for (const s of m[3].matchAll(/(["'`])((?:\\.|(?!\1).)*)\1/g))
        tokens.push(
          ...s[2]
            .replace(/\$\{[^}]*\}/g, ' ')
            .split(/\s+/)
            .filter(Boolean),
        );
    }
  }
  const dirs = attrs.matchAll(/(?:^|\s)class:([\w-]+)/g);
  for (const d of dirs) tokens.push(d[1]);
  return tokens;
}
