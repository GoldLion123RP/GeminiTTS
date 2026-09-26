import { describe, expect, test } from 'bun:test';
import { ExtractionError, extensionOf, extractText, isSupportedFile } from './text';

const file = (name: string, body: string | Uint8Array, type = '') =>
  new File([body as BlobPart], name, { type });

describe('extensionOf', () => {
  test('lower-cases and ignores the directory portion', () => {
    expect(extensionOf('notes.MD')).toBe('md');
    expect(extensionOf('archive.tar.gz')).toBe('gz');
    expect(extensionOf('README')).toBe('');
  });
});

describe('extractText — plain formats', () => {
  test('reads a .txt file', async () => {
    const text = await extractText(file('a.txt', 'First line.\nSecond line.'));
    expect(text).toBe('First line.\nSecond line.');
  });

  test('reads a .md file and keeps its Markdown intact', async () => {
    const source = '# Title\n\n- one\n- two\n';
    expect(await extractText(file('a.md', source))).toBe(source.trim());
  });

  test('normalises CRLF, trailing spaces, and runs of blank lines', async () => {
    const messy = 'One.   \r\n\r\n\r\n\r\nTwo.\r\n';
    expect(await extractText(file('a.txt', messy))).toBe('One.\n\nTwo.');
  });

  test('strips soft hyphens and zero-width characters', async () => {
    const dirty = `da${'­'}nger${''}ous`;
    expect(await extractText(file('a.txt', dirty))).toBe('dangerous');
  });
});

describe('extractText — rejections', () => {
  test('rejects an unsupported extension with a message naming the supported set', async () => {
    const error = await extractText(file('clip.mp4', 'binary')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExtractionError);
    expect((error as ExtractionError).message).toContain('.txt, .md, .pdf, or .docx');
    expect((error as ExtractionError).fileName).toBe('clip.mp4');
  });

  test('rejects an unsupported MIME type even with no extension', async () => {
    const error = await extractText(file('blob', 'x', 'image/png')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExtractionError);
  });

  test('a .pdf that is not a PDF reports a readable failure, not a crash', async () => {
    const error = await extractText(file('scan.pdf', 'not really a pdf', 'application/pdf')).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ExtractionError);
    expect((error as ExtractionError).message).toContain('PDF could not be read');
  });

  test('a .docx that is not a docx reports a readable failure, not a crash', async () => {
    const error = await extractText(file('fake.docx', 'not really a docx')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExtractionError);
    expect((error as ExtractionError).message).toContain('.docx file could not be read');
  });
});

describe('isSupportedFile', () => {
  test('accepts the four documented formats', () => {
    for (const name of ['a.txt', 'a.md', 'a.pdf', 'a.docx']) {
      expect(isSupportedFile(file(name, 'x'))).toBe(true);
    }
  });

  test('rejects anything else', () => {
    expect(isSupportedFile(file('a.mp3', 'x'))).toBe(false);
    expect(isSupportedFile(file('a', 'x'))).toBe(false);
  });

  test('accepts a recognised MIME type even when the name is unhelpful', () => {
    expect(isSupportedFile(file('download', 'x', 'application/pdf'))).toBe(true);
  });
});
