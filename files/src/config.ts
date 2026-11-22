// The files backend: the Google Apps Script web app URL (ends in /exec), deployed from
// apps-script/Code.gs (see "Files" in README.md). Fine to be public: the script never returns the
// password, and uploads/deletes need a login token. Empty means "not set up": the page says so.
export const FILES_URL = 'https://script.google.com/macros/s/AKfycby-syaXpUaSvG_MF8JjuvPJsByU1kH6gDSt5owdJ9VHIc4ObUDgdHj77XglyyI_AncmDA/exec';
