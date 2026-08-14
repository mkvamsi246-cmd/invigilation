const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { parseImportFile } = require('../services/importParser');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
});

router.use(requireAuth);

/**
 * POST /api/upload/:importType
 * importType: faculty | classrooms | exam_rooms | workload
 * form field name: "file"
 */
router.post('/:importType', upload.single('file'), async (req, res) => {
    const { importType } = req.params;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    let parsed;
    try {
        parsed = await parseImportFile({
            buffer: req.file.buffer,
            mimetype: req.file.mimetype,
            originalname: req.file.originalname,
            importType,
        });
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }

    const { records, skipped } = parsed;
    let imported = 0;

    try {
        if (importType === 'faculty') {
            for (const r of records) {
                const existing = await db.query(
                    `SELECT id FROM faculty WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))`,
                    [r.name]
                );
                if (existing.rows.length > 0) {
                    await db.query(
                        `UPDATE faculty SET
                            designation = $1,
                            department  = COALESCE($2, department),
                            email       = COALESCE($3, email),
                            phone       = COALESCE($4, phone),
                            duty_count  = $5,
                            priority    = $6,
                            updated_at  = now()
                         WHERE id = $7`,
                        [r.designation, r.department, r.email, r.phone, r.duty_count, r.priority, existing.rows[0].id]
                    );
                } else {
                    await db.query(
                        `INSERT INTO faculty (name, designation, department, email, phone, duty_count, priority)
                         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                        [r.name, r.designation, r.department, r.email, r.phone, r.duty_count || 0, r.priority]
                    );
                }
                imported++;
            }
        } else if (importType === 'classrooms') {
            for (const r of records) {
                await db.query(
                    `INSERT INTO classrooms (room_no, building, capacity)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (room_no) DO UPDATE SET capacity = EXCLUDED.capacity, building = EXCLUDED.building`,
                    [r.roomNo, r.building, r.capacity]
                );
                imported++;
            }
        } else if (importType === 'exam_rooms') {
            for (const r of records) {
                const sessionRes = await db.query(
                    `INSERT INTO exam_sessions (exam_name, exam_date, session)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (exam_name, exam_date, session) DO UPDATE SET exam_name = EXCLUDED.exam_name
                     RETURNING id`,
                    [r.examName, r.date, r.session]
                );
                const examSessionId = sessionRes.rows[0].id;

                const classroomRes = await db.query('SELECT id FROM classrooms WHERE room_no = $1', [r.roomNo]);
                if (classroomRes.rows.length === 0) { continue; } // room not registered yet
                const classroomId = classroomRes.rows[0].id;
                const facultyRequired = Math.max(1, Math.ceil(r.studentsCount / 24));

                await db.query(
                    `INSERT INTO exam_room_allocation (exam_session_id, classroom_id, students_count, faculty_required)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (exam_session_id, classroom_id)
                     DO UPDATE SET students_count = EXCLUDED.students_count, faculty_required = EXCLUDED.faculty_required`,
                    [examSessionId, classroomId, r.studentsCount, facultyRequired]
                );
                imported++;
            }
        } else if (importType === 'workload') {
            for (const r of records) {
                await db.query(
                    `UPDATE faculty SET duty_count = $1 WHERE name = $2`,
                    [r.workloadTotal, r.name]
                );
                imported++;
            }
        } else if (importType === 'timetable') {
            // Match by name (case-insensitive) against existing faculty; unmatched names are skipped
            // so the timetable import doesn't silently create phantom faculty records.
            const facultyRes = await db.query('SELECT id, name FROM faculty');
            const nameToId = new Map(facultyRes.rows.map((f) => [f.name.trim().toLowerCase(), f.id]));

            // Re-uploading should fully replace each matched faculty member's timetable
            // (not just upsert individual periods), so periods that became free show up
            // as free rather than keeping a stale "busy" entry from the old timetable.
            const matchedFacultyIds = new Set();
            for (const r of records) {
                const facultyId = nameToId.get(r.facultyName.trim().toLowerCase());
                if (facultyId) matchedFacultyIds.add(facultyId);
            }
            for (const facultyId of matchedFacultyIds) {
                await db.query('DELETE FROM faculty_timetable WHERE faculty_id = $1', [facultyId]);
            }

            let unmatchedNames = 0;
            for (const r of records) {
                const facultyId = nameToId.get(r.facultyName.trim().toLowerCase());
                if (!facultyId) { unmatchedNames++; continue; }
                await db.query(
                    `INSERT INTO faculty_timetable (faculty_id, day_of_week, period, subject_code)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (faculty_id, day_of_week, period)
                     DO UPDATE SET subject_code = EXCLUDED.subject_code`,
                    [facultyId, r.dayOfWeek, r.period, r.subjectCode]
                );
                imported++;
            }
            if (unmatchedNames > 0) {
                return res.json({
                    imported, skipped: skipped + unmatchedNames, total: records.length,
                    warning: `${unmatchedNames} timetable entries didn't match any existing faculty name — import Faculty first, then re-upload the timetable.`,
                });
            }
        } else {
            return res.status(400).json({ error: `Unknown importType: ${importType}` });
        }

        await db.query(
            `INSERT INTO import_log (file_name, import_type, rows_imported, rows_skipped)
             VALUES ($1, $2, $3, $4)`,
            [req.file.originalname, importType, imported, skipped]
        );

        res.json({ imported, skipped, total: records.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
