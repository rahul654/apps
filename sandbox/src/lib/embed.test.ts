import { describe, expect, it } from 'vitest';
import { embedAdvice, parseStartTime } from './embed';

const advise = (url: string, protocol = 'https:') => embedAdvice(url, protocol);

describe('embedAdvice', () => {
  it('flags sites known to block framing, including subdomains', () => {
    expect(advise('https://github.com/rahul654').blocked).toBe(true);
    expect(advise('https://mail.google.com/').blocked).toBe(true);
    expect(advise('https://www.reddit.com/r/all').blocked).toBe(true);
  });

  it('does not flag look-alike or unrelated domains', () => {
    expect(advise('https://notgithub.com/').blocked).toBe(false);
    expect(advise('https://en.wikipedia.org/wiki/X').blocked).toBe(false);
    expect(advise('https://example.com/').blocked).toBe(false);
  });

  it('does not flag embed / preview / published URLs', () => {
    expect(advise('https://www.google.com/maps/embed?pb=xyz').blocked).toBe(false);
    expect(advise('https://docs.google.com/document/d/abc/pub').blocked).toBe(false);
    expect(advise('https://docs.google.com/presentation/d/abc/preview').blocked).toBe(false);
    expect(advise('https://www.youtube.com/embed/aqz-KE-bpKQ').blocked).toBe(false);
  });

  it('suggests the YouTube embed player for watch, short and share links', () => {
    const embed = 'https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ';
    expect(advise('https://www.youtube.com/watch?v=aqz-KE-bpKQ').suggestion?.url).toBe(embed);
    expect(advise('https://m.youtube.com/watch?v=aqz-KE-bpKQ&t=90').suggestion?.url).toBe(`${embed}?start=90`);
    expect(advise('https://youtu.be/aqz-KE-bpKQ?t=1m5s').suggestion?.url).toBe(`${embed}?start=65`);
    expect(advise('https://www.youtube.com/shorts/aqz-KE-bpKQ').suggestion?.url).toBe(embed);
    expect(advise('https://www.youtube.com/').suggestion).toBeUndefined();
  });

  it('suggests the Vimeo player', () => {
    expect(advise('https://vimeo.com/76979871').suggestion?.url).toBe('https://player.vimeo.com/video/76979871');
    expect(advise('https://vimeo.com/channels/staffpicks').suggestion).toBeUndefined();
  });

  it('detects mixed content, except for local hosts', () => {
    expect(advise('http://example.com/').mixedContent).toBe(true);
    expect(advise('http://example.com/', 'http:').mixedContent).toBe(false);
    expect(advise('http://localhost:3000/').mixedContent).toBe(false);
    expect(advise('http://127.0.0.1/').mixedContent).toBe(false);
    expect(advise('https://example.com/').mixedContent).toBe(false);
  });

  it('tolerates invalid URLs', () => {
    expect(advise('not a url')).toEqual({ blocked: false, mixedContent: false });
  });
});

describe('parseStartTime', () => {
  it('parses seconds and h/m/s forms', () => {
    expect(parseStartTime(null)).toBe(0);
    expect(parseStartTime('42')).toBe(42);
    expect(parseStartTime('42s')).toBe(42);
    expect(parseStartTime('2m')).toBe(120);
    expect(parseStartTime('1h2m3s')).toBe(3723);
    expect(parseStartTime('abc')).toBe(0);
    expect(parseStartTime('')).toBe(0);
  });
});
