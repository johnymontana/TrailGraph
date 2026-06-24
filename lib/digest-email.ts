import type { DigestItem } from './digest';

/**
 * Proactive Ranger digest email (ADR-052) — a plain, scannable morning rollup. Only sent to users who
 * explicitly opted in (default OFF), always with a one-click unsubscribe. Pure + unit-tested.
 */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

const TONE_MARK: Record<DigestItem['tone'], string> = { good: '✨', warn: '⚠️', info: 'ℹ️' };

export function digestEmailHtml(items: DigestItem[], forDate: string, unsubscribeUrl: string): string {
  const rows = items
    .map(
      (it) => `<tr><td style="padding:8px 0;border-bottom:1px solid #e5e9e6;">
        <strong>${TONE_MARK[it.tone]} ${esc(it.title)}</strong><br/>
        <span style="color:#5a6b62;font-size:14px;">${esc(it.detail)}</span></td></tr>`,
    )
    .join('');
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#1c2b24;max-width:560px;margin:0 auto;padding:24px;">
  <h1 style="font-size:18px;color:#2f5e3f;margin:0 0 4px;">Your TrailGraph ranger digest</h1>
  <p style="color:#5a6b62;font-size:13px;margin:0 0 16px;">${esc(forDate)} · ${items.length} update${items.length === 1 ? '' : 's'} on your watched trips &amp; parks</p>
  <table style="width:100%;border-collapse:collapse;">${rows}</table>
  <p style="color:#8a978f;font-size:12px;margin-top:20px;">TrailGraph is not an official safety source — confirm conditions with NPS.gov before you go.</p>
  <p style="color:#8a978f;font-size:12px;"><a href="${esc(unsubscribeUrl)}" style="color:#8a978f;">Unsubscribe from these emails</a></p>
</body></html>`;
}
