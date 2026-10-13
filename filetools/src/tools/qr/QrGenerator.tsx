import * as QRCode from 'qrcode';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Segmented, ToolHeader } from '../../components/common';
import { errorMessage, Notice } from '../../components/Feedback';
import { downloadBlob } from '../../lib/download';
import {
  buildEmailPayload,
  buildPhonePayload,
  buildSmsPayload,
  buildVCard,
  buildWifiPayload,
  type ContactCard,
  type WifiEncryption,
} from '../../lib/qrPayload';

type Kind = 'text' | 'wifi' | 'vcard' | 'email' | 'phone' | 'sms';
type Ecc = 'L' | 'M' | 'Q' | 'H';

const KINDS: { value: Kind; label: string }[] = [
  { value: 'text', label: '🔗 Text / URL' },
  { value: 'wifi', label: '📶 Wi-Fi' },
  { value: 'vcard', label: '👤 Contact' },
  { value: 'email', label: '✉️ Email' },
  { value: 'phone', label: '📞 Phone' },
  { value: 'sms', label: '💬 SMS' },
];

const EMPTY_CARD: ContactCard = { firstName: '', lastName: '', organization: '', title: '', mobile: '', phone: '', email: '', website: '', street: '', city: '', region: '', postcode: '', country: '', note: '' };

export default function QrGenerator() {
  const [kind, setKind] = useState<Kind>('text');
  const [text, setText] = useState('https://');
  const [wifi, setWifi] = useState({ ssid: '', password: '', encryption: 'WPA' as WifiEncryption, hidden: false });
  const [card, setCard] = useState<ContactCard>(EMPTY_CARD);
  const [email, setEmail] = useState({ to: '', subject: '', body: '' });
  const [phone, setPhone] = useState('');
  const [sms, setSms] = useState({ number: '', message: '' });
  const [ecc, setEcc] = useState<Ecc>('M');
  const [size, setSize] = useState(512);
  const [margin, setMargin] = useState(4);
  const [fg, setFg] = useState('#000000');
  const [bg, setBg] = useState('#ffffff');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  const payload = useMemo((): { value: string | null; error?: string } => {
    try {
      switch (kind) {
        case 'text':
          return text.trim() && text.trim() !== 'https://' ? { value: text } : { value: null, error: 'Enter some text or a link.' };
        case 'wifi':
          return { value: buildWifiPayload(wifi) };
        case 'vcard':
          return { value: buildVCard(card) };
        case 'email':
          return { value: buildEmailPayload(email.to, email.subject, email.body) };
        case 'phone':
          return { value: buildPhonePayload(phone) };
        case 'sms':
          return { value: buildSmsPayload(sms.number, sms.message) };
      }
    } catch (e) {
      return { value: null, error: errorMessage(e) };
    }
  }, [kind, text, wifi, card, email, phone, sms]);

  const opts = useMemo(() => ({ errorCorrectionLevel: ecc, margin, width: size, color: { dark: fg, light: bg } }), [ecc, margin, size, fg, bg]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !payload.value) return;
    QRCode.toCanvas(canvas, payload.value, opts)
      .then(() => setRenderError(null))
      .catch((e: unknown) => setRenderError(/too big|amount of data/i.test(errorMessage(e)) ? 'Too much data for a QR code. Shorten the text or lower the error-correction level.' : errorMessage(e)));
  }, [payload.value, opts]);

  const lowContrast = (() => {
    const lum = (h: string) => {
      const n = parseInt(h.slice(1), 16);
      const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const a = lum(fg);
    const b = lum(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) < 3 || a > b;
  })();

  const downloadPng = () => canvasRef.current?.toBlob((b) => b && downloadBlob(b, 'qr-code.png'), 'image/png');
  const downloadSvg = async () => {
    if (!payload.value) return;
    const svg = await QRCode.toString(payload.value, { ...opts, type: 'svg' });
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), 'qr-code.svg');
  };

  const cardField = (key: keyof ContactCard, label: string, type = 'text') => (
    <label className="field">
      <span>{label}</span>
      <input className="input" type={type} value={card[key] ?? ''} onChange={(e) => setCard({ ...card, [key]: e.target.value })} />
    </label>
  );

  const ok = payload.value && !renderError;

  return (
    <>
      <ToolHeader emoji="🔳" title="QR code generator">
        Make a QR code for a link, text, Wi-Fi network, contact card, email, phone call or SMS. <Link to="/qr/scan">Scan a QR code instead →</Link>
      </ToolHeader>
      <div className="tool-layout">
        <div className="card stack">
          <Segmented label="QR content type" value={kind} onChange={setKind} options={KINDS} />
          {kind === 'text' && (
            <label className="field">
              <span>Text or URL</span>
              <textarea className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
            </label>
          )}
          {kind === 'wifi' && (
            <div className="stack">
              <div className="grid-2">
                <label className="field"><span>Network name (SSID)</span><input className="input" value={wifi.ssid} onChange={(e) => setWifi({ ...wifi, ssid: e.target.value })} autoComplete="off" /></label>
                <label className="field"><span>Password</span><input className="input" value={wifi.password} disabled={wifi.encryption === 'nopass'} onChange={(e) => setWifi({ ...wifi, password: e.target.value })} autoComplete="off" /></label>
              </div>
              <div className="row">
                <Segmented label="Security" value={wifi.encryption} onChange={(v) => setWifi({ ...wifi, encryption: v })} options={[{ value: 'WPA', label: 'WPA/WPA2/WPA3' }, { value: 'WEP', label: 'WEP' }, { value: 'nopass', label: 'None' }]} />
                <label className="check"><input type="checkbox" checked={wifi.hidden} onChange={(e) => setWifi({ ...wifi, hidden: e.target.checked })} /> Hidden network</label>
              </div>
              <p className="tiny muted">Anyone who scans this code gets the password. Phones join the network straight from the camera app.</p>
            </div>
          )}
          {kind === 'vcard' && (
            <div className="grid-2">
              {cardField('firstName', 'First name')}
              {cardField('lastName', 'Last name')}
              {cardField('organization', 'Organisation')}
              {cardField('title', 'Job title')}
              {cardField('mobile', 'Mobile', 'tel')}
              {cardField('phone', 'Work phone', 'tel')}
              {cardField('email', 'Email', 'email')}
              {cardField('website', 'Website', 'url')}
              {cardField('street', 'Street')}
              {cardField('city', 'City')}
              {cardField('region', 'State / region')}
              {cardField('postcode', 'Postcode')}
              {cardField('country', 'Country')}
              {cardField('note', 'Note')}
            </div>
          )}
          {kind === 'email' && (
            <div className="stack">
              <label className="field"><span>To</span><input className="input" type="email" value={email.to} onChange={(e) => setEmail({ ...email, to: e.target.value })} /></label>
              <label className="field"><span>Subject</span><input className="input" value={email.subject} onChange={(e) => setEmail({ ...email, subject: e.target.value })} /></label>
              <label className="field"><span>Message</span><textarea className="input" value={email.body} onChange={(e) => setEmail({ ...email, body: e.target.value })} /></label>
            </div>
          )}
          {kind === 'phone' && (
            <label className="field"><span>Phone number (with country code)</span><input className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" /></label>
          )}
          {kind === 'sms' && (
            <div className="stack">
              <label className="field"><span>Phone number</span><input className="input" type="tel" value={sms.number} onChange={(e) => setSms({ ...sms, number: e.target.value })} /></label>
              <label className="field"><span>Message</span><textarea className="input" value={sms.message} onChange={(e) => setSms({ ...sms, message: e.target.value })} /></label>
            </div>
          )}
          <details>
            <summary className="small muted" style={{ cursor: 'pointer' }}>Encoded text</summary>
            <pre className="result-box mono tiny">{payload.value ?? '—'}</pre>
          </details>
        </div>

        <aside className="card stack">
          <div className="qr-preview">
            {payload.value ? <canvas ref={canvasRef} aria-label="QR code preview" role="img" style={{ display: renderError ? 'none' : undefined }} /> : <span className="muted small">{payload.error}</span>}
            {payload.value && renderError && <span className="danger-text small">{renderError}</span>}
          </div>
          <div className="field">
            <span>Error correction</span>
            <Segmented label="Error correction level" value={ecc} onChange={setEcc} options={[{ value: 'L', label: 'L 7%' }, { value: 'M', label: 'M 15%' }, { value: 'Q', label: 'Q 25%' }, { value: 'H', label: 'H 30%' }]} />
            <span className="tiny muted">Higher = survives damage or a logo on top, but makes a denser code.</span>
          </div>
          <label className="field"><span>Size: {size}px</span><input type="range" min={128} max={2048} step={64} value={size} onChange={(e) => setSize(Number(e.target.value))} /></label>
          <label className="field"><span>Quiet zone (margin): {margin} modules</span><input type="range" min={0} max={10} value={margin} onChange={(e) => setMargin(Number(e.target.value))} /></label>
          <div className="row">
            <label className="field"><span>Foreground</span><input type="color" className="input" value={fg} onChange={(e) => setFg(e.target.value)} /></label>
            <label className="field"><span>Background</span><input type="color" className="input" value={bg} onChange={(e) => setBg(e.target.value)} /></label>
          </div>
          {lowContrast && <Notice kind="warn">Low contrast or light-on-dark colours — many scanners won’t read this code.</Notice>}
          {margin < 2 && <Notice kind="warn">A quiet zone under 2 modules makes codes hard to scan.</Notice>}
          <div className="row">
            <button type="button" className="btn primary" disabled={!ok} onClick={downloadPng}>⬇ PNG</button>
            <button type="button" className="btn" disabled={!ok} onClick={downloadSvg}>⬇ SVG</button>
          </div>
        </aside>
      </div>
    </>
  );
}
