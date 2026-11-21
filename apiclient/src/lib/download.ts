/** Trigger a browser download for a Blob, then release the object URL. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function downloadText(text: string, name: string, type = 'application/json'): void {
  downloadBlob(new Blob([text], { type }), name);
}

export function downloadBytes(bytes: Uint8Array, name: string, type: string): void {
  downloadBlob(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }), name);
}
