/** Determinate progress bar (value 0..1) or indeterminate when value is null. */
export function ProgressBar({ value, label }: { value: number | null; label: string }) {
  const pct = value === null ? undefined : Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className={value === null ? 'progress indeterminate' : 'progress'} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div style={value === null ? undefined : { width: `${pct}%` }} />
    </div>
  );
}
