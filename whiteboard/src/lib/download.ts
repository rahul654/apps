/** Saves a Blob as a file via a temporary <a download>. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function downloadText(text: string, fileName: string, type = 'application/json'): void {
  downloadBlob(new Blob([text], { type }), fileName);
}
