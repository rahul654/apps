/** Grabs a JPEG thumbnail from a video Blob (about 10% in, max 1 s). Null on failure. */
export async function videoThumbnail(blob: Blob, width = 320, timeoutMs = 8000): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  const once = (ev: string) => new Promise<void>((resolve, reject) => {
    const ok = () => { cleanup(); resolve(); };
    const bad = () => { cleanup(); reject(new Error(video.error?.message || 'video error')); };
    const cleanup = () => { video.removeEventListener(ev, ok); video.removeEventListener('error', bad); };
    video.addEventListener(ev, ok);
    video.addEventListener('error', bad);
  });
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('thumbnail timed out')), timeoutMs));
  try {
    await Promise.race([once('loadeddata'), timeout]);
    const d = Number.isFinite(video.duration) ? video.duration : 0;
    const t = Math.min(1, d * 0.1);
    if (t > 0.05) {
      video.currentTime = t;
      await Promise.race([once('seeked'), timeout]);
    }
    if (!video.videoWidth) return null;
    const h = Math.round((video.videoHeight / video.videoWidth) * width);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = Math.max(1, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.8));
  } catch {
    return null;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
