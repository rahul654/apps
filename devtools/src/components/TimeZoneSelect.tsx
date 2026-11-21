import { useMemo } from 'react';
import { usePref } from '../hooks/prefs';
import { allTimeZones, isValidTimeZone, localTimeZone } from '../lib/time';
import { Field } from './Controls';

export function TimeZoneSelect({ value, onChange, label = 'Time zone' }: { value: string; onChange: (tz: string) => void; label?: string }) {
  const zones = useMemo(allTimeZones, []);
  const local = localTimeZone();
  return (
    <Field label={label}>
      {(id) => (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z === local ? `${z} (local)` : z}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export function useTimeZonePref(key: string): [string, (tz: string) => void] {
  const [tz, setTz] = usePref<string>(key, '', (v) => typeof v === 'string');
  const effective = tz && isValidTimeZone(tz) ? tz : localTimeZone();
  return [effective, setTz];
}

