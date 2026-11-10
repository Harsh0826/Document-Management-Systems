/** ISO date `years` after `from` (or today), for one-click "valid for" dates. */
export function addYears(years: number, from?: string): string {
  const d = from ? new Date(`${from}T00:00:00`) : new Date();
  d.setFullYear(d.getFullYear() + years);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "fire_safety-licence 2025.pdf" → "Fire safety licence 2025" (matches the server's default name). */
export function nameFromFilename(filename: string): string {
  const base = filename
    .replace(/\.[^.]+$/, '')
    .replace(/_+/g, ' ')
    .replace(/(\S)-(?=\S)/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();
  return (base.charAt(0).toUpperCase() + base.slice(1)).slice(0, 200) || 'Untitled document';
}
