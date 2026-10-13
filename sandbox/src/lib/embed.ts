import { isLocalHost } from './url';

export interface EmbedAdvice {
  /** The site is known to refuse being framed (X-Frame-Options / CSP frame-ancestors). */
  blocked: boolean;
  /** An embeddable URL for the same content, when one exists. */
  suggestion?: { url: string; label: string };
  /** An http:// page inside this https:// app: the browser blocks it as mixed content. */
  mixedContent: boolean;
}

/**
 * Sites that send X-Frame-Options or `frame-ancestors` on their normal pages. Not exhaustive:
 * any site can do this, and a static page can't read those headers before loading.
 */
const BLOCKING_DOMAINS = [
  'google.com',
  'youtube.com',
  'github.com',
  'gitlab.com',
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'linkedin.com',
  'reddit.com',
  'stackoverflow.com',
  'amazon.com',
  'netflix.com',
  'paypal.com',
  'whatsapp.com',
  'chatgpt.com',
  'claude.ai',
];

function matchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** "90", "90s", "1m30s", "1h2m3s" → seconds. */
export function parseStartTime(t: string | null): number {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  if (!m || !m[0]) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

const VIDEO_ID = /^[\w-]{6,}$/;

function youtubeEmbed(url: URL): string | null {
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else {
      const m = /^\/(shorts|live)\/([^/]+)/.exec(url.pathname);
      if (m) id = m[2];
    }
  }
  if (!id || !VIDEO_ID.test(id)) return null;
  const start = parseStartTime(url.searchParams.get('t') ?? url.searchParams.get('start'));
  return `https://www.youtube-nocookie.com/embed/${id}${start ? `?start=${start}` : ''}`;
}

function vimeoEmbed(url: URL): string | null {
  if (url.hostname.replace(/^www\./, '') !== 'vimeo.com') return null;
  const m = /^\/(\d+)(?:\/|$)/.exec(url.pathname);
  return m ? `https://player.vimeo.com/video/${m[1]}` : null;
}

export function embedAdvice(href: string, pageProtocol: string): EmbedAdvice {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { blocked: false, mixedContent: false };
  }
  const host = url.hostname.toLowerCase();
  const mixedContent = pageProtocol === 'https:' && url.protocol === 'http:' && !isLocalHost(host);

  const yt = youtubeEmbed(url);
  if (yt) return { blocked: true, mixedContent, suggestion: { url: yt, label: 'Open the embeddable YouTube player' } };
  const vimeo = vimeoEmbed(url);
  if (vimeo) return { blocked: true, mixedContent, suggestion: { url: vimeo, label: 'Open the embeddable Vimeo player' } };

  // Embed/preview/publish URLs (Maps embeds, published Docs, YouTube /embed/…) are meant to be framed.
  const embedPath = /\/(embed|preview|pub|pubhtml)(\/|$)/.test(url.pathname);
  const blocked = !embedPath && BLOCKING_DOMAINS.some((d) => matchesDomain(host, d));
  return { blocked, mixedContent };
}
