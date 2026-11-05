export type ParsedDocument = { pages: { page: number; text: string }[] };

const MAX_BYTES = 5_000_000;
const MAX_CHARS = 300_000;

export async function parseDocument(file: File): Promise<ParsedDocument> {
  if (file.size > MAX_BYTES) throw new Error("This file is larger than 5 MB. Choose a smaller document.");
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!["pdf", "txt", "md"].includes(extension || "")) {
    throw new Error("Choose a PDF, Markdown (.md), or text (.txt) file.");
  }
  if (extension !== "pdf") {
    const text = (await file.text()).replace(/\r\n?/g, "\n").replace(/\0/g, "").trim();
    if (!text) throw new Error("This document has no readable text.");
    if (text.length > MAX_CHARS) throw new Error("This document has too much text. The limit is 300,000 characters per file.");
    return { pages: [{ page: 1, text }] };
  }

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const pdf = await loadingTask.promise;
    if (pdf.numPages > 100) throw new Error("This PDF has more than 100 pages. Upload a shorter document.");
    const pages: ParsedDocument["pages"] = [];
    let totalCharacters = 0;
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index);
      const content = await page.getTextContent();
      let text = "";
      let previousY: number | null = null;
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const y = item.transform[5];
        if (previousY !== null && Math.abs(previousY - y) > 3 && text && !text.endsWith("\n")) text += "\n";
        text += item.str;
        text += item.hasEOL ? "\n" : " ";
        previousY = y;
      }
      text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/\0/g, "").trim();
      totalCharacters += text.length;
      if (totalCharacters > MAX_CHARS) throw new Error("This PDF has too much text. The limit is 300,000 characters per file.");
      pages.push({ page: index, text });
      page.cleanup();
    }
    if (totalCharacters < 20) throw new Error("No readable text was found. Scanned PDFs need OCR first; OCR is not available in this starter.");
    return { pages };
  } catch (error) {
    if (error instanceof Error && /password/i.test(error.message)) throw new Error("This PDF is password protected. Upload an unlocked copy.");
    if (error instanceof Error && /more than|too much|No readable|OCR/.test(error.message)) throw error;
    throw new Error("We couldn’t read this PDF. Try an unlocked PDF with selectable text, or export it as a text file.");
  } finally {
    await loadingTask.destroy();
  }
}
