import mammoth from 'mammoth';
import { extractText as extractPdfText } from 'unpdf';

export class ExtractionError extends Error {
  readonly fileName: string;

  constructor(message: string, fileName: string, options: { cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'ExtractionError';
    this.fileName = fileName;
  }
}

export const SUPPORTED_EXTENSIONS = ['.txt', '.md', '.pdf', '.docx'] as const;

export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

/** Chat and Office uploads often arrive with a generic or missing MIME type. */
const EXTENSION_MIME: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const PLAIN_EXTENSIONS: ReadonlySet<string> = new Set(['txt', 'md']);

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase();
}

export function isSupportedFile(file: File): boolean {
  return PLAIN_EXTENSIONS.has(extensionOf(file.name)) || isBinaryKind(file);
}

function isBinaryKind(file: File): boolean {
  const ext = extensionOf(file.name);
  if (ext === 'pdf' || ext === 'docx') return true;
  const mime = file.type.toLowerCase();
  return Object.values(EXTENSION_MIME).some((known) => mime === known);
}

/**
 * Extracts plain text from `.txt`, `.md`, `.pdf`, and `.docx`.
 *
 * The `.pdf` and `.docx` parsers are heavy and stay on the server: this module is
 * only ever imported from a route handler, never from a client script, so neither
 * library can reach the browser bundle.
 */
export async function extractText(file: File): Promise<string> {
  const ext = extensionOf(file.name);

  if (PLAIN_EXTENSIONS.has(ext)) return normalise(await file.text());
  if (ext === 'pdf' || file.type.toLowerCase() === EXTENSION_MIME.pdf) return readPdf(file);
  if (ext === 'docx' || file.type.toLowerCase() === EXTENSION_MIME.docx) return readDocx(file);

  throw new ExtractionError(
    `Unsupported file type "${ext ? `.${ext}` : file.type || 'unknown'}". Upload a .txt, .md, .pdf, or .docx file.`,
    file.name,
  );
}

async function readPdf(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const { text } = await extractPdfText(bytes, { mergePages: true });
    return normalise(text);
  } catch (cause) {
    throw new ExtractionError(
      'This PDF could not be read. It may be a scanned image rather than a text document.',
      file.name,
      { cause },
    );
  }
}

async function readDocx(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    const { value } = await mammoth.extractRawText({ buffer });
    return normalise(value);
  } catch (cause) {
    throw new ExtractionError('This .docx file could not be read. It may be corrupt or password-protected.', file.name, {
      cause,
    });
  }
}

const SOFT_HYPHEN = /\u00ad/g;
const ZERO_WIDTH = /[\u200b\u200c\u200d\ufeff]/g;

/** Extractors emit soft hyphens, zero-width joiners, and ragged newlines. */
function normalise(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(SOFT_HYPHEN, '')
    .replace(ZERO_WIDTH, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
