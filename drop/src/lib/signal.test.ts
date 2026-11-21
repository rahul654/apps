import { describe, expect, it } from 'vitest';
import { buildSdp, codeToSignal, decodeSignal, encodeSignal, joinLink, parseIpv6, parseSdp, signalToCode, SignalError, type Signal } from './signal';

// Real Chrome 147 output (data channel only), captured with STUN enabled.
const CHROME_OFFER = [
  'v=0',
  'o=- 1339435091920970231 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=application 27979 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 103.139.220.219',
  'a=candidate:2023136285 1 udp 2113937151 c4ce22b1-4429-4fe6-b6c9-9b709ca485a4.local 34011 typ host generation 0 network-cost 999',
  'a=candidate:1982755680 1 udp 1677729535 103.139.220.219 27979 typ srflx raddr 0.0.0.0 rport 0 generation 0 network-cost 999',
  'a=ice-ufrag:7pm0',
  'a=ice-pwd:yOqpiqkTJ7ydNBHwMbLu8jSJ',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 EE:08:D2:68:FA:D5:D9:66:B7:BC:BF:29:24:58:46:D0:D2:5F:06:71:E6:E8:73:7E:0F:D3:54:1F:AA:0A:CC:E6',
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
  '',
].join('\r\n');

const CHROME_ANSWER = [
  'v=0',
  'o=- 2590665876084293268 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:524554479 1 udp 2113937151 c4ce22b1-4429-4fe6-b6c9-9b709ca485a4.local 41608 typ host generation 0 network-cost 999',
  'a=ice-ufrag:MQaS',
  'a=ice-pwd:oSx6inQMoeoH93e89A35u5wf',
  'a=fingerprint:sha-256 13:93:A3:2E:6B:90:30:87:31:AE:3E:B7:40:15:01:AF:41:89:A6:1C:23:90:43:1A:A3:B4:6D:00:2B:39:5E:B9',
  'a=setup:active',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
  '',
].join('\r\n');

// Firefox style: uppercase UDP, raw IPs, IPv6, TCP candidates, link-local, end-of-candidates.
const FIREFOX_OFFER = [
  'v=0',
  'o=mozilla...THIS_IS_SDPARTA-99.0 6187013813938163521 0 IN IP4 0.0.0.0',
  's=-',
  't=0 0',
  'a=fingerprint:sha-256 5B:91:2F:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC',
  'a=group:BUNDLE 0',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:0 1 UDP 2122252543 192.168.1.5 50123 typ host',
  'a=candidate:1 1 UDP 2122187007 2001:db8:b::5 50124 typ host',
  'a=candidate:2 1 UDP 2122121471 fe80::1c2b:3cff:fe4d:5e6f 50125 typ host',
  'a=candidate:3 1 TCP 2105524479 192.168.1.5 9 typ host tcptype active',
  'a=candidate:4 1 UDP 1685987327 203.0.113.20 61200 typ srflx raddr 192.168.1.5 rport 50123',
  'a=candidate:5 2 UDP 1685987326 203.0.113.20 61201 typ srflx raddr 192.168.1.5 rport 50126',
  'a=end-of-candidates',
  'a=ice-pwd:0123456789abcdef0123456789abcdef',
  'a=ice-ufrag:89abcdef',
  'a=mid:0',
  'a=setup:actpass',
  'a=sctp-port:5000',
  'a=max-message-size:1073741823',
  '',
].join('\r\n');

describe('parseSdp', () => {
  it('reads a Chrome offer', () => {
    const s = parseSdp(CHROME_OFFER, 'offer');
    expect(s).toMatchObject({ kind: 'offer', setup: 'actpass', ufrag: '7pm0', pwd: 'yOqpiqkTJ7ydNBHwMbLu8jSJ', maxMessageSize: 262144 });
    expect(s.fingerprint[0]).toBe(0xee);
    expect(s.fingerprint[31]).toBe(0xe6);
    expect(s.candidates).toEqual([
      { address: 'c4ce22b1-4429-4fe6-b6c9-9b709ca485a4.local', port: 34011, type: 'host' },
      { address: '103.139.220.219', port: 27979, type: 'srflx' },
    ]);
  });

  it('keeps only usable UDP component-1 candidates (Firefox style)', () => {
    const s = parseSdp(FIREFOX_OFFER, 'offer');
    expect(s.ufrag).toBe('89abcdef');
    expect(s.candidates).toEqual([
      { address: '192.168.1.5', port: 50123, type: 'host' },
      { address: '2001:db8:b::5', port: 50124, type: 'host' },
      { address: '203.0.113.20', port: 61200, type: 'srflx' },
    ]);
  });

  it('rejects a non-SHA-256 fingerprint with a readable message', () => {
    expect(() => parseSdp(CHROME_ANSWER.replace('sha-256', 'sha-1'), 'answer')).toThrow(SignalError);
  });
});

describe('encode / decode', () => {
  const roundTrip = (s: Signal) => decodeSignal(encodeSignal(s));

  it('round-trips a Chrome offer and answer', () => {
    for (const [sdp, kind] of [[CHROME_OFFER, 'offer'], [CHROME_ANSWER, 'answer']] as const) {
      const s = parseSdp(sdp, kind);
      expect(roundTrip(s)).toEqual(s);
    }
  });

  it('round-trips IPv6 (as a full address of the same value)', () => {
    const s = parseSdp(FIREFOX_OFFER, 'offer');
    const back = roundTrip(s);
    expect(back.candidates[1].address).toBe('2001:db8:b:0:0:0:0:5');
    expect(parseIpv6(back.candidates[1].address)).toEqual(parseIpv6('2001:db8:b::5'));
    expect(back.maxMessageSize).toBe(1073741823);
  });

  it('keeps codes short enough for a fast QR scan', () => {
    const offer = signalToCode(parseSdp(CHROME_OFFER, 'offer'));
    const answer = signalToCode(parseSdp(CHROME_ANSWER, 'answer'));
    expect(offer.length).toBeLessThan(140);
    expect(answer.length).toBeLessThan(130);
    const link = joinLink('https://example.github.io/apps/drop/#/start', offer);
    expect(link).toBe(`https://example.github.io/apps/drop/#/j/${offer}`);
    expect(link.length).toBeLessThan(200);
  });

  it('rejects truncated, padded, foreign and garbage codes with SignalError', () => {
    const code = signalToCode(parseSdp(CHROME_OFFER, 'offer'));
    expect(() => codeToSignal(code.slice(0, 40))).toThrow(SignalError);
    expect(() => codeToSignal(code + 'AAAA')).toThrow(SignalError);
    expect(() => codeToSignal('hello world!')).toThrow(SignalError);
    expect(() => codeToSignal('')).toThrow(SignalError);
    const bytes = encodeSignal(parseSdp(CHROME_OFFER, 'offer'));
    bytes[0] = (2 << 4) | (bytes[0] & 0x0f);
    expect(() => decodeSignal(bytes)).toThrow(/different version/);
  });

  it('accepts a whole join link and whitespace from copy-paste', () => {
    const s = parseSdp(CHROME_OFFER, 'offer');
    const code = signalToCode(s);
    expect(codeToSignal(`  https://x.github.io/apps/drop/#/j/${code.slice(0, 50)}\n${code.slice(50)} `)).toEqual(s);
  });
});

describe('buildSdp', () => {
  it('rebuilds an SDP that parses back to the same signal', () => {
    for (const [sdp, kind] of [[CHROME_OFFER, 'offer'], [CHROME_ANSWER, 'answer'], [FIREFOX_OFFER, 'offer']] as const) {
      const s = parseSdp(sdp, kind);
      const rebuilt = buildSdp(decodeSignal(encodeSignal(s)));
      expect(rebuilt).toMatch(/\r\n$/);
      expect(rebuilt).toContain('m=application 9 UDP/DTLS/SCTP webrtc-datachannel');
      const again = parseSdp(rebuilt, kind);
      expect(again).toEqual({ ...s, candidates: s.candidates.map((c) => ({ ...c, address: again.candidates.find((a) => a.port === c.port)!.address })) });
    }
  });

  it('orders priorities host > srflx and keeps the original order within a type', () => {
    const rebuilt = buildSdp(parseSdp(FIREFOX_OFFER, 'offer'));
    const prios = [...rebuilt.matchAll(/a=candidate:\d+ 1 udp (\d+) (\S+) \d+ typ (\w+)/g)].map((m) => ({ p: Number(m[1]), addr: m[2], type: m[3] }));
    expect(prios.map((x) => x.type)).toEqual(['host', 'host', 'srflx']);
    expect(prios[0].p).toBeGreaterThan(prios[1].p);
    expect(prios[1].p).toBeGreaterThan(prios[2].p);
    expect(prios.every((x) => x.p < 2 ** 32)).toBe(true);
  });
});

describe('parseIpv6', () => {
  it('parses compressed, full and v4-mapped forms', () => {
    expect([...parseIpv6('::1')!]).toEqual([...Array(15).fill(0), 1]);
    expect(parseIpv6('2001:db8::1')).toEqual(parseIpv6('2001:0db8:0:0:0:0:0:1'));
    expect([...parseIpv6('::ffff:192.0.2.1')!.slice(12)]).toEqual([192, 0, 2, 1]);
    expect(parseIpv6('1:2:3')).toBeNull();
    expect(parseIpv6('1::2::3')).toBeNull();
    expect(parseIpv6('192.168.1.1')).toBeNull();
  });
});

describe('sameNetwork', async () => {
  const { sameNetwork } = await import('./peer');
  it('recognises local networks and not carrier NAT or other IPv6 prefixes', () => {
    expect(sameNetwork('192.168.1.5', '192.168.1.9')).toBe(true);
    expect(sameNetwork('10.0.0.2', '10.0.0.3')).toBe(true);
    expect(sameNetwork('192.168.1.5', 'c4ce22b1-4429-4fe6-b6c9-9b709ca485a4.local')).toBe(true);
    expect(sameNetwork('192.168.1.5', '100.72.4.9')).toBe(false);
    expect(sameNetwork('192.168.1.5', '49.36.12.8')).toBe(false);
    expect(sameNetwork('2001:db8:b::5', '2001:db8:b:0:aa::1')).toBe(true);
    expect(sameNetwork('2001:db8:b::5', '2001:db8:a::77')).toBe(false);
    expect(sameNetwork('192.168.1.5', 'fd12:3456::1')).toBe(true);
  });
});

describe('routeLabel', async () => {
  const { routeLabel } = await import('./peer');
  it('names the path, and says only "Direct" when Chrome hides the address', () => {
    expect(routeLabel({ candidateType: 'host', address: '' }, { candidateType: 'host', address: '' })).toBe('Direct');
    expect(routeLabel({ candidateType: 'host', address: '192.168.1.5' }, { candidateType: 'prflx', address: '192.168.1.9' })).toBe('Same network');
    expect(routeLabel({ candidateType: 'srflx', address: '203.0.113.20' }, { candidateType: 'srflx', address: '198.51.100.3' })).toBe('Internet · IPv4');
    expect(routeLabel({ candidateType: 'host', address: '2001:db8:b::5' }, { candidateType: 'host', address: '2001:db8:a::77' })).toBe('Internet · IPv6');
    expect(routeLabel({ candidateType: 'relay', address: '1.2.3.4' }, { candidateType: 'host', address: '' })).toBe('Relayed');
  });
});

describe('analyseIce', async () => {
  const { analyseIce } = await import('./peer');
  const local = { id: 'L', type: 'local-candidate', candidateType: 'host', address: '192.168.0.106', port: 5000, protocol: 'udp' };
  const hidden = { id: 'R', type: 'remote-candidate', candidateType: 'host', address: '', port: 6000, protocol: 'udp' };
  const raw = { ...hidden, address: '192.168.0.42' };
  const pair = (extra: object) => ({ type: 'candidate-pair', localCandidateId: 'L', remoteCandidateId: 'R', state: 'failed', requestsSent: 9, ...extra });

  it('blames the hidden phone address when nothing arrived from it', () => {
    const r = analyseIce([local, hidden, pair({ requestsReceived: 0, responsesReceived: 0 })]);
    expect(r.hint).toMatch(/allow the camera/);
    expect(r.text).toContain('Other device: host (hidden .local name):6000');
    expect(r.text).toContain('sent 9, got 0 from them, 0 answered');
  });

  it('blames a firewall or client isolation when the address was known', () => {
    expect(analyseIce([local, raw, pair({ requestsReceived: 0, responsesReceived: 0 })]).hint).toMatch(/firewall on this device/);
  });

  it('blames the other side when its checks arrive but ours are not answered', () => {
    expect(analyseIce([local, raw, pair({ requestsReceived: 4, responsesReceived: 0 })]).hint).toMatch(/firewall on the other device/);
  });
});

describe('analyseIce without remote stats', async () => {
  const { analyseIce } = await import('./peer');
  it('reads the other device’s addresses from its SDP and names the unresolvable .local name', () => {
    const local = { id: 'L', type: 'local-candidate', candidateType: 'host', address: '192.168.0.106', port: 5000, protocol: 'udp' };
    const sdp = 'v=0\r\na=candidate:1 1 udp 2113937151 c4ce22b1-4429-4fe6-b6c9-9b709ca485a4.local 41608 typ host\r\n';
    const r = analyseIce([local], sdp);
    expect(r.text).toContain('Other device: host (hidden .local name):41608');
    expect(r.hint).toMatch(/couldn’t look up the other device’s hidden Wi-Fi address/);
    expect(analyseIce([local], 'v=0\r\n').hint).toMatch(/sent no addresses/);
  });
});
