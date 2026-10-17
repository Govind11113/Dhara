import { READ_ROUTES } from './admin_read.js';
import { WRITE_ROUTES } from './admin_write.js';

/**
 * Everything under /admin/.
 *
 * main.js verifies the caller carries the admin label before any handler here
 * runs, so handlers do not re-check — and must never be mounted outside the
 * /admin/ prefix, or they would lose that protection (a test enforces it).
 */
export const ADMIN_ROUTES = {
  ...READ_ROUTES,
  ...WRITE_ROUTES,
};
