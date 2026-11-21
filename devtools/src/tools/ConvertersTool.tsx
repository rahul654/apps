import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CodeArea } from '../components/CodeArea';
import { Checkbox, Field, Notice, Segmented, Toolbar } from '../components/Controls';
import { CopyButton } from '../components/CopyButton';
import { ToolPage } from '../components/ToolPage';
import { ValueTable } from '../components/ValueTable';
import { useMemoryState } from '../hooks/memoryState';
import { oneOf, usePref } from '../hooks/prefs';
import { CASES, convertCase } from '../lib/caseConvert';
import { contrastRatio, parseColor, toHex, toHslString, toOklchString, toRgbString, wcagLevel, type RGBA } from '../lib/color';
import { decodeEntities, encodeEntities } from '../lib/htmlEntities';
import { bitLength, formatBigInt, groupDigits, parseBigInt, twosComplement } from '../lib/numberBase';

// ---------- Number base ----------

const BASES = [
  { base: 10, label: 'Decimal', group: 3 },
  { base: 16, label: 'Hexadecimal', group: 4 },
  { base: 2, label: 'Binary', group: 4 },
  { base: 8, label: 'Octal', group: 3 },
];

function NumberBase() {
  const [value, setValue] = useMemoryState<bigint | null>('conv:num', null);
  const [editing, setEditing] = useState<{ base: number; text: string; error?: string } | null>(null);
  const [custom, setCustom] = usePref<number>('conv.customBase', 36, (v) => typeof v === 'number' && v >= 2 && v <= 36);
  const [upper, setUpper] = usePref('conv.hexUpper', false, oneOf(true, false));

  const onEdit = (base: number, text: string) => {
    if (text.trim() === '') {
      setEditing({ base, text });
      setValue(null);
      return;
    }
    try {
      const n = parseBigInt(text, base);
      setValue(n);
      setEditing({ base, text });
    } catch (e) {
      setEditing({ base, text, error: e instanceof Error ? e.message : String(e) });
    }
  };
  const display = (base: number) => (editing?.base === base ? editing.text : value === null ? '' : formatBigInt(value, base, upper));
  const all = [...BASES, { base: custom, label: `Base ${custom}`, group: 4, custom: true }];

  return (
    <>
      <Toolbar>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => onEdit(10, '255')}>
          Sample
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => {
            setValue(null);
            setEditing(null);
          }}
        >
          Clear
        </button>
        <Checkbox label="Uppercase letters" checked={upper} onChange={setUpper} />
      </Toolbar>
      <div className="base-grid">
        {all.map((b, i) => (
          <Field
            key={i}
            label={b.label}
            hint={editing?.base === b.base && editing.error ? <span className="text-error">{editing.error}</span> : value !== null && editing?.base !== b.base ? groupDigits(formatBigInt(value, b.base, upper), b.group) : undefined}
          >
            {(id) => (
              <div className="input-with-btn">
                <input
                  id={id}
                  className="mono"
                  value={display(b.base)}
                  onChange={(e) => onEdit(b.base, e.target.value)}
                  onBlur={() => editing?.base === b.base && !editing.error && setEditing(null)}
                  spellCheck={false}
                  autoComplete="off"
                  inputMode={b.base === 10 ? 'numeric' : 'text'}
                  aria-invalid={editing?.base === b.base && !!editing.error}
                />
                <CopyButton text={value === null ? '' : formatBigInt(value, b.base, upper)} ariaLabel={`Copy ${b.label}`} />
              </div>
            )}
          </Field>
        ))}
        <Field label="Custom base (2–36)">
          {(id) => (
            <input
              id={id}
              type="number"
              min={2}
              max={36}
              value={custom}
              onChange={(e) => {
                const n = Math.round(Number(e.target.value));
                if (n >= 2 && n <= 36) setCustom(n);
              }}
            />
          )}
        </Field>
      </div>
      {value !== null && (
        <p className="muted small">
          {bitLength(value)} bits
          {value < 0n && [8, 16, 32, 64].some((w) => twosComplement(value, w)) && (
            <>
              {' '}
              · two's complement ({[8, 16, 32, 64].find((w) => twosComplement(value, w))}-bit): <code>{groupDigits(twosComplement(value, [8, 16, 32, 64].find((w) => twosComplement(value, w))!)!, 4)}</code>
            </>
          )}
        </p>
      )}
      <p className="muted small">Arbitrary precision (BigInt). Prefixes 0x / 0b / 0o and separators (_ or spaces) are accepted.</p>
    </>
  );
}

// ---------- Color ----------

function ContrastBadge({ fg, bg, label }: { fg: RGBA; bg: RGBA; label: string }) {
  const ratio = contrastRatio(fg, bg);
  const normal = wcagLevel(ratio);
  const large = wcagLevel(ratio, true);
  return (
    <div className="contrast" style={{ background: toHex({ ...bg, a: 1 }), color: toHex({ ...fg, a: 1 }) }}>
      <strong>Aa</strong>
      <span>
        {label}: {ratio.toFixed(2)}:1
      </span>
      <span className="contrast-levels">
        Normal {normal} · Large {large}
      </span>
    </div>
  );
}

function ColorConv() {
  const [input, setInput] = useMemoryState('conv:color', '#4f46e5');
  const parsed = useMemo(() => parseColor(input), [input]);
  const rgb = parsed?.rgb;
  const solid = rgb ? { ...rgb, a: 1 } : undefined;
  const white = { r: 255, g: 255, b: 255, a: 1 };
  const black = { r: 0, g: 0, b: 0, a: 1 };

  return (
    <>
      <div className="row">
        <Field label="Colour (HEX, rgb(), hsl(), oklch() or a basic name)" className="grow">
          {(id) => (
            <div className="input-with-btn">
              <input id={id} className="mono" value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} autoComplete="off" aria-invalid={input.trim() !== '' && !parsed} />
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setInput('oklch(62.8% 0.2 280)')}>
                Sample
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setInput('')} disabled={!input}>
                Clear
              </button>
            </div>
          )}
        </Field>
        <Field label="Picker">{(id) => <input id={id} type="color" className="color-picker" value={solid ? toHex(solid) : '#000000'} onChange={(e) => setInput(e.target.value)} />}</Field>
      </div>
      {input.trim() !== '' && !parsed && <Notice kind="error">Unrecognised colour. Try #4f46e5, rgb(79 70 229), hsl(243 75% 59%) or oklch(55% 0.24 277).</Notice>}
      {rgb && solid && (
        <div className="color-result">
          <div className="swatch-wrap" aria-hidden="true">
            <div className="swatch" style={{ background: toRgbString(rgb) }} />
          </div>
          <div className="grow">
            {!parsed.inGamut && <Notice kind="warn">This OKLCH colour is outside the sRGB gamut; values below are clipped to the nearest displayable colour.</Notice>}
            <ValueTable
              caption="Colour formats"
              rows={[
                { label: 'HEX', value: toHex(rgb) },
                { label: 'RGB', value: toRgbString(rgb) },
                { label: 'HSL', value: toHslString(rgb) },
                { label: 'OKLCH', value: toOklchString(rgb) },
              ]}
            />
            <div className="contrast-row">
              <ContrastBadge fg={white} bg={solid} label="White text" />
              <ContrastBadge fg={black} bg={solid} label="Black text" />
            </div>
            <p className="muted small">WCAG 2 contrast: AA needs 4.5:1 for normal text and 3:1 for large text; AAA needs 7:1 and 4.5:1. Alpha is ignored for contrast.</p>
          </div>
        </div>
      )}
    </>
  );
}

// ---------- Case ----------

function CaseConv() {
  const [input, setInput] = useMemoryState('conv:case', '');
  return (
    <>
      <CodeArea label="Input (each line converted separately)" value={input} onChange={setInput} onSample={() => setInput('user profile id\nXMLHttpRequest\nget-api_response')} onClear={() => setInput('')} rows={4} />
      <ValueTable caption="Case styles" rows={CASES.map((c) => ({ label: c.label, value: input ? convertCase(input, c.id) : '' }))} />
    </>
  );
}

// ---------- HTML entities ----------

function decodeWithBrowser(entity: string): string | null {
  // A <textarea> parses its content as RCDATA: entities decode, but no markup or script is created.
  const ta = document.createElement('textarea');
  ta.innerHTML = entity;
  return ta.value === entity ? null : ta.value;
}

function HtmlConv() {
  const [dir, setDir] = usePref<'encode' | 'decode'>('conv.htmlDir', 'encode', oneOf('encode', 'decode'));
  const [nonAscii, setNonAscii] = usePref('conv.htmlNonAscii', false, oneOf(true, false));
  const [input, setInput] = useMemoryState('conv:html', '');
  const output = useMemo(() => (dir === 'encode' ? encodeEntities(input, nonAscii) : decodeEntities(input, decodeWithBrowser)), [input, dir, nonAscii]);
  return (
    <>
      <Toolbar>
        <Segmented
          label="Direction"
          value={dir}
          onChange={setDir}
          options={[
            { value: 'encode', label: 'Encode' },
            { value: 'decode', label: 'Decode' },
          ]}
        />
        {dir === 'encode' && <Checkbox label="Also encode non-ASCII characters" checked={nonAscii} onChange={setNonAscii} />}
        <button
          type="button"
          className="btn"
          disabled={!output}
          onClick={() => {
            setInput(output);
            setDir(dir === 'encode' ? 'decode' : 'encode');
          }}
        >
          ⇄ Use output as input
        </button>
      </Toolbar>
      <div className="panes">
        <CodeArea
          label={dir === 'encode' ? 'Text / HTML' : 'Encoded'}
          value={input}
          onChange={setInput}
          onSample={() => setInput(dir === 'encode' ? '<p class="note">Fish & chips — "£5" café</p>' : '&lt;p&gt;Fish &amp; chips &mdash; &quot;&pound;5&quot; caf&eacute; &#x1F41F;&lt;/p&gt;')}
          onClear={() => setInput('')}
          rows={8}
        />
        <CodeArea label={dir === 'encode' ? 'Encoded' : 'Decoded'} value={output} rows={8} />
      </div>
    </>
  );
}

const SUBS = [
  { path: '', label: 'Number base', el: <NumberBase /> },
  { path: 'color', label: 'Color', el: <ColorConv /> },
  { path: 'case', label: 'Case', el: <CaseConv /> },
  { path: 'html', label: 'HTML entities', el: <HtmlConv /> },
];

export default function ConvertersTool() {
  const sub = useParams()['*'] ?? '';
  const current = SUBS.find((s) => s.path === sub) ?? SUBS[0];
  return (
    <ToolPage title="Converters" icon="⇄" description="Number bases, colours, identifier case styles and HTML entities." tabs={SUBS.map((s) => ({ to: s.path ? `/converters/${s.path}` : '/converters', label: s.label }))}>
      <div key={current.path}>{current.el}</div>
    </ToolPage>
  );
}
