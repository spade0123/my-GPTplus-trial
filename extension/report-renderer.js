(() => {
  const make = (tag, className) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    return element;
  };
  const escaped = (text, index) => {
    let slashes = 0;
    while (index > 0 && text[--index] === '\\') slashes++;
    return slashes % 2 === 1;
  };
  let parser;
  const keywords = new Set('alignas alignof and asm auto break case catch class const constexpr continue default delete do else enum explicit export extern false for friend if inline mutable namespace new noexcept not nullptr operator or private protected public register reinterpret_cast return sizeof static static_cast struct switch template this throw true try typedef typename union unsigned using virtual volatile while co_await co_return co_yield concept requires import module'.split(' '));
  const types = new Set('bool char char16_t char32_t double float int long short signed void wchar_t size_t string vector array pair map set unordered_map unordered_set queue stack deque tuple optional int64_t uint64_t'.split(' '));
  const builtins = new Set('cin cout cerr endl getline scanf printf sort stable_sort reverse min max swap lower_bound upper_bound find accumulate gcd sqrt abs fabs'.split(' '));
  function languageOf(lang, source) {
    const label = String(lang || '').split(/\s/)[0].toLowerCase();
    if (['cpp','c++','cxx','cc','c'].includes(label)) return 'cpp';
    if (['js','javascript','ts','typescript','java','python','py','rust','rs','json'].includes(label)) return label;
    if ((!label || label === 'text') && /#include|\busing\s+namespace\b|\b(?:int|void|double|auto|vector|string)\s+\w+|\b(?:cin|cout)\s*(?:>>|<<)/.test(source)) return 'cpp';
    return 'text';
  }
  function highlight(target, source, language = 'cpp') {
    // Build only text and fixed-class spans. Source is never interpreted as HTML
    // or reformatted: highlighting and copying retain the exact characters.
    if (language === 'text' || source.length > 100000) { target.textContent = source; return; }
    const word = /[A-Za-z_]\w*/y, number = /(?:0[xX][\da-fA-F']+(?:\.[\da-fA-F']*)?(?:[pP][+-]?\d+)?|0[bB][01']+|(?:\d[\d']*(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)[uUlLfF]*/y;
    let i = 0, plain = '', spans = 0;
    const emit = (text, kind) => {
      if (!kind) { plain += text; return; }
      spans++;
      if (plain) { target.append(document.createTextNode(plain)); plain = ''; }
      const span = make('span', 'syntax-' + kind); span.textContent = text; target.append(span);
    };
    while (i < source.length) {
      if (spans >= 6000) { emit(source.slice(i)); break; }
      const start = i, raw = source.slice(i, i + 24).match(/^(?:u8|u|U|L)?R"([^\s()\\]{0,16})\(/);
      if (source.startsWith('//', i) || language === 'python' && source[i] === '#') {
        const end = source.indexOf('\n', i); i = end < 0 ? source.length : end; emit(source.slice(start, i), 'comment');
      } else if (source.startsWith('/*', i)) {
        const end = source.indexOf('*/', i + 2); i = end < 0 ? source.length : end + 2; emit(source.slice(start, i), 'comment');
      } else if (raw) {
        const end = source.indexOf(')' + raw[1] + '"', i + raw[0].length); i = end < 0 ? source.length : end + raw[1].length + 2; emit(source.slice(start, i), 'string');
      } else if (['"', "'", '`'].includes(source[i])) {
        const quote = source[i++]; while (i < source.length) { if (source[i] === '\\') { i += 2; continue; } if (source[i++] === quote) break; }
        i = Math.min(i, source.length); emit(source.slice(start, i), 'string');
      } else if (source[i] === '#' && language === 'cpp') {
        const end = source.indexOf('\n', i); i = end < 0 ? source.length : end; emit(source.slice(start, i), 'directive');
      } else {
        word.lastIndex = i; number.lastIndex = i;
        const identifier = word.exec(source), numeric = identifier ? null : number.exec(source);
        if (identifier) { i = word.lastIndex; const value = identifier[0]; emit(value, keywords.has(value) ? 'keyword' : types.has(value) ? 'type' : builtins.has(value) ? 'builtin' : undefined); }
        else if (numeric) { i = number.lastIndex; emit(numeric[0], 'number'); }
        else { const value = source[i++]; emit(value, /[+\-*/%=!<>&|^~?:]/.test(value) ? 'operator' : undefined); }
      }
    }
    if (plain) target.append(document.createTextNode(plain));
  }
  function codeBlock(token) {
    const source = token.text, language = languageOf(token.lang, source), frame = make('div', 'code-frame');
    const bar = make('div', 'code-toolbar'), label = make('span', 'code-language'), copy = make('button', 'code-copy');
    label.textContent = language === 'cpp' ? 'C++' : language.toUpperCase();
    copy.type = 'button'; const copyLabel = language === 'text' ? '复制文本' : '复制代码'; copy.textContent = copyLabel;
    copy.setAttribute('aria-label', copyLabel); copy.setAttribute('aria-live', 'polite');
    copy.onclick = async () => {
      copy.disabled = true;
      try { await navigator.clipboard.writeText(source); copy.textContent = '已复制'; copy.title = '已复制原始内容，保留缩进和换行。'; }
      catch { copy.textContent = '复制失败'; copy.title = '浏览器未允许复制，请选中代码复制。'; }
      finally { copy.disabled = false; setTimeout(() => { copy.textContent = copyLabel; }, 1500); }
    };
    bar.append(label, copy);
    const pre = make('pre', 'report-code'), code = make('code'); pre.dataset.language = language;
    highlight(code, source, language); pre.append(code); frame.append(bar, pre); return frame;
  }

  function mathExtension(display) {
    return {
      name: display ? 'coachMathBlock' : 'coachMathInline',
      level: display ? 'block' : 'inline',
      start(source) {
        if (display) return source.search(/^ {0,3}(?:\$\$|\\\[)/m);
        const positions = [source.indexOf('$'), source.indexOf('\\(')].filter(i => i >= 0);
        return positions.length ? Math.min(...positions) : undefined;
      },
      tokenizer(source) {
        const prefix = display ? source.match(/^ {0,3}(\$\$|\\\[)/) : source.match(/^(\\\(|\$(?!\$))/);
        if (!prefix) return;
        const open = prefix[1], close = open === '\\(' ? '\\)' : open === '\\[' ? '\\]' : open;
        let end = source.indexOf(close, prefix[0].length);
        while (end >= 0) {
          const content = source.slice(prefix[0].length, end);
          if (!escaped(source, end) && content.trim() &&
              (display || (!content.includes('\n') && !/^\s|\s$/.test(content))) &&
              (open !== '$' || !/\d/.test(source[end + 1] || ''))) {
            return {type: this.name, raw: source.slice(0, end + close.length), text: content.trim(), display};
          }
          end = source.indexOf(close, end + close.length);
        }
      }
    };
  }

  function getParser() {
    if (!parser) {
      parser = new globalThis.marked.Marked({gfm: true, breaks: false});
      // Custom tokenizers run before Markdown escaping, so math survives intact.
      for (const display of [true, false]) {
        const rule = mathExtension(display);
        const tokenize = rule.tokenizer;
        rule.tokenizer = function(source) { return tokenize.call(rule, source); };
        parser.use({extensions: [rule]});
      }
    }
    return parser;
  }

  function textValue(text) {
    // Decode entities without interpreting arbitrary HTML from model output.
    return String(text || '').replace(/&(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]+);/gi, entity => {
      const decoder = make('textarea');
      decoder.innerHTML = entity;
      return decoder.value;
    });
  }

  function renderMath(target, source, display, katex) {
    if (!katex?.render) {
      target.textContent = display ? `\\[${source}\\]` : `$${source}$`;
      return;
    }
    try {
      katex.render(source, target, {displayMode: display, output: 'htmlAndMathml', throwOnError: false,
        trust: false, maxSize: 20, maxExpand: 1000, strict: 'ignore'});
    } catch { target.textContent = source; }
  }

  function safeLink(href) {
    try {
      const url = new URL(href);
      return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null;
    } catch { return null; }
  }

  function inline(target, tokens, katex) {
    for (const token of tokens || []) {
      if (['strong', 'em', 'del'].includes(token.type)) {
        const child = make(token.type); inline(child, token.tokens, katex); target.append(child);
      } else if (token.type === 'codespan') {
        const code = make('code'); highlight(code, token.text); target.append(code);
      } else if (token.type === 'br') target.append(make('br'));
      else if (token.type === 'coachMathInline') {
        const span = make('span', 'math-inline'); renderMath(span, token.text, false, katex); target.append(span);
      } else if (token.type === 'link') {
        const href = safeLink(token.href);
        const child = make(href ? 'a' : 'span');
        if (href) { child.href = href; child.target = '_blank'; child.rel = 'noopener noreferrer'; }
        inline(child, token.tokens, katex); target.append(child);
      } else if (token.type === 'image') {
        // Display the alt text; viewing a report must not fetch remote images.
        const alt = make('span', 'report-image'); alt.textContent = `〔图片：${textValue(token.text)}〕`; target.append(alt);
      } else if (token.tokens) inline(target, token.tokens, katex);
      else target.append(document.createTextNode(token.type === 'html' ? token.raw : textValue(token.text || token.raw)));
    }
  }

  function blocks(target, tokens, katex) {
    for (const token of tokens || []) {
      if (token.type === 'space' || token.type === 'def') continue;
      let element;
      if (token.type === 'heading') {
        element = make(`h${Math.max(1, Math.min(6, token.depth))}`); inline(element, token.tokens, katex);
      } else if (token.type === 'paragraph' || token.type === 'text') {
        element = make('p'); inline(element, token.tokens || [{type: 'text', text: token.text}], katex);
      } else if (token.type === 'code') {
        element = codeBlock(token);
      } else if (token.type === 'blockquote') {
        element = make('blockquote'); blocks(element, token.tokens, katex);
      } else if (token.type === 'hr') element = make('hr');
      else if (token.type === 'list') {
        element = make(token.ordered ? 'ol' : 'ul');
        if (token.ordered && token.start !== 1) element.start = token.start;
        for (const item of token.items) {
          const li = make('li');
          if (item.task) { const check = make('input'); check.type = 'checkbox'; check.disabled = true; check.checked = item.checked; li.append(check); }
          blocks(li, item.tokens, katex); element.append(li);
        }
      } else if (token.type === 'table') {
        element = make('div', 'table-scroll');
        const table = make('table'), head = make('thead'), header = make('tr'), body = make('tbody');
        const cell = (value, index, tag) => {
          const td = make(tag); if (tag === 'th') td.scope = 'col';
          if (['left', 'right', 'center'].includes(token.align[index])) td.style.textAlign = token.align[index];
          inline(td, value.tokens, katex); return td;
        };
        token.header.forEach((value, i) => header.append(cell(value, i, 'th'))); head.append(header);
        for (const row of token.rows) { const tr = make('tr'); row.forEach((value, i) => tr.append(cell(value, i, 'td'))); body.append(tr); }
        table.append(head, body); element.append(table);
      } else if (token.type === 'coachMathBlock') {
        element = make('div', 'math-block'); renderMath(element, token.text, true, katex);
      } else {
        element = make('p'); element.textContent = token.raw || token.text || '';
      }
      target.append(element);
    }
  }

  function render(container, markdown, katex = globalThis.katex) {
    const source = String(markdown || '');
    try {
      const fragment = document.createDocumentFragment();
      blocks(fragment, getParser().lexer(source), katex);
      if (container.closest('#hintPanel') && !container.closest('#chatPanel')) {
        for (const heading of [...fragment.children]) {
          if (!/^H[12]$/.test(heading.tagName) || !/^(?:原题目|原题|题目与样例)(?:\s|$|[（(：:])/.test(heading.textContent.trim())) continue;
          const details = make('details', 'problem-section'), summary = make('summary'); summary.textContent = heading.textContent;
          let next = heading.nextSibling; heading.replaceWith(details); details.append(summary);
          while (next && !(next.nodeType === 1 && /^H[12]$/.test(next.tagName))) { const following = next.nextSibling; details.append(next); next = following; }
        }
      }
      container.replaceChildren(fragment);
    } catch {
      // Preserve readable content if a dependency or unexpected token fails.
      container.textContent = source;
    }
  }
  globalThis.PkuReportRenderer = {render};
})();
