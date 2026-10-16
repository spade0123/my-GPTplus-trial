(() => {
  const make = (tag, className) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    return element;
  };

  function renderMath(target, source, display, katex) {
    if (!katex?.render) {
      target.textContent = display ? `\\[${source}\\]` : `$${source}$`;
      return;
    }
    try {
      katex.render(source, target, {
        displayMode: display,
        output: 'htmlAndMathml',
        throwOnError: false,
        trust: false,
        maxSize: 20,
        maxExpand: 1000,
        strict: 'ignore'
      });
    } catch {
      target.textContent = display ? `\\[${source}\\]` : `$${source}$`;
    }
  }

  function renderInline(target, text, katex) {
    const pattern = /\\\(([\s\S]+?)\\\)|(?<!\\)\$([^$\n]+?)\$/g;
    let start = 0;
    for (const match of text.matchAll(pattern)) {
      target.append(document.createTextNode(text.slice(start, match.index)));
      const math = make('span', 'math-inline');
      renderMath(math, match[1] ?? match[2], false, katex);
      target.append(math);
      start = match.index + match[0].length;
    }
    target.append(document.createTextNode(text.slice(start)));
  }

  function render(container, markdown, katex = globalThis.katex) {
    const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
    const fragment = document.createDocumentFragment();
    let paragraph = [];
    let list = null;

    const flushParagraph = () => {
      if (!paragraph.length) return;
      const p = make('p');
      renderInline(p, paragraph.join(' '), katex);
      fragment.append(p);
      paragraph = [];
    };
    const flushList = () => {
      if (list) fragment.append(list);
      list = null;
    };
    const flush = () => { flushParagraph(); flushList(); };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed) { flush(); continue; }

      const fence = trimmed.match(/^```\s*([\w+-]*)\s*$/);
      if (fence) {
        flush();
        const code = [];
        while (++i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i]);
        const pre = make('pre', 'report-code');
        if (fence[1]) pre.dataset.language = fence[1];
        const codeElement = make('code');
        codeElement.textContent = code.join('\n');
        pre.append(codeElement);
        fragment.append(pre);
        continue;
      }

      if (trimmed === '$$' || trimmed.startsWith('$$') || trimmed.startsWith('\\[')) {
        flush();
        let source = '';
        if (trimmed.startsWith('\\[')) {
          source = trimmed.slice(2);
          if (source.endsWith('\\]')) source = source.slice(0, -2);
          else while (++i < lines.length && !lines[i].includes('\\]')) source += `\n${lines[i]}`;
        } else if (trimmed === '$$') {
          while (++i < lines.length && lines[i].trim() !== '$$') source += `${source ? '\n' : ''}${lines[i]}`;
        } else {
          source = trimmed.slice(2);
          const end = source.indexOf('$$');
          if (end >= 0) source = source.slice(0, end);
          else while (++i < lines.length && !lines[i].includes('$$')) source += `\n${lines[i]}`;
        }
        const block = make('div', 'math-block');
        renderMath(block, source.trim(), true, katex);
        fragment.append(block);
        continue;
      }

      const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
      if (heading) {
        flush();
        const h = make(`h${Math.min(heading[1].length + 1, 5)}`);
        renderInline(h, heading[2], katex);
        fragment.append(h);
        continue;
      }

      const bullet = trimmed.match(/^[-*+]\s+(.+)$/);
      const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
      if (bullet || ordered) {
        flushParagraph();
        const nextKind = bullet ? 'ul' : 'ol';
        if (list && list.tagName.toLowerCase() !== nextKind) flushList();
        if (!list) list = make(nextKind);
        const item = make('li');
        renderInline(item, (bullet || ordered)[1], katex);
        list.append(item);
        continue;
      }

      if (trimmed.startsWith('>')) {
        flush();
        const quote = make('blockquote');
        renderInline(quote, trimmed.replace(/^>\s?/, ''), katex);
        fragment.append(quote);
        continue;
      }

      paragraph.push(trimmed);
    }
    flush();
    container.replaceChildren(fragment);
  }

  globalThis.PkuReportRenderer = { render };
})();

