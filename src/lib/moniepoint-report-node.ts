import { createHash } from "node:crypto";

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import {
  parseMoniepointExtractedLines,
  pushCanonicalLine,
  type ParsedMoniepointReport,
} from "@/lib/moniepoint-report-core";

interface PdfTextItemLike {
  str: string;
  hasEOL?: boolean;
}

function isTextItem(item: unknown): item is PdfTextItemLike {
  return Boolean(item && typeof item === "object" && "str" in item);
}

export async function parseMoniepointReportBytes(
  bytes: Uint8Array,
): Promise<ParsedMoniepointReport> {
  if (bytes.byteLength > 15 * 1024 * 1024) {
    throw new Error("The report is larger than the 15 MB import limit.");
  }
  if (bytes.byteLength < 5 || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
    throw new Error("The retrieved file is not a PDF report.");
  }

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

  return parseMoniepointExtractedLines(lines, pdf.numPages);
}

export function sha256Bytes(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
