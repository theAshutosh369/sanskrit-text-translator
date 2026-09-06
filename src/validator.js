import { extractVerseNumber } from './parser.js';

export function validateOutput(sourceUnits, translatedUnits) {
  const errors = [];
  const sourcePages = sourceUnits.filter(u => u.type === 'page').map(u => u.source);
  const outputPages = translatedUnits.filter(u => u.type === 'page').map(u => u.source);
  if (JSON.stringify(sourcePages) !== JSON.stringify(outputPages)) {
    errors.push('Page markers are missing, changed, or out of order.');
  }

  const sourceWork = sourceUnits.filter(u => !['page', 'blank'].includes(u.type));
  const outputWork = translatedUnits.filter(u => !['page', 'blank'].includes(u.type));
  if (sourceWork.length !== outputWork.length) {
    errors.push(`Unit count changed: source ${sourceWork.length}, output ${outputWork.length}.`);
  }

  const n = Math.min(sourceWork.length, outputWork.length);
  for (let i = 0; i < n; i++) {
    const s = sourceWork[i];
    const o = outputWork[i];
    if (s.source !== o.translatedSource) {
      errors.push(`Sanskrit source changed at unit ${i + 1}.`);
      if (errors.length >= 20) break;
    }
    if (!o.translation?.trim()) {
      errors.push(`Missing English translation at unit ${i + 1}.`);
      if (errors.length >= 20) break;
    }
    if (s.type === 'verse') {
      const a = extractVerseNumber(s.source);
      const b = extractVerseNumber(o.translation);
      if (a !== b) errors.push(`Verse number mismatch at unit ${i + 1}: ${a} → ${b || '(missing)'}.`);
    }
  }

  return {ok: errors.length === 0, errors};
}
