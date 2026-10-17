/** Small, pure formatting helpers. Tested in format.test.ts. */

export function formatDate(iso: string | undefined | null, now: Date = new Date()): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';

  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "3 min ago", "2 days ago". Future times read as "just now". */
export function timeAgo(iso: string | undefined | null, now: Date = new Date()): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';

  const s = Math.max(0, Math.round((now.getTime() - then) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return formatDate(iso, now);
}

/** 0.923 -> "92%". Anything that is not a finite number reads as a dash. */
export function percent(value: number | undefined | null, digits = 0): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

/** A share, guarding against an empty denominator. */
export function share(part: number, whole: number, digits = 0): string {
  return whole > 0 ? percent(part / whole, digits) : '—';
}

export function ms(value: number | undefined | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '—';
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
}

/** "pending_review" -> "Pending review". */
export function humanise(code: string | undefined | null): string {
  const s = String(code ?? '').replace(/_/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : '—';
}

export function shortId(id: string | undefined | null, n = 8): string {
  const s = String(id ?? '');
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function compactNumber(n: number | undefined | null): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN');
}

/**
 * Grams as the most readable unit: "820 g", "4.5 kg", "37 kg", "1.2 t".
 * Whole numbers once a figure is past ten, because a decimal on an estimate
 * this rough suggests precision it does not have.
 */
export function formatMass(grams: number | undefined | null): string {
  if (typeof grams !== 'number' || !Number.isFinite(grams) || grams < 0) return '—';
  if (grams < 1000) return `${Math.round(grams)} g`;
  const kg = grams / 1000;
  if (kg < 1000) {
    const text = kg >= 10 ? String(Math.round(kg)) : kg.toFixed(1).replace(/\.0$/, '');
    return `${text} kg`;
  }
  const t = kg / 1000;
  const text = t >= 10 ? String(Math.round(t)) : t.toFixed(1).replace(/\.0$/, '');
  return `${text} t`;
}

export function mapsUrl(lat: number | undefined, lng: number | undefined): string | null {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
}

/**
 * The server stores what the AI said as "conf=0.90 plant=true real=true
 * species=Neem (Azadirachta indica) match=true concerns=a; b". Accurate, but
 * not something a reviewer should have to decode. Values can contain spaces, so
 * a token runs until the next `key=`.
 */
export function explainVerdict(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const out: string[] = [];

  for (const m of raw.matchAll(/(\w+)=(.*?)(?=\s\w+=|$)/g)) {
    const key = m[1];
    const value = m[2].trim();
    switch (key) {
      case 'plant':
        out.push(value === 'true' ? 'A plant is visible' : value === 'false' ? 'No plant visible' : 'Plant: unclear');
        break;
      case 'real':
        out.push(value === 'true' ? 'Looks like a real photo' : value === 'false' ? 'Not a real photo (screen, print or graphic)' : 'Photo: unclear');
        break;
      case 'species':
        out.push(`Looks like: ${value}`);
        break;
      case 'match':
        out.push(value === 'true' ? 'Matches the species chosen' : value === 'false' ? 'Does not match the species chosen' : 'Species match: unclear');
        break;
      case 'concerns':
        if (value) out.push(`Concerns: ${value}`);
        break;
      default:
        break; // conf is shown separately, as a percentage
    }
  }
  return out;
}

const REASON_TEXT: Record<string, string> = {
  ai_low_confidence: 'The AI was not confident about the photo',
  ai_not_a_plant: 'The AI could not find a real plant',
  ai_species_mismatch: 'The plant does not look like the species chosen',
  ai_screen_photo: 'The AI thinks this is a photo of a screen or print',
  ai_unavailable: 'The AI check was unavailable',
};

/**
 * The server stores why a submission was held as space-joined codes
 * ("ai_species_mismatch ai_low_confidence") or, for older rows, a sentence.
 * Codes become readable text; anything else is shown as it was written.
 */
export function explainReasons(raw: string | undefined | null): string[] {
  const text = (raw ?? '').trim();
  if (!text) return [];
  const tokens = text.split(/\s+/);
  if (tokens.every((t) => /^[a-z]+(_[a-z]+)+$/.test(t))) {
    return tokens.map((t) => REASON_TEXT[t] ?? humanise(t));
  }
  return [text];
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

const GROUP_LABELS: Record<string, string> = {
  electricity: 'Electricity',
  cooking: 'Cooking gas',
  transport: 'Road and rail',
  air: 'Flying',
};

/** The largest footprint group's name with its share, e.g. "Flying · 48%". */
export function biggest(groups: Record<string, number>): string {
  const total = Object.values(groups).reduce((s, v) => s + v, 0);
  if (total <= 0) return '—';
  const [key, value] = Object.entries(groups).sort((a, b) => b[1] - a[1])[0];
  return `${GROUP_LABELS[key] ?? key} · ${Math.round((value / total) * 100)}%`;
}
