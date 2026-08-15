import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import {
  parseMoniepointExtractedLines,
  pushCanonicalLine,
  type ParsedMoniepointReport,
} from "@/lib/moniepoint-report-core";

export * from "@/lib/moniepoint-report-core";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfTextItemLike {
  str: string;
  hasEOL?: boolean;
}

function isTextItem(item: unknown): item is PdfTextItemLike {
  return Boolean(item && typeof item === "object" && "str" in item);
}

async function extractRawLines(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await getDocument({ data: bytes }).promise;
  const lines: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    let current: string[] = [];

    const flush = () => {
      pushCanonicalLine(lines, current.join(" "));
      current = [];
    };

    for (const rawItem of content.items) {
      if (!isTextItem(rawItem)) continue;
      const parts = rawItem.str.split(/\r?\n/);
      parts.forEach((part, index) => {
        if (part.trim()) current.push(part);
        if (index < parts.length - 1) flush();
      });
      if (rawItem.hasEOL) flush();
    }
    flush();
    lines.push(`__PAGE_BREAK_${pageNumber}__`);
  }

  return { lines, pageCount: pdf.numPages };
}

export async function parseMoniepointReport(file: File): Promise<ParsedMoniepointReport> {
  if (file.type && file.type !== "application/pdf") {
    throw new Error("Please choose a PDF report.");
  }
  if (file.size > 15 * 1024 * 1024) {
    throw new Error("The report is larger than the 15 MB import limit.");
  }

  const { lines, pageCount } = await extractRawLines(file);
  return parseMoniepointExtractedLines(lines, pageCount);
}

export async function sha256File(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
