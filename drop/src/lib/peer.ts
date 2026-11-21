/**
 * WebRTC plumbing: one RTCPeerConnection with one pre-negotiated data channel (id 0), so no
 * in-band channel setup is needed and both sides get the channel immediately.
 *
 * STUN servers only tell each device its public address; they never see the data. There is no
 * TURN relay on purpose (no servers), so networks that block direct connections can't connect.
 */
import { buildSdp, parseIpv6, parseSdp, signalToCode, SignalError, type Signal } from './signal';

export const ICE_SERVERS: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];

export interface Peer {
  pc: RTCPeerConnection;
  channel: RTCDataChannel;
}

export function createPeer(): Peer {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const channel = pc.createDataChannel('drop', { negotiated: true, id: 0, ordered: true });
  channel.binaryType = 'arraybuffer';
  return { pc, channel };
}

/**
 * Wait until we have addresses worth sending. Browsers often keep "gathering" for seconds
 * (e.g. an unreachable IPv6 STUN path), so don't wait for `complete`: once a public (srflx)
 * address is known, give it a moment for siblings, and cap the total wait.
 */
export function waitForCandidates(pc: RTCPeerConnection, { maxMs = 4000, afterPublicMs = 400 } = {}): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    let settle: ReturnType<typeof setTimeout> | undefined;
    let gotPublic = false;
    const finish = () => {
      clearTimeout(settle);
      clearTimeout(cap);
      pc.removeEventListener('icecandidate', onCandidate);
      pc.removeEventListener('icegatheringstatechange', onState);
      resolve();
    };
    const onCandidate = (e: RTCPeerConnectionIceEvent) => {
      if (!e.candidate) return finish();
      if (/ typ srflx /.test(e.candidate.candidate)) gotPublic = true;
      if (gotPublic) {
        clearTimeout(settle);
        settle = setTimeout(finish, afterPublicMs);
      }
    };
    const onState = () => pc.iceGatheringState === 'complete' && finish();
    const cap = setTimeout(finish, maxMs);
    pc.addEventListener('icecandidate', onCandidate);
    pc.addEventListener('icegatheringstatechange', onState);
  });
}

function localCode(pc: RTCPeerConnection, kind: Signal['kind']): string {
  const sdp = pc.localDescription?.sdp;
  if (!sdp) throw new SignalError('The browser didn’t produce a connection description.');
  const signal = parseSdp(sdp, kind);
  if (!signal.candidates.length) throw new SignalError('No network address found. Is this device connected to Wi-Fi or mobile data?');
  return signalToCode(signal);
}

/** Device A: create the offer code that goes into the QR link. */
export async function createOfferCode(pc: RTCPeerConnection): Promise<string> {
  await pc.setLocalDescription(await pc.createOffer());
  await waitForCandidates(pc);
  return localCode(pc, 'offer');
}

/** Device B: take A's offer, return the answer code to show back to A. */
export async function answerOffer(pc: RTCPeerConnection, offer: Signal): Promise<string> {
  if (offer.kind !== 'offer') throw new SignalError('This is a reply code. Scan it on the device that showed the first QR code.');
  await pc.setRemoteDescription({ type: 'offer', sdp: buildSdp(offer) });
  await pc.setLocalDescription(await pc.createAnswer());
  await waitForCandidates(pc);
  return localCode(pc, 'answer');
}

/** Device A: apply B's answer; the connection then starts by itself. */
export async function applyAnswer(pc: RTCPeerConnection, answer: Signal): Promise<void> {
  if (answer.kind !== 'answer') throw new SignalError('That’s a pairing QR code, not a reply. Scan the code shown on the other device after it opened the link.');
  if (pc.signalingState !== 'have-local-offer') throw new SignalError('This pairing was already used. Start again.');
  await pc.setRemoteDescription({ type: 'answer', sdp: buildSdp(answer) });
}

export interface RouteInfo {
  /** Plain-language description of the path, e.g. "Same Wi-Fi" or "Internet · IPv6". */
  label: string;
  local: string;
  remote: string;
}

/** Describe the connection path actually chosen, from the selected ICE candidate pair. */
export async function describeRoute(pc: RTCPeerConnection): Promise<RouteInfo | null> {
  const stats = await pc.getStats();
  let pairId: string | undefined;
  stats.forEach((s) => {
    if (s.type === 'transport' && s.selectedCandidatePairId) pairId = s.selectedCandidatePairId;
  });
  let pair: Record<string, unknown> | undefined;
  stats.forEach((s) => {
    if ((pairId && s.id === pairId) || (!pairId && s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded')) pair = s;
  });
  if (!pair) return null;
  const local = stats.get(pair.localCandidateId as string);
  const remote = stats.get(pair.remoteCandidateId as string);
  if (!local || !remote) return null;
  return { label: routeLabel(local, remote), local: describe(local), remote: describe(remote) };
}

type CandidateStat = { candidateType?: string; address?: string; ip?: string };
const addressOf = (c: CandidateStat) => c.address || c.ip || '';
const describe = (c: CandidateStat) => [c.candidateType, addressOf(c) || '(address hidden)'].join(' ');

/**
 * Chrome leaves `address` empty in stats for candidates it hides (mDNS host candidates, and
 * peer-reflexive ones learned from them), so an unknown address says nothing about the path.
 */
export function routeLabel(local: CandidateStat, remote: CandidateStat): string {
  const [la, ra] = [addressOf(local), addressOf(remote)];
  if (local.candidateType === 'relay' || remote.candidateType === 'relay') return 'Relayed';
  if (!ra) return 'Direct';
  if (sameNetwork(la, ra)) return 'Same network';
  return ra.includes(':') ? 'Internet · IPv6' : 'Internet · IPv4';
}

/**
 * Is the remote address on our local network? Private IPv4 (RFC 1918), mDNS names, IPv6
 * ULA/link-local, or a global IPv6 address in the same /64 as ours. Carrier-grade NAT space
 * (100.64/10, e.g. Jio) is not a local network.
 */
export function sameNetwork(local: string, remote: string): boolean {
  if (/\.local$/i.test(remote)) return true;
  const v4 = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(remote);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const r6 = parseIpv6(remote);
  if (!r6) return false;
  if ((r6[0] & 0xfe) === 0xfc || (r6[0] === 0xfe && (r6[1] & 0xc0) === 0x80)) return true;
  const l6 = parseIpv6(local);
  return !!l6 && r6.slice(0, 8).every((x, i) => x === l6[i]);
}

// ---------- failure diagnostics ----------

interface IceCandidateStat {
  id: string;
  type: string;
  candidateType?: string;
  address?: string;
  ip?: string;
  port?: number;
  protocol?: string;
}
interface IcePairStat {
  localCandidateId: string;
  remoteCandidateId: string;
  state?: string;
  requestsSent?: number;
  requestsReceived?: number;
  responsesReceived?: number;
}

export interface IceReport {
  /** One-line, plain-language guess at the cause. */
  hint: string;
  /** Candidates and pair results, for "Technical details". */
  text: string;
}

/**
 * Summarise why ICE didn't connect, from getStats(). The counters tell the story:
 * requestsReceived = the other device's checks reached us; responsesReceived = ours got answered.
 */
export function analyseIce(entries: Array<Record<string, unknown>>, remoteSdp = ''): IceReport {
  const cands = new Map<string, IceCandidateStat>();
  const pairs: IcePairStat[] = [];
  for (const s of entries) {
    if (s.type === 'local-candidate' || s.type === 'remote-candidate') cands.set(s.id as string, s as unknown as IceCandidateStat);
    if (s.type === 'candidate-pair') pairs.push(s as unknown as IcePairStat);
  }
  // Chrome drops a remote `.local` candidate from stats when it can't resolve the name, so take
  // the other device's addresses from its description (our reply/offer code) when stats lack them.
  if (![...cands.values()].some((c) => c.type === 'remote-candidate')) {
    let n = 0;
    for (const m of remoteSdp.matchAll(/^a=candidate:\S+ 1 udp \d+ (\S+) (\d+) typ (\S+)/gim)) {
      const mdns = /\.local$/i.test(m[1]);
      cands.set(`sdp${n++}`, { id: `sdp${n}`, type: 'remote-candidate', candidateType: m[3], address: mdns ? '' : m[1], port: Number(m[2]), protocol: 'udp' });
    }
  }
  const show = (c?: IceCandidateStat) => (c ? `${c.candidateType} ${c.address || c.ip || '(hidden .local name)'}${c.port ? `:${c.port}` : ''}` : '?');
  const lines: string[] = [];
  for (const [label, type] of [['This device', 'local-candidate'], ['Other device', 'remote-candidate']] as const) {
    const list = [...cands.values()].filter((c) => c.type === type && (c.protocol ?? 'udp') === 'udp');
    lines.push(`${label}: ${list.length ? list.map(show).join(', ') : 'no addresses'}`);
  }
  for (const p of pairs) {
    lines.push(
      `${show(cands.get(p.localCandidateId))} → ${show(cands.get(p.remoteCandidateId))}: ${p.state ?? '?'} (sent ${p.requestsSent ?? 0}, got ${p.requestsReceived ?? 0} from them, ${p.responsesReceived ?? 0} answered)`,
    );
  }
  const remotes = [...cands.values()].filter((c) => c.type === 'remote-candidate');
  const heardFromThem = pairs.some((p) => (p.requestsReceived ?? 0) > 0);
  const answered = pairs.some((p) => (p.responsesReceived ?? 0) > 0);
  const remoteHidden = remotes.length > 0 && remotes.every((c) => !(c.address || c.ip) || c.candidateType === 'srflx');
  const remoteOnlyMdns = remotes.length > 0 && remotes.every((c) => !(c.address || c.ip));
  let hint: string;
  if (!pairs.length && remoteOnlyMdns)
    hint = 'This device couldn’t look up the other device’s hidden Wi-Fi address (a .local name), and it sent no other address. On the phone, allow the camera when Drop asks (that reveals its real Wi-Fi address), then start again.';
  else if (!pairs.length && !remotes.length) hint = 'The other device sent no addresses. Check that it’s online, then start again.';
  else if (!pairs.length) hint = 'None of the other device’s addresses could be tried from here. Start again, or use the phone’s hotspot.';
  else if (!heardFromThem && remoteHidden)
    hint = 'Nothing arrived from the other device, and its Wi-Fi address was hidden. On the phone, allow the camera when Drop asks (it reveals the phone’s Wi-Fi address), then start again.';
  else if (!heardFromThem) hint = 'Nothing arrived from the other device. A firewall on this device, or the router keeping Wi-Fi devices apart (guest network / client isolation), is blocking it.';
  else if (!answered) hint = 'The other device’s attempts arrived, but none of ours were answered. A firewall on the other device or the router may be blocking them.';
  else hint = 'Some attempts got through but the connection didn’t complete. Try again, or use the phone’s hotspot.';
  return { hint, text: lines.join('\n') };
}

export async function iceReport(pc: RTCPeerConnection): Promise<IceReport> {
  const stats = await pc.getStats();
  const entries: Array<Record<string, unknown>> = [];
  stats.forEach((s) => entries.push(s as Record<string, unknown>));
  return analyseIce(entries, pc.remoteDescription?.sdp ?? '');
}
