export function isValidHttpUrl(value: string, maxLength = 2048): boolean {
  if (value.length === 0 || value.length > maxLength) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
