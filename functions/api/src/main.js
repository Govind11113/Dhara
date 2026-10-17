import { Rejected, loadConfig, requireUser, services } from './lib/context.js';
import { bootstrap } from './routes/profile.js';
import { plant, verify } from './routes/tree.js';
import { claim, issue, lookup, mint } from './routes/transfer.js';
import { redeem, submitElectricity } from './routes/redeem.js';
import { refreshLeaderboard, sync } from './routes/badges.js';
import { submit as submitFeedback } from './routes/feedback.js';
import { ADMIN_ROUTES } from './routes/admin.js';
import * as footprint from './routes/footprint.js';
import { isAdminPath, requireAdmin } from './lib/admin.js';

/**
 * Single entry point for every privileged operation in Dhara.
 *
 * The client holds no API key. It calls this function with a short-lived JWT,
 * and every rule that decides whether credits are minted lives on this side of
 * the boundary.
 */

const ROUTES = {
  '/profile/bootstrap': bootstrap,
  '/tree/plant': plant,
  '/tree/verify': verify,
  '/transfer/issue': issue,
  '/transfer/claim': claim,
  '/item/lookup': lookup,
  '/item/mint': mint,
  '/redeem': redeem,
  '/electricity/submit': submitElectricity,
  '/badges/sync': sync,
  '/leaderboard/refresh': refreshLeaderboard,
  '/feedback/submit': submitFeedback,
  '/footprint/estimate': footprint.estimate,
  '/footprint/save': footprint.save,
  '/footprint/delete': footprint.remove,
  '/footprint/methodology': footprint.methodologyRoute,
  ...ADMIN_ROUTES,
};

function normalisePath(raw) {
  if (!raw) return '/';
  // Strip query string and any trailing slash, then collapse repeats.
  const path = String(raw).split('?')[0].replace(/\/+$/, '') || '/';
  return path.startsWith('/') ? path : `/${path}`;
}

function parseBody(req) {
  // Appwrite may hand back a parsed object or a raw string depending on the
  // content type the client sent.
  if (req.bodyJson && typeof req.bodyJson === 'object') return req.bodyJson;
  if (req.body && typeof req.body === 'object') return req.body;

  const raw = typeof req.bodyRaw === 'string' ? req.bodyRaw : req.body;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      return {};
    }
  }
  return {};
}

export default async ({ req, res, log, error }) => {
  const path = normalisePath(req.path);

  if (path === '/health') {
    return res.json({ ok: true, data: { status: 'up', time: new Date().toISOString() } });
  }

  const handler = ROUTES[path];
  if (!handler) {
    return res.json(
      { ok: false, error: { code: 'not_found', message: `Unknown route ${path}` } },
      404,
    );
  }

  try {
    const user = await requireUser(req);
    // One gate for the whole /admin/ prefix, ahead of any handler or database
    // read, so no individual admin route can forget to check.
    if (isAdminPath(path)) requireAdmin(user);
    const { databases, users, client, storage } = services(req);
    const config = await loadConfig(databases);
    const body = parseBody(req);

    const data = await handler({
      databases,
      users,
      client,
      storage,
      user,
      body,
      config,
      log,
    });
    return res.json({ ok: true, data: data ?? {} });
  } catch (e) {
    if (e instanceof Rejected) {
      // Expected business rejection: the client shows e.message verbatim.
      log(`rejected ${path}: ${e.code} ${e.message}`);
      return res.json(
        { ok: false, error: { code: e.code, message: e.message, details: e.details } },
        200,
      );
    }

    // Unexpected fault. Log the detail, tell the user nothing specific.
    error(`fault ${path}: ${e?.message}\n${e?.stack ?? ''}`);
    return res.json(
      {
        ok: false,
        error: {
          code: 'server_error',
          message: 'Something went wrong on our side. Please try again.',
        },
      },
      200,
    );
  }
};
