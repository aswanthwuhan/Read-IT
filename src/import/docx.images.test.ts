import { afterEach, describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import mammoth from 'mammoth';
import { parseDocx } from './docx';

const IGNORED_IMAGE_DATA_URI =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const ALT_TEXT = 'A useful "diagram" & <schema>';

interface ObservableImage {
  contentType: string;
  altText?: string;
  read: (encoding?: string) => Promise<unknown>;
  readAsArrayBuffer: () => Promise<ArrayBuffer>;
  readAsBase64String: () => Promise<string>;
  readAsBuffer: () => Promise<unknown>;
}

type ImageConverter = (image: ObservableImage, messages: unknown[]) => unknown;
type MammothImageConverter = NonNullable<Parameters<typeof mammoth.convertToHtml>[1]>['convertImage'];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseDocx images', () => {
  it('imports escaped alt text as a figure without reading image bytes', async () => {
    const { doc, html, images, readImageBytes } = await parseObservedDocx(ALT_TEXT);

    // Reaching the converter proves the synthetic drawing was recognized; the
    // read spies cover both the legacy read() API and the newer readAs* methods.
    expect(images).toHaveLength(1);
    expect(images[0]?.altText).toBe(ALT_TEXT);
    expect(readImageBytes).not.toHaveBeenCalled();

    const imageDocument = new DOMParser().parseFromString(html, 'text/html');
    const figure = imageDocument.querySelector('figure');
    expect(figure).not.toBeNull();
    expect(figure?.querySelector('figcaption')).toBeNull();
    expect(figure?.querySelector('img')?.getAttribute('src')).toBe(IGNORED_IMAGE_DATA_URI);
    expect(figure?.querySelector('img')?.getAttribute('alt')).toBe(ALT_TEXT);
    expect(html).toContain('&quot;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&lt;');

    expect(doc.format).toBe('docx');
    expect(doc.chapters).toHaveLength(1);
    expect(doc.chapters[0]?.title).toBe('Image chapter');
    const blocks = doc.chapters[0]?.blocks ?? [];
    expect(blocks.map((block) => block.kind)).toEqual(expect.arrayContaining(['p', 'figure', 'table']));
    const figureBlock = blocks.find((block) => block.kind === 'figure');
    expect(figureBlock?.sentences.map((sentence) => sentence.text)).toEqual([ALT_TEXT]);

    const paragraphs = blocks
      .filter((block) => block.kind === 'p')
      .flatMap((block) => block.sentences.map((sentence) => sentence.text));
    expect(paragraphs).toEqual(expect.arrayContaining(['Text before image.', 'Text after image.']));
    const text = blocks.flatMap((block) => block.sentences.map((sentence) => sentence.text)).join(' ');
    expect(text).toContain('Left cell, Right cell');
    expect(text).not.toContain('data:');
  });

  it('does not emit a figure for empty alt text', async () => {
    const { doc, html, images, readImageBytes } = await parseObservedDocx('');

    expect(images).toHaveLength(1);
    expect(images[0]?.altText).toBeFalsy();
    expect(readImageBytes).not.toHaveBeenCalled();
    expect(html).toContain(`src="${IGNORED_IMAGE_DATA_URI}"`);
    expect(html).not.toContain('<figure');

    const blocks = doc.chapters[0]?.blocks ?? [];
    expect(blocks.some((block) => block.kind === 'figure')).toBe(false);
    const text = blocks.flatMap((block) => block.sentences.map((sentence) => sentence.text)).join(' ');
    expect(text).toContain('Text before image.');
    expect(text).toContain('Text after image.');
    expect(text).toContain('Left cell, Right cell');
  });
});

async function parseObservedDocx(description: string) {
  const actualConvertToHtml = mammoth.convertToHtml;
  const readImageBytes = vi.fn((): never => {
    throw new Error('DOCX image bytes must not be read');
  });
  const images: ObservableImage[] = [];
  let html = '';

  vi.spyOn(mammoth, 'convertToHtml').mockImplementation(async (input, options) => {
    const convertImage = options?.convertImage as unknown as ImageConverter | undefined;
    expect(convertImage).toBeTypeOf('function');
    if (!convertImage) throw new Error('Mammoth image converter is missing');

    const result = await actualConvertToHtml(input, {
      ...options,
      convertImage: ((image: ObservableImage, messages: unknown[]) => {
        images.push(image);
        image.read = readImageBytes;
        image.readAsArrayBuffer = readImageBytes;
        image.readAsBase64String = readImageBytes;
        image.readAsBuffer = readImageBytes;
        return convertImage(image, messages);
      }) as unknown as MammothImageConverter,
    });
    html = result.value;
    return result;
  });

  const doc = await parseDocx(docxWithImage(description), 'Fallback title');
  return { doc, html, images, readImageBytes };
}

function docxWithImage(description: string): ArrayBuffer {
  const files = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>Image chapter</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>Text before image.</w:t></w:r>
      <w:r>
        <w:drawing>
          <wp:inline>
            <wp:extent cx="914400" cy="914400"/>
            <wp:docPr id="1" name="Diagram" descr="${escapeXmlAttribute(description)}"/>
            <a:graphic>
              <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                <pic:pic>
                  <pic:nvPicPr>
                    <pic:cNvPr id="0" name="image.png"/>
                    <pic:cNvPicPr/>
                  </pic:nvPicPr>
                  <pic:blipFill>
                    <a:blip r:embed="rId2"/>
                    <a:stretch><a:fillRect/></a:stretch>
                  </pic:blipFill>
                  <pic:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
                </pic:pic>
              </a:graphicData>
            </a:graphic>
          </wp:inline>
        </w:drawing>
      </w:r>
      <w:r><w:t>Text after image.</w:t></w:r>
    </w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Left cell</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Right cell</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
    <w:sectPr/>
  </w:body>
</w:document>`),
    'word/_rels/document.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image.png"/>
</Relationships>`),
    'word/styles.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
  </w:style>
</w:styles>`),
    'word/media/image.png': Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  };
  const bytes = zipSync(files);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
