const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const engine = require('../services/allocationEngine');
const exportService = require('../services/exportService');

router.use(requireAuth);

// STEP 1: Preview — dry-run allocation, nothing written to DB
router.post('/preview/:examSessionId', async (req, res) => {
    try {
        const result = await engine.previewDutiesForSession(req.params.examSessionId);
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// STEP 2: Finalize — generate (or regenerate) duties and write to DB
router.post('/generate/:examSessionId', async (req, res) => {
    try {
        const result = await engine.generateDutiesForSession(req.params.examSessionId);
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Manually reassign a single duty to a different faculty member
router.put('/duty/:dutyId/reassign', async (req, res) => {
    const { faculty_id } = req.body;
    if (!faculty_id) return res.status(400).json({ error: 'faculty_id is required' });
    try {
        const result = await engine.swapDuty(req.params.dutyId, faculty_id);
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Cancel a duty (frees the faculty, does not auto-reassign)
router.delete('/duty/:dutyId', async (req, res) => {
    const { rows } = await db.query('SELECT faculty_id FROM invigilation_duty WHERE id = $1', [req.params.dutyId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Duty not found' });
    await db.query('UPDATE faculty SET duty_count = GREATEST(duty_count - 1, 0) WHERE id = $1', [rows[0].faculty_id]);
    await db.query('DELETE FROM invigilation_duty WHERE id = $1', [req.params.dutyId]);
    res.json({ success: true });
});

// Settings: priority order + students-per-faculty ratio
router.get('/settings', async (req, res) => {
    const settings = await engine.getSettings();
    res.json(settings);
});

router.put('/settings', async (req, res) => {
    const { priorityOrder, studentsPerFaculty, sessionPeriods } = req.body;
    if (priorityOrder) {
        await db.query(`UPDATE settings SET value = $1 WHERE key = 'priority_order'`, [JSON.stringify(priorityOrder)]);
    }
    if (studentsPerFaculty) {
        await db.query(`UPDATE settings SET value = $1 WHERE key = 'students_per_faculty'`, [JSON.stringify(studentsPerFaculty)]);
    }
    if (sessionPeriods) {
        await db.query(
            `INSERT INTO settings (key, value) VALUES ('session_periods', $1)
             ON CONFLICT (key) DO UPDATE SET value = $1`,
            [JSON.stringify(sessionPeriods)]
        );
    }
    const settings = await engine.getSettings();
    res.json(settings);
});

// Check whether a specific faculty member has a class/lab conflict for a session
// (used before a manual reassignment, so the coordinator sees a warning)
router.get('/conflict/:examSessionId/:facultyId', async (req, res) => {
    try {
        const result = await engine.checkTimetableConflict(req.params.facultyId, req.params.examSessionId);
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Returns faculty who are eligible (active, no unavailability, no timetable conflict)
// for a given exam session — used to populate the Reassign dropdown
router.get('/available/:examSessionId', async (req, res) => {
    try {
        const result = await engine.getAvailableFacultyForSession(req.params.examSessionId);
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Export duty chart
router.get('/export/:examSessionId/excel', async (req, res) => {
    try {
        const buffer = await exportService.generateDutyChartExcel(req.params.examSessionId);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="duty-chart-${req.params.examSessionId}.xlsx"`);
        res.send(buffer);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.get('/export/:examSessionId/pdf', async (req, res) => {
    try {
        const buffer = await exportService.generateDutyChartPdf(req.params.examSessionId);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="duty-chart-${req.params.examSessionId}.pdf"`);
        res.send(buffer);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;
