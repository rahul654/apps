import { describe, expect, it } from 'vitest';
import { mediaErrorInfo } from './errors';

const e = (name: string, message = '') => Object.assign(new Error(message), { name });

describe('mediaErrorInfo', () => {
  it('permission denied, per device', () => {
    expect(mediaErrorInfo(e('NotAllowedError'), 'camera')).toMatchObject({ title: 'Camera access was blocked', canRetry: true });
    expect(mediaErrorInfo(e('NotAllowedError'), 'screen').title).toBe('Screen sharing was cancelled');
  });
  it('missing devices', () => {
    expect(mediaErrorInfo(e('NotFoundError'), 'microphone').title).toBe('No microphone found');
  });
  it('device in use', () => {
    const info = mediaErrorInfo(e('NotReadableError'), 'camera');
    expect(info.title).toBe('Camera is in use or unavailable');
    expect(info.message).toMatch(/Another app/);
  });
  it('other errors', () => {
    expect(mediaErrorInfo(e('OverconstrainedError'), 'camera').title).toMatch(/isn’t available/);
    expect(mediaErrorInfo(e('SecurityError'), 'screen').canRetry).toBe(false);
    expect(mediaErrorInfo(new Error('weird'), 'screen')).toMatchObject({ title: 'Something went wrong', message: 'weird' });
    expect(mediaErrorInfo('str', 'camera').message).toBe('str');
  });
});
