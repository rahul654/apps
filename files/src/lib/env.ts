import { FILES_URL } from '../config';

/** The Apps Script URL in use ('' = not set up). */
export const SCRIPT_URL: string = import.meta.env.VITE_FILES_URL || FILES_URL;
/** Base URL of the local mock's media routes, or '' for Google Drive. */
export const MEDIA_BASE: string = import.meta.env.VITE_FILES_MEDIA || '';
