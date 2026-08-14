const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// List all faculty
router.get('/', async (req, res) => {
    try {
        const { rows } = await db.query('SELECT * FROM faculty ORDER BY name');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create faculty
router.post('/', async (req, res) => {
    const { name, designation, department, email, phone, duty_count, priority } = req.body;
    if (!name || !designation) return res.status(400).json({ error: 'name and designation are required' });
    // Default priority based on designation if not provided
    const defaultPriority = designation === 'professor' ? 1 : designation === 'associate_professor' ? 2 : 3;
    try {
        const { rows } = await db.query(
            `INSERT INTO faculty (name, designation, department, email, phone, duty_count, priority)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [name, designation, department || null, email || null, phone || null,
             parseInt(duty_count, 10) || 0,
             priority !== undefined && priority !== '' ? parseInt(priority, 10) : defaultPriority]
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Update faculty
router.put('/:id', async (req, res) => {
    const { name, designation, department, email, phone, is_active, duty_count, priority } = req.body;
    try {
        const { rows } = await db.query(
            `UPDATE faculty SET
                name        = COALESCE($1, name),
                designation = COALESCE($2, designation),
                department  = COALESCE($3, department),
                email       = COALESCE($4, email),
                phone       = COALESCE($5, phone),
                is_active   = COALESCE($6, is_active),
                duty_count  = COALESCE($7, duty_count),
                priority    = COALESCE($8, priority),
                updated_at  = now()
             WHERE id = $9 RETURNING *`,
            [name, designation, department, email, phone, is_active, duty_count,
             priority !== undefined ? parseInt(priority, 10) : null,
             req.params.id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Faculty not found' });
        res.json(rows[0]);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Delete faculty
router.delete('/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM faculty WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        // Foreign key violation — faculty has assigned duties
        if (err.code === '23503') {
            return res.status(409).json({
                error: 'Cannot delete: this faculty member has invigilation duties assigned. Cancel their duties first, then delete.'
            });
        }
        res.status(500).json({ error: err.message });
    }
});

// Update duty count directly (avoids COALESCE(0) ambiguity with the generic PUT)
router.patch('/:id/duty-count', async (req, res) => {
    const count = parseInt(req.body.duty_count, 10);
    if (isNaN(count) || count < 0) return res.status(400).json({ error: 'duty_count must be a non-negative integer' });
    try {
        const { rows } = await db.query(
            `UPDATE faculty SET duty_count = $1, updated_at = now() WHERE id = $2 RETURNING *`,
            [count, req.params.id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Faculty not found' });
        res.json(rows[0]);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Mark unavailability (date / session / reason)
router.post('/:id/unavailability', async (req, res) => {
    const { date, session, reason } = req.body;
    if (!date) return res.status(400).json({ error: 'date is required' });
    try {
        const { rows } = await db.query(
            `INSERT INTO faculty_unavailability (faculty_id, date, session, reason)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (faculty_id, date, session) DO UPDATE SET reason = EXCLUDED.reason
             RETURNING *`,
            [req.params.id, date, session || 'ALL', reason || null]
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.get('/:id/unavailability', async (req, res) => {
    const { rows } = await db.query(
        'SELECT * FROM faculty_unavailability WHERE faculty_id = $1 ORDER BY date',
        [req.params.id]
    );
    res.json(rows);
});

router.delete('/unavailability/:entryId', async (req, res) => {
    try {
        await db.query('DELETE FROM faculty_unavailability WHERE id = $1', [req.params.entryId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// View a faculty member's weekly timetable (classes/labs), as imported
router.get('/:id/timetable', async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT day_of_week, period, subject_code FROM faculty_timetable
             WHERE faculty_id = $1 ORDER BY
                CASE day_of_week WHEN 'Mon' THEN 1 WHEN 'Tue' THEN 2 WHEN 'Wed' THEN 3
                    WHEN 'Thu' THEN 4 WHEN 'Fri' THEN 5 WHEN 'Sat' THEN 6 ELSE 7 END,
                period`,
            [req.params.id]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
