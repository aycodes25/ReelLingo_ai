import { many, query } from "./db.js";
import { logger } from "./logger.js";

/**
 * Admin audit trail: every change an admin makes (plans, prices, settings, users, minutes, payments…) is written
 * down with who made it, when, and what they sent. Secrets in the request are never stored.
 */

const SECRET_KEY = /pass|secret|token|key|authorization/i;
const MAX_TEXT = 4000;

export function redact(value, depth = 0) {
  if (value === null || typeof value !== "object") return typeof value === "string" ? value.slice(0, 500) : value;
  if (depth > 4) return "…";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  return Object.fromEntries(Object.entries(value).slice(0, 80).map(([key, item]) => [key, SECRET_KEY.test(key) ? "[hidden]" : redact(item, depth + 1)]));
}

export async function writeAudit({ adminId, adminEmail, action, target = "", details = {} }) {
  try {
    await query(
      "INSERT INTO admin_audit (admin_id, admin_email, action, target, details) VALUES ($1, $2, $3, $4, $5)",
      [adminId || null, adminEmail || null, String(action).slice(0, 200), String(target).slice(0, 300), JSON.stringify(redact(details)).slice(0, MAX_TEXT)],
    );
  } catch (error) {
    // The change itself already happened; losing the note must be loud, but it must not undo or block the work.
    logger.error({ err: error, action }, "Could not write the admin audit log (is the admin_audit table created? Run backend/sql/schema.sql)");
  }
}

/**
 * Express middleware for the admin area: after any successful change (POST, PUT, PATCH, DELETE) it writes an audit
 * row *before* the reply goes out. A handler can add context with `response.locals.audit = { before }`.
 */
export function auditAdminChanges(request, response, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    next();
    return;
  }
  const end = response.end.bind(response);
  let written = false;
  response.end = (...args) => {
    if (written || response.statusCode >= 400) return end(...args);
    written = true;
    const route = `${request.method} ${request.baseUrl}${request.route?.path || request.path}`;
    void writeAudit({
      adminId: request.userId,
      adminEmail: request.user?.email,
      action: route,
      target: JSON.stringify(request.params || {}),
      details: { body: request.body, query: request.query, ...(response.locals.audit || {}) },
    }).finally(() => end(...args));
    return response;
  };
  next();
}

export async function listAudit({ limit = 100, offset = 0, search = "" } = {}) {
  const like = `%${String(search).toLowerCase()}%`;
  const rows = search
    ? await many("SELECT * FROM admin_audit WHERE LOWER(action) LIKE $1 OR LOWER(COALESCE(admin_email, '')) LIKE $1 OR LOWER(COALESCE(target, '')) LIKE $1 ORDER BY id DESC LIMIT $2 OFFSET $3", [like, limit, offset])
    : await many("SELECT * FROM admin_audit ORDER BY id DESC LIMIT $1 OFFSET $2", [limit, offset]);
  return rows.map((row) => {
    let details = {};
    try {
      details = JSON.parse(row.details || "{}");
    } catch {
      details = {};
    }
    return {
      id: Number(row.id), admin_id: row.admin_id, admin_email: row.admin_email || "", action: row.action, target: row.target || "", details,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    };
  });
}

