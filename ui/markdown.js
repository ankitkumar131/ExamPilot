// Tiny offline Markdown renderer (no deps): code fences + copy, headers,
// bold/italic/inline-code, lists, paragraphs. Shared by response/chat/notes.
(function () {
  window.__mdCodes = window.__mdCodes || [];
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function inline(s) {
    let h = esc(s);
    h = h.replace(/`([^`]+)`/g, '<code class="md-inline">$1</code>');
    h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/(^|\W)\*([^*\n]+)\*/g, '$1<em>$2</em>');
    return h;
  }
  function renderMarkdown(src) {
    const codes = [];
    // 1) Extract fenced code blocks.
    let text = String(src || '').replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, lang, code) => {
      const clean = code.replace(/\n$/, '');
      const idx = window.__mdCodes.push(clean) - 1;
      codes.push({ lang: lang || 'code', idx });
      return `\u0000CODE${codes.length - 1}\u0000`;
    });
    // 2) Line-based blocks.
    const lines = text.split('\n');
    let html = '';
    let inUL = false;
    let inOL = false;
    let para = [];
    const flushPara = () => {
      if (para.length) { html += `<p>${inline(para.join(' '))}</p>`; para = []; }
    };
    const closeLists = () => {
      if (inUL) { html += '</ul>'; inUL = false; }
      if (inOL) { html += '</ol>'; inOL = false; }
    };
    for (const raw of lines) {
      const line = raw.replace(/\r$/, '');
      const codeRef = line.match(/^\u0000CODE(\d+)\u0000$/);
      if (codeRef) {
        flushPara(); closeLists();
        const c = codes[Number(codeRef[1])];
        html += `<div class="md-code"><div class="md-code-head"><span>${esc(c.lang)}</span>` +
          `<button class="md-copy" data-md="${c.idx}">Copy</button></div>` +
          `<pre><code>${esc(window.__mdCodes[c.idx])}</code></pre></div>`;
        continue;
      }
      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) {
        flushPara(); closeLists();
        const lvl = h[1].length;
        html += `<h${lvl} class="md-h">${inline(h[2])}</h${lvl}>`;
        continue;
      }
      const ul = line.match(/^\s*[-*•]\s+(.*)$/);
      if (ul) {
        flushPara();
        if (inOL) { html += '</ol>'; inOL = false; }
        if (!inUL) { html += '<ul class="md-ul">'; inUL = true; }
        html += `<li>${inline(ul[1])}</li>`;
        continue;
      }
      const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (ol) {
        flushPara();
        if (inUL) { html += '</ul>'; inUL = false; }
        if (!inOL) { html += '<ol class="md-ol">'; inOL = true; }
        html += `<li>${inline(ol[1])}</li>`;
        continue;
      }
      if (/^\s*$/.test(line)) { flushPara(); closeLists(); continue; }
      if (/^\s*---+\s*$/.test(line)) { flushPara(); closeLists(); html += '<hr class="md-hr"/>'; continue; }
      para.push(line.trim());
    }
    flushPara(); closeLists();
    return html || '<p class="md-empty">…</p>';
  }
  window.renderMarkdown = renderMarkdown;
  // Global copy-button delegation (works on every page that loads this file).
  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('.md-copy') : null;
    if (!btn) return;
    const code = window.__mdCodes[Number(btn.dataset.md)] || '';
    const done = () => { btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy'; }, 1200); };
    try {
      if (window.electronAPI && window.electronAPI.clipboardCopy) window.electronAPI.clipboardCopy(code).then(done).catch(done);
      else if (navigator.clipboard) navigator.clipboard.writeText(code).then(done).catch(done);
      else done();
    } catch (_) { done(); }
  });
})();
