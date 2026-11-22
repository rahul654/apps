import { createStore } from './createStore';

export type Toast = { id: number; text: string; tone: 'info' | 'ok' | 'error' };

export const toasts = createStore<Toast[]>([]);
let next = 1;

export function toast(text: string, tone: Toast['tone'] = 'info', ms = 4000) {
  const id = next++;
  toasts.set((list) => [...list.slice(-2), { id, text, tone }]);
  setTimeout(() => dismissToast(id), ms);
}

export function dismissToast(id: number) {
  toasts.set((list) => list.filter((t) => t.id !== id));
}
