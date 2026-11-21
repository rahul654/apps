/** A friendly name for this device, sent to the other side ("Android phone · Chrome"). */
export function deviceName(ua = navigator.userAgent, maxTouchPoints = navigator.maxTouchPoints ?? 0): string {
  let device = 'Computer';
  if (/iPhone/.test(ua)) device = 'iPhone';
  else if (/iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)) device = 'iPad';
  else if (/Android/.test(ua)) device = /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  else if (/Macintosh|Mac OS X/.test(ua)) device = 'Mac';
  else if (/Windows/.test(ua)) device = 'Windows PC';
  else if (/CrOS/.test(ua)) device = 'Chromebook';
  else if (/Linux/.test(ua)) device = 'Linux PC';
  let browser = '';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/SamsungBrowser/.test(ua)) browser = 'Samsung Internet';
  else if (/Firefox\/|FxiOS/.test(ua)) browser = 'Firefox';
  else if (/Chrome\/|CriOS/.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  return browser ? `${device} · ${browser}` : device;
}

/** Phones and tablets: prefer the rear camera and the share sheet. */
export function isMobile(ua = navigator.userAgent): boolean {
  return /Android|iPhone|iPad|Mobile/.test(ua);
}
