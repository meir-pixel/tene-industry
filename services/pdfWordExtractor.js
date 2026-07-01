async function loadPdfJs() {
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}

function splitTextItem(item, pageNumber, pageHeight) {
  const text = String(item.str || '').trim();
  if (!text) return [];
  const transform = item.transform || [];
  const x = Number(transform[4] || 0);
  const y = Number(transform[5] || 0);
  const width = Number(item.width || 0);
  const height = Number(item.height || transform[3] || 0) || 1;
  const top = pageHeight - y - height;
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return [{ text, x0: x, x1: x + width, top, bottom: top + height, page: pageNumber }];
  }
  const totalChars = parts.reduce((sum, part) => sum + part.length, 0) || parts.length;
  let cursor = x;
  return parts.map(part => {
    const partWidth = width * (part.length / totalChars);
    const token = { text: part, x0: cursor, x1: cursor + partWidth, top, bottom: top + height, page: pageNumber };
    cursor += partWidth;
    return token;
  });
}

async function extractPdfWordsFromBuffer(buffer, options = {}) {
  const pdfjs = await loadPdfJs();
  const data = Buffer.isBuffer(buffer) ? Uint8Array.from(buffer) : (buffer instanceof Uint8Array ? Uint8Array.from(buffer) : new Uint8Array(buffer));
  const loadingTask = pdfjs.getDocument({
    data,
    disableWorker: true,
    useSystemFonts: true,
    standardFontDataUrl: options.standardFontDataUrl,
  });
  const document = await loadingTask.promise;
  const pages = [];
  let fullText = '';

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
    const words = [];
    const lines = [];
    for (const item of content.items || []) {
      const text = String(item.str || '').trim();
      if (text) lines.push(text);
      words.push(...splitTextItem(item, pageNumber, Number(viewport.height || 0)));
    }
    pages.push({ pageNumber, width: viewport.width, height: viewport.height, words });
    fullText += lines.join(' ') + '\n';
  }

  return { fullText: fullText.trim(), pages };
}

module.exports = { extractPdfWordsFromBuffer };
