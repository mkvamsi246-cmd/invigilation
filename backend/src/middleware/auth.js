// Minimal single-admin session auth.
// This is intentionally simple (one admin account, no roles/permissions).
// For multi-user staff logins with roles, extend the `faculty` table with
// a password_hash column and adapt this middleware accordingly.

function requireAuth(req, res, next) {
    if (req.session && req.session.isAdmin) return next();
    return res.status(401).json({ error: 'Not authenticated' });
}

module.exports = { requireAuth };
