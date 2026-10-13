/** Third-party licence notices (bundled fonts, OCR engine and language data). */
export interface LicenceLink {
  label: string;
  url: string;
  licence: string;
}

const base = () => (typeof document !== 'undefined' ? document.baseURI : './');

export function ocrLicenceLinks(): LicenceLink[] {
  const dir = `./${__OCR_ASSET_DIR__}`;
  return [
    { label: 'tesseract.js', url: new URL(`${dir}/LICENSE-tesseract.js.txt`, base()).href, licence: 'Apache-2.0' },
    { label: 'tesseract.js-core (Tesseract OCR engine)', url: new URL(`${dir}/LICENSE-tesseract.js-core.txt`, base()).href, licence: 'Apache-2.0' },
    { label: 'tessdata_fast / tessdata_best language data', url: new URL('./ocr/tessdata_fast/LICENSE.txt', base()).href, licence: 'Apache-2.0' },
    { label: 'GlyphLessFont (from Tesseract, for invisible OCR text)', url: 'https://github.com/tesseract-ocr/tesseract/blob/main/LICENSE', licence: 'Apache-2.0' },
  ];
}

export function LicenceList({ title, links }: { title: string; links: LicenceLink[] }) {
  return (
    <details className="tiny muted">
      <summary>{title}</summary>
      <ul>
        {links.map((l) => (
          <li key={l.label}>
            <a href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a> — {l.licence}
          </li>
        ))}
      </ul>
    </details>
  );
}
