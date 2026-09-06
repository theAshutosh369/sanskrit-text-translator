export function formatOutput(units) {
  const out = [];
  for (const u of units) {
    if (u.type === 'page') {
      out.push(u.source, '');
      continue;
    }
    if (u.type === 'blank') continue;
    out.push(u.source, u.translation ?? '', '');
  }
  return out.join('\n').replace(/\n{4,}/g, '\n\n\n').trimEnd() + '\n';
}
