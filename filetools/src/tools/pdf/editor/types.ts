import type { EmbeddableImage } from '../../../lib/pdf/ops';
import { DEFAULT_LINE_HEIGHT, DEFAULT_MARKS, type Align, type RunMarks } from '../../../lib/text/model';

export type Tool = 'select' | 'text' | 'whiteout' | 'cover' | 'redact' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'pen' | 'highlight';

export const DRAW_TOOLS: Tool[] = ['whiteout', 'cover', 'redact', 'rect', 'ellipse', 'line', 'arrow', 'pen', 'highlight'];

export interface ToolStyle {
  /** Marks for new text boxes. */
  textMarks: RunMarks;
  align: Align;
  lineHeight: number;
  stroke: string;
  strokeWidth: number;
  fill: string | null;
  opacity: number;
  highlight: string;
  highlightWidth: number;
}

export const DEFAULT_STYLE: ToolStyle = {
  textMarks: DEFAULT_MARKS,
  align: 'start',
  lineHeight: DEFAULT_LINE_HEIGHT,
  stroke: '#e11d48',
  strokeWidth: 2,
  fill: null,
  opacity: 1,
  highlight: '#ffe14d',
  highlightWidth: 14,
};

export interface ImageAsset {
  image: EmbeddableImage;
  url: string;
}

export interface PageInfo {
  /** Displayed size in points. */
  width: number;
  height: number;
}

export type { ResizeHandle as Handle } from '../../../lib/pdf/editorModel';
