import { describe, expect, it } from 'vitest';
import type { Segment, Transcript } from '../types';
import { exportFileName, exportTranscript, toJson, toSrt, toTxt, toVtt } from './exporters';
import { parseTranscript } from './storage';

const segs: Segment[] = [
  { id: 'a', start: 0, end: 2.5, text: ' Hello there. ' },
  { id: 'b', start: 62.345, end: 65.1, text: 'General\n\nKenobi!' },
  { id: 'c', start: 70, end: 71, text: '   ' },
  { id: 'd', start: 3725.5, end: 3727.25, text: 'a -> b & <c>' },
];

describe('exports', () => {
  it('TXT: one line per segment, empty segments dropped, optional clock', () => {
    expect(toTxt(segs)).toBe('Hello there.\nGeneral Kenobi!\na -> b & <c>\n');
    expect(toTxt(segs, { timestamps: true })).toBe('[0:00] Hello there.\n[1:02] General Kenobi!\n[1:02:05] a -> b & <c>\n');
    expect(toTxt([])).toBe('');
  });

  it('SRT: numbered cues with comma milliseconds and blank-line separation', () => {
    expect(toSrt(segs)).toBe(
      '1\n00:00:00,000 --> 00:00:02,500\nHello there.\n\n' + '2\n00:01:02,345 --> 00:01:05,100\nGeneral Kenobi!\n\n' + '3\n01:02:05,500 --> 01:02:07,250\na -> b & <c>\n',
    );
  });

  it('VTT: header, dot milliseconds, escaped markup, no blank lines inside a cue', () => {
    const vtt = toVtt(segs);
    expect(vtt.startsWith('WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nHello there.\n')).toBe(true);
    expect(vtt).toContain('00:01:02.345 --> 00:01:05.100\nGeneral Kenobi!\n');
    expect(vtt).toContain('01:02:05.500 --> 01:02:07.250\na -&gt; b &amp; &lt;c&gt;\n');
    expect(toVtt([])).toBe('WEBVTT\n\n');
  });

  it('cues are sorted and never end before they start', () => {
    const srt = toSrt([
      { id: 'x', start: 5, end: 4, text: 'second' },
      { id: 'y', start: 1, end: 2, text: 'first' },
    ]);
    expect(srt).toBe('1\n00:00:01,000 --> 00:00:02,000\nfirst\n\n2\n00:00:05,000 --> 00:00:05,000\nsecond\n');
  });

  it('JSON round-trips through validation', () => {
    const t: Transcript = {
      version: 1,
      id: 't1',
      title: 'Talk',
      createdAt: 1,
      updatedAt: 2,
      duration: 3728,
      source: 'file',
      model: 'Xenova/whisper-tiny',
      backend: 'wasm',
      task: 'transcribe',
      language: 'en',
      timestamps: 'word',
      hasAudio: true,
      segmentCount: 1,
      wordCount: 2,
      segments: [{ id: 'a', start: 0.12345, end: 1.5, text: 'Hi you', words: [{ text: ' Hi', start: 0.12345, end: 0.5 }, { text: ' you', start: 0.6, end: 1.5 }] }],
    };
    const json = JSON.parse(toJson(t));
    expect(json.segments[0].start).toBe(0.123);
    expect(json.text).toBe('Hi you');
    const back = parseTranscript(json)!;
    expect(back.segments[0].words).toHaveLength(2);
    expect(back.language).toBe('en');
    expect(exportTranscript(t, 'txt')).toBe('Hi you\n');
  });

  it('file names', () => {
    expect(exportFileName('My talk: part 1/2.mp3', 'srt')).toBe('My-talk-part-1-2.srt');
    expect(exportFileName('नमस्ते दुनिया', 'vtt')).toBe('नमस्ते-दुनिया.vtt');
    expect(exportFileName('///', 'txt')).toBe('transcript.txt');
  });
});
