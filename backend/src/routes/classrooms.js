const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', async (req, res) => {
    try {
        const { rows } = await db.query('SELECT * FROM classrooms ORDER BY room_no');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/', async (req, res) => {
    const { room_no, building, capacity } = req.body;
    if (!room_no || !capacity) return res.status(400).json({ error: 'room_no and capacity are required' });
    try {
        const { rows } = await db.query(
            `INSERT INTO classrooms (room_no, building, capacity) VALUES ($1, $2, $3) RETURNING *`,
            [room_no, building || null, capacity]
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.put('/:id', async (req, res) => {
    const { room_no, building, capacity, is_active } = req.body;
    try {
        const { rows } = await db.query(
            `UPDATE classrooms SET
                room_no = COALESCE($1, room_no),
                building = COALESCE($2, building),
                capacity = COALESCE($3, capacity),
                is_active = COALESCE($4, is_active),
                updated_at = now()
             WHERE id = $5 RETURNING *`,
            [room_no, building, capacity, is_active, req.params.id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Classroom not found' });
        res.json(rows[0]);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM classrooms WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        if (err.code === '23503') {
            return res.status(409).json({
                error: 'Cannot delete: this classroom is used in an exam room allocation. Remove the allocation first.'
            });
        }
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
