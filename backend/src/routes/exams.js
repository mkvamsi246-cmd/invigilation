const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// List exam sessions
router.get('/', async (req, res) => {
    try {
        const { rows } = await db.query('SELECT * FROM exam_sessions ORDER BY exam_date DESC, session');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create exam session
router.post('/', async (req, res) => {
    const { exam_name, exam_date, session, start_time, end_time } = req.body;
    if (!exam_name || !exam_date) return res.status(400).json({ error: 'exam_name and exam_date are required' });
    try {
        const { rows } = await db.query(
            `INSERT INTO exam_sessions (exam_name, exam_date, session, start_time, end_time)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [exam_name, exam_date, session || 'FN', start_time || null, end_time || null]
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM exam_sessions WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Room allocations within a session ---

router.get('/:id/rooms', async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT era.*, c.room_no, c.capacity
             FROM exam_room_allocation era
             JOIN classrooms c ON c.id = era.classroom_id
             WHERE era.exam_session_id = $1 ORDER BY c.room_no`,
            [req.params.id]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/:id/rooms', async (req, res) => {
    const { classroom_id, students_count } = req.body;
    if (!classroom_id || students_count === undefined) {
        return res.status(400).json({ error: 'classroom_id and students_count are required' });
    }
    const facultyRequired = Math.max(1, Math.ceil(students_count / 24));
    try {
        const { rows } = await db.query(
            `INSERT INTO exam_room_allocation (exam_session_id, classroom_id, students_count, faculty_required)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (exam_session_id, classroom_id)
             DO UPDATE SET students_count = EXCLUDED.students_count, faculty_required = EXCLUDED.faculty_required
             RETURNING *`,
            [req.params.id, classroom_id, students_count, facultyRequired]
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.delete('/rooms/:allocationId', async (req, res) => {
    try {
        await db.query('DELETE FROM exam_room_allocation WHERE id = $1', [req.params.allocationId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Duty chart (assigned invigilators) for a session ---

router.get('/:id/duties', async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT d.id AS duty_id, d.status, era.id AS allocation_id, era.students_count,
                    era.faculty_required, c.room_no, f.id AS faculty_id, f.name AS faculty_name,
                    f.designation
             FROM exam_room_allocation era
             LEFT JOIN invigilation_duty d ON d.exam_room_allocation_id = era.id
             LEFT JOIN faculty f ON f.id = d.faculty_id
             JOIN classrooms c ON c.id = era.classroom_id
             WHERE era.exam_session_id = $1
             ORDER BY c.room_no, f.name`,
            [req.params.id]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
