'use strict';

(() => {
  const $ = (sel) => document.querySelector(sel);

  const STORAGE_KEY = 'brat-sticker-v1';
  const PREVIEW_SIZE = 1024;
  const EXPORT_SIZE = 512;
  const BASE = 512;
  const MAX_TEXT = 240;
  const MAX_BYTES = 100000;

  // Gaya dikunci dari pengukuran sample meme brat asli (memes/002_862_671_af8.jpg):
  // stroke/font 0.08 -> Arial regular (400), bukan bold.
  // ink bbox 0.90 x 0.87, x0 0.051 -> margin 5%, tiap baris rata ke 90% lebar.
  // pitch baris 0.182 x tinggi kanvas -> font 0.18 + leading 1.0 em.
  // glyph sempit (rasio lebar/ascender 1.588, alt text cover: "Arial Narrow").
  // transisi tepi ~1.2% pada cover 2048 -> blur sigma ~0.5% (2.5px di 512).
  const STYLE = Object.freeze({
    font: '"Arial Narrow", "Helvetica Neue", Arial, sans-serif',
    weight: 400,
    pad: 0.05,
    blur: 2.5,
    bg: '#ffffff',
    fg: '#0a0a0a',
  });

  const els = {
    preview: $('#preview'),
    text: $('#text'),
    chips: $('#chips'),
    charCount: $('#charCount'),
    btnDownload: $('#btnDownload'),
    btnCopy: $('#btnCopy'),
    btnShare: $('#btnShare'),
    btnBatch: $('#btnBatch'),
    toast: $('#toast'),
  };

  const pctx = els.preview.getContext('2d');

  let state = loadState();
  let rafId = 0;
  let persistTimer = 0;
  let toastTimer = 0;

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      if (typeof saved.text === 'string') {
        return { text: saved.text.slice(0, MAX_TEXT) };
      }
    } catch {
      /* storage rusak atau diblokir */
    }
    return { text: 'brat' };
  }

  function effectiveText() {
    return String(state.text).replace(/\r\n?/g, '\n').toLowerCase();
  }

  function fontString(px) {
    return `${STYLE.weight} ${px}px ${STYLE.font}`;
  }

  function wrapParagraph(ctx, words, maxWidth) {
    const lines = [];
    let current = words[0];
    for (let i = 1; i < words.length; i += 1) {
      const candidate = `${current} ${words[i]}`;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        current = words[i];
      }
    }
    lines.push(current);
    return lines;
  }

  // lebar baris sekecil mungkin tanpa menambah jumlah baris: baris jadi
  // hampir sama panjang, jadi regangan horizontal tiap baris kecil.
  function balancedWrap(ctx, text, maxWidth) {
    const lines = [];
    for (const paragraph of text.split('\n')) {
      const words = paragraph.split(/\s+/).filter(Boolean);
      if (!words.length) {
        lines.push('');
        continue;
      }
      const count = wrapParagraph(ctx, words, maxWidth).length;
      if (count < 2) {
        lines.push(words.join(' '));
        continue;
      }
      let narrow = 0;
      for (const word of words) narrow = Math.max(narrow, ctx.measureText(word).width);
      let wide = maxWidth;
      for (let step = 0; step < 18; step += 1) {
        const mid = (wide + narrow) / 2;
        if (wrapParagraph(ctx, words, mid).length <= count) wide = mid;
        else narrow = mid;
      }
      lines.push(...wrapParagraph(ctx, words, wide));
    }
    return lines;
  }

  function computeLayout(ctx, size, text) {
    const pad = size * STYLE.pad;
    const targetW = Math.max(1, size - pad * 2);
    const availH = targetW;

    let lo = size * 0.01;
    let hi = size * 1.2;
    let bestFont = lo;
    let bestLines = null;

    for (let step = 0; step < 24; step += 1) {
      const mid = (lo + hi) / 2;
      ctx.font = fontString(mid);
      const lines = balancedWrap(ctx, text, targetW);
      const blockH = lines.length * mid;
      let widest = 0;
      let narrowest = targetW;
      for (const line of lines) {
        if (!line) continue;
        const width = ctx.measureText(line).width;
        widest = Math.max(widest, width);
        narrowest = Math.min(narrowest, width);
      }
      if (blockH <= availH + 0.01 && widest <= targetW + 0.01) {
        lo = mid;
        bestFont = mid;
        bestLines = lines;
      } else {
        hi = mid;
      }
    }

    if (!bestLines) {
      bestFont = lo;
      ctx.font = fontString(bestFont);
      bestLines = balancedWrap(ctx, text, targetW);
    }

    let fontPx = bestFont;
    let lines = bestLines;
    let blockH = lines.length * fontPx;

    const maxBlockH = size * 0.985;
    if (blockH > maxBlockH) {
      fontPx *= maxBlockH / blockH;
      ctx.font = fontString(fontPx);
      lines = balancedWrap(ctx, text, targetW);
      blockH = lines.length * fontPx;
    }

    return { fontPx, lines, blockH, pad, targetW };
  }

  function drawSticker(ctx, size, textOverride) {
    const text = textOverride != null ? textOverride : effectiveText();

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = STYLE.bg;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();

    if (!text.trim()) return;

    const { fontPx, lines, blockH, pad, targetW } = computeLayout(ctx, size, text);
    const blurPx = STYLE.blur * (size / BASE);

    ctx.save();
    ctx.font = fontString(fontPx);
    ctx.fillStyle = STYLE.fg;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    if (blurPx > 0.05) ctx.filter = `blur(${blurPx}px)`;

    const startY = (size - blockH) / 2;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line) continue;
      const lineWidth = ctx.measureText(line).width;
      if (lineWidth <= 0) continue;
      const stretchX = Math.max(0.15, Math.min(1.9, targetW / lineWidth));
      ctx.save();
      ctx.translate(pad, startY + i * fontPx);
      ctx.scale(stretchX, 1);
      ctx.fillText(line, 0, 0);
      ctx.restore();
    }

    ctx.restore();
  }

  function renderPreview() {
    drawSticker(pctx, PREVIEW_SIZE);
  }

  function scheduleRender() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      renderPreview();
    });
  }

  function renderToBlob(textOverride, size = EXPORT_SIZE) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    drawSticker(ctx, size, textOverride);

    // WhatsApp menolak sticker di atas ~100KB. Blur PNG itu mahal, jadi kalau
    // kelebihan: posterize grayscale bertingkat sampai masuk batas. Sticker ini
    // selalu hitam di atas putih, jadi aman.
    return encodePng(canvas).then(async (first) => {
      if (first.size <= MAX_BYTES) return first;
      const base = ctx.getImageData(0, 0, size, size);
      const work = new ImageData(new Uint8ClampedArray(base.data), size, size);
      let best = first;
      for (const levels of [32, 16, 10]) {
        posterize(work.data, base.data, levels);
        ctx.putImageData(work, 0, 0);
        best = await encodePng(canvas);
        if (best.size <= MAX_BYTES) return best;
      }
      return best;
    });
  }

  function encodePng(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('render gagal'));
      }, 'image/png');
    });
  }

  function posterize(target, source, levels) {
    const step = 255 / (levels - 1);
    for (let i = 0; i < target.length; i += 4) {
      const v = Math.round((source[i] * 299 + source[i + 1] * 587 + source[i + 2] * 114) / 1000);
      const q = Math.round(v / step) * step;
      target[i] = q;
      target[i + 1] = q;
      target[i + 2] = q;
    }
  }

  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  function fileName() {
    return `brat-${stamp()}.png`;
  }

  function triggerDownload(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function downloadPng() {
    try {
      const blob = await renderToBlob();
      triggerDownload(blob, fileName());
      toast(`png ${EXPORT_SIZE}×${EXPORT_SIZE} downloaded`);
    } catch {
      toast('download failed. try again.');
    }
  }

  async function copyPng() {
    if (!navigator.clipboard || typeof window.ClipboardItem === 'undefined') {
      toast('this browser can’t copy images. use download png.');
      return;
    }
    try {
      const blob = await renderToBlob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('png copied');
    } catch {
      toast('copy failed. use download png.');
    }
  }

  async function sharePng() {
    try {
      const blob = await renderToBlob();
      const file = new File([blob], fileName(), { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'brat sticker' });
      } else {
        toast('sharing isn’t supported here. use download png.');
      }
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      toast('share failed');
    }
  }

  async function downloadBatch() {
    const lines = effectiveText().split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) {
      toast('batch needs at least 2 lines');
      return;
    }
    toast(`downloading ${lines.length} files`);
    for (let i = 0; i < lines.length; i += 1) {
      try {
        const blob = await renderToBlob(lines[i]);
        triggerDownload(blob, `brat-${String(i + 1).padStart(2, '0')}.png`);
      } catch {
        toast('a line failed to render');
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }

  function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ text: state.text }));
      } catch {
        /* storage penuh atau diblokir */
      }
    }, 180);
  }

  function toast(message) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add('show');
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2300);
  }

  function fitTextarea() {
    els.text.style.height = 'auto';
    els.text.style.height = `${Math.min(Math.max(els.text.scrollHeight, 92), 220)}px`;
  }

  function setText(value) {
    state.text = String(value).slice(0, MAX_TEXT);
    els.text.value = state.text;
    els.charCount.textContent = `${state.text.length}/${MAX_TEXT}`;
    fitTextarea();
    scheduleRender();
    persist();
  }

  function bindEvents() {
    els.text.addEventListener('input', () => setText(els.text.value));

    els.chips.addEventListener('click', (event) => {
      const picked = event.target.closest('.sample');
      if (picked) setText(picked.dataset.text || '');
    });

    els.btnDownload.addEventListener('click', downloadPng);
    els.btnCopy.addEventListener('click', copyPng);
    els.btnShare.addEventListener('click', sharePng);
    els.btnBatch.addEventListener('click', downloadBatch);
  }

  els.text.value = state.text;
  els.charCount.textContent = `${state.text.length}/${MAX_TEXT}`;
  fitTextarea();
  bindEvents();
  renderPreview();
})();
