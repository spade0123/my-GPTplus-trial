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
        const code = make('code'); code.textContent = token.text; target.append(code);
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
        element = make('pre', 'report-code');
        if (token.lang) element.dataset.language = token.lang.split(/\s/)[0];
        const code = make('code'); code.textContent = token.text; element.append(code);
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
      container.replaceChildren(fragment);
    } catch {
      // Preserve readable content if a dependency or unexpected token fails.
      container.textContent = source;
    }
  }
  globalThis.PkuReportRenderer = {render};
})();
