import { ID } from 'node-appwrite';
import { COL, DB, nowIso } from './context.js';
import { summarise } from './vision.js';

/**
 * Shapes one `ai_inspections` row.
 *
 * Pure so the field limits and the mapping from a vision result can be tested
 * without a database. Every value is clamped to what the schema allows,
 * because a single oversize string would fail the write.
 */
export function buildInspection({ userId, refType, refId, fileId, meta, verdict, ai }) {
  const cut = (v, n) => String(v ?? '').slice(0, n);
  const int = (v) => (Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);

  return {
    userId: cut(userId, 64),
    refType: cut(refType, 32),
    refId: cut(refId, 64),
    fileId: cut(fileId, 64),
    provider: cut(meta?.provider, 32),
    model: cut(meta?.model, 96),
    latencyMs: int(meta?.latencyMs),
    attempts: int(meta?.attempts),
    status: cut(meta?.status, 16),
    error: cut(meta?.error, 256),
    action: cut(ai?.action, 16),
    confidence: Math.min(1, Math.max(0, Number(ai?.confidence) || 0)),
    verdict: cut(summarise(verdict), 1024),
    createdAt: nowIso(),
  };
}

/**
 * Writes the row. Never throws.
 *
 * This is telemetry. A failure here must not cost a user the submission they
 * are in the middle of, so errors are logged and swallowed.
 */
export async function recordInspection(databases, input, log = console.error) {
  try {
    await databases.createDocument(
      DB,
      COL.aiInspections,
      ID.unique(),
      buildInspection(input),
    );
  } catch (e) {
    log(`inspection log failed: ${e?.message}`);
  }
}
