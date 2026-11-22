// The password gate's login service: the Google Apps Script web app URL (ends in /exec), made
// from gate/apps-script.gs (see "Password" in README.md). It never returns the password, so it's
// fine for it to be public. Empty means "not set up": every page stays locked and says so.
export const GATE_URL = 'https://script.google.com/macros/s/AKfycbxh6B55aLSxtlJ1YSuGmwyEse3u9BWcocakSthzvAaTOAaNeZCxAQcUK6eCzoHLyZDJ/exec';
