/** Files picked for form-data / binary bodies. Kept in memory only: Postman stores just the file name. */
const files = new Map<string, File>();

export const fileKey = (itemId: string, slot: string) => `${itemId}\u0000${slot}`;
export const getFile = (itemId: string, slot: string): File | undefined => files.get(fileKey(itemId, slot));
export const setFile = (itemId: string, slot: string, file: File | null): void => {
  if (file) files.set(fileKey(itemId, slot), file);
  else files.delete(fileKey(itemId, slot));
};
