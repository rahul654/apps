import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

export interface ToolDef {
  id: string;
  /** Route path (hash routing): #/<path> */
  path: string;
  title: string;
  description: string;
  emoji: string;
  group: 'Images' | 'PDF' | 'QR codes';
  badge?: string;
  /** Use the full-width layout (no centered max-width container). */
  wide?: boolean;
  component: LazyExoticComponent<ComponentType>;
}

// Every tool is code-split, so the home page stays light: pdf.js / pdf-lib / qrcode
// only load when you open a tool that needs them.
export const TOOLS: ToolDef[] = [
  {
    id: 'image',
    path: '/image',
    title: 'Compress & convert images',
    description: 'Batch compress, resize, rotate and convert JPEG, PNG, WebP, GIF, BMP, AVIF.',
    emoji: '🖼️',
    group: 'Images',
    component: lazy(() => import('./image/ImageTool')),
  },
  {
    id: 'ocr',
    path: '/ocr',
    title: 'Image to text (OCR)',
    description: 'Recognise text in photos, scans and screenshots — English, Hindi and 20 more languages.',
    emoji: '🔍',
    group: 'Images',
    badge: 'New',
    component: lazy(() => import('./ocr/OcrTool')),
  },
  {
    id: 'pdf-edit',
    path: '/pdf/edit',
    title: 'Edit PDF',
    description: 'Rich text in any language, images, signatures, shapes and highlights; fill forms; cover or securely redact.',
    emoji: '✍️',
    group: 'PDF',
    badge: 'New',
    wide: true,
    component: lazy(() => import('./pdf/editor/EditorTool')),
  },
  {
    id: 'pdf-merge',
    path: '/pdf/merge',
    title: 'Merge PDFs',
    description: 'Combine PDFs and images into one PDF. Drag to reorder.',
    emoji: '📚',
    group: 'PDF',
    component: lazy(() => import('./pdf/MergeTool')),
  },
  {
    id: 'pdf-organize',
    path: '/pdf/organize',
    title: 'Organize & split PDF',
    description: 'Reorder, rotate, delete, duplicate or insert pages; extract or split into files.',
    emoji: '🗂️',
    group: 'PDF',
    component: lazy(() => import('./pdf/OrganizeTool')),
  },
  {
    id: 'pdf-images',
    path: '/pdf/images',
    title: 'Images ⇄ PDF',
    description: 'Turn photos into a PDF, or export PDF pages as PNG/JPEG images.',
    emoji: '🔁',
    group: 'PDF',
    component: lazy(() => import('./pdf/ImagesPdfTool')),
  },
  {
    id: 'pdf-ocr',
    path: '/pdf/ocr',
    title: 'Make PDF searchable (OCR)',
    description: 'Add an invisible, selectable text layer to scanned PDFs — pages stay exactly as they are.',
    emoji: '🔎',
    group: 'PDF',
    badge: 'New',
    component: lazy(() => import('./pdf/PdfOcrTool')),
  },
  {
    id: 'pdf-stamp',
    path: '/pdf/stamp',
    title: 'Page numbers & watermark',
    description: 'Stamp page numbers or a text watermark with your choice of position, opacity and angle.',
    emoji: '🔢',
    group: 'PDF',
    component: lazy(() => import('./pdf/StampTool')),
  },
  {
    id: 'pdf-metadata',
    path: '/pdf/metadata',
    title: 'PDF metadata',
    description: 'View and edit title, author, subject and keywords — or strip them all.',
    emoji: '🏷️',
    group: 'PDF',
    component: lazy(() => import('./pdf/MetadataTool')),
  },
  {
    id: 'qr',
    path: '/qr',
    title: 'QR code generator',
    description: 'Links, text, Wi-Fi, contacts, email, phone and SMS. Download PNG or SVG.',
    emoji: '🔳',
    group: 'QR codes',
    component: lazy(() => import('./qr/QrGenerator')),
  },
  {
    id: 'qr-scan',
    path: '/qr/scan',
    title: 'QR code scanner',
    description: 'Scan with your camera or from an image or screenshot.',
    emoji: '📷',
    group: 'QR codes',
    component: lazy(() => import('./qr/QrScanner')),
  },
];

export const TOOL_GROUPS: ToolDef['group'][] = ['PDF', 'Images', 'QR codes'];
