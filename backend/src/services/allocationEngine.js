/**
 * Allocation Engine
 * ------------------
 * For a given exam session (a specific date + session, e.g. "2026-11-10 FN"),
 * this assigns faculty to each room used in that session, such that:
 *
 *   1. Every room gets ceil(students_in_room / students_per_faculty) invigilators
 *      (students_per_faculty defaults to 24, configurable in `settings`).
 *   2. Faculty who are marked unavailable for that date/session are skipped.
 *   3. Faculty who already have a class or lab scheduled during the periods
 *      that this exam session overlaps (on the matching day of week, from
 *      their weekly timetable) are HARD-EXCLUDED — they physically can't be
 *      in two places at once. This is the main fix: duty allocation now
 *      respects each faculty member's actual class/lab load for that day.
 *   4. A faculty member is never assigned to two rooms in the same session.
 *   5. Selection order follows the configured designation priority
 *      (e.g. assistant professors picked before associate before professor).
 *      Within the same designation tier, faculty are ordered by:
 *        a) fewest total duty_count so far (fairness), then
 *        b) fewest OTHER classes/labs that same day (so faculty who are
 *           already busiest that day aren't also loaded with duty), then
 *        c) name, for a stable order.
 *   6. duty_count is incremented for everyone assigned, so the next
 *      generation run naturally continues to balance load.
 */

const db = require('../db');

const DAY_ABBREVIATIONS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function getSettings() {
    const { rows } = await db.query('SELECT key, value FROM settings');
    const settings = {};
    for (const row of rows) settings[row.key] = row.value;
    return {
        priorityOrder: settings.priority_order || ['assistant_professor', 'associate_professor', 'professor'],
        studentsPerFaculty: Number(settings.students_per_faculty) || 24,
        sessionPeriods: settings.session_periods || { FN: [1, 2, 3, 4], AN: [5, 6, 7, 8] },
    };
}

/**
 * Recomputes faculty_required for every room in a session based on the
 * current students_per_faculty setting, then returns the room list.
 */
async function getRoomsForSession(examSessionId, studentsPerFaculty) {
    const { rows } = await db.query(
        `SELECT era.id, era.classroom_id, era.students_count, c.room_no, c.capacity
         FROM exam_room_allocation era
         JOIN classrooms c ON c.id = era.classroom_id
         WHERE era.exam_session_id = $1
         ORDER BY c.room_no`,
        [examSessionId]
    );

    const rooms = rows.map((r) => ({
        allocationId: r.id,
        classroomId: r.classroom_id,
        roomNo: r.room_no,
        studentsCount: r.students_count,
        facultyRequired: Math.max(1, Math.ceil(r.students_count / studentsPerFaculty)),
    }));

    for (const room of rooms) {
        await db.query(
            `UPDATE exam_room_allocation SET faculty_required = $1 WHERE id = $2`,
            [room.facultyRequired, room.allocationId]
        );
    }

    return rooms;
}

/** JS Date.getDay() (0=Sun..6=Sat) -> the 3-letter day abbreviation used in faculty_timetable */
function dayOfWeekAbbrev(dateStr) {
    // The pg driver returns PostgreSQL DATE columns as local-midnight Date objects.
    // Use getDay() (local time) — NOT getUTCDay() — because pg already adjusts to local.
    if (dateStr instanceof Date) {
        return DAY_ABBREVIATIONS[dateStr.getDay()];
    }
    // Fallback for plain 'YYYY-MM-DD' strings (e.g. from tests or imports)
    const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00');
    return DAY_ABBREVIATIONS[d.getDay()];
}

/**
 * Returns eligible faculty for a date+session, already filtered for:
 *   - active status
 *   - manual unavailability entries
 *   - timetable conflicts (class/lab scheduled during the session's periods)
 * and annotated with `classesThatDay` (their total period count that weekday,
 * used as a secondary tiebreaker so lighter-day faculty are preferred).
 */
async function getEligibleFacultyPool(examDate, session, priorityOrder, sessionPeriods) {
    const dayAbbrev = dayOfWeekAbbrev(examDate);
    const relevantPeriods = sessionPeriods[session] || [];

    const { rows } = await db.query(
        `SELECT f.id, f.name, f.designation, f.duty_count, f.priority,
                COALESCE(day_load.total_periods, 0) AS classes_that_day,
                COALESCE(conflict.conflict_count, 0) AS conflict_count
         FROM faculty f
         LEFT JOIN (
             SELECT faculty_id, COUNT(*) AS total_periods
             FROM faculty_timetable
             WHERE day_of_week = $1
             GROUP BY faculty_id
         ) day_load ON day_load.faculty_id = f.id
         LEFT JOIN (
             SELECT faculty_id, COUNT(*) AS conflict_count
             FROM faculty_timetable
             WHERE day_of_week = $1 AND period = ANY($2::int[])
             GROUP BY faculty_id
         ) conflict ON conflict.faculty_id = f.id
         WHERE f.is_active = true
           AND f.id NOT IN (
                SELECT faculty_id FROM faculty_unavailability
                WHERE date = $3 AND (session = $4 OR session = 'ALL')
           )
         ORDER BY f.priority, f.name`,
        [dayAbbrev, relevantPeriods, examDate, session]
    );

    // Hard-exclude anyone with a class/lab in a period this exam session overlaps
    const eligible = rows.filter((r) => Number(r.conflict_count) === 0);

    eligible.forEach((r) => {
        r.classes_that_day = Number(r.classes_that_day);
        r.priority = Number(r.priority);
    });

    // Sort: 1) faculty-level priority (lower = first), 2) designation tier, 3) duty count, 4) name
    const tierIndex = (designation) => {
        const idx = priorityOrder.indexOf(designation);
        return idx === -1 ? priorityOrder.length : idx;
    };

    eligible.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        const tierDiff = tierIndex(a.designation) - tierIndex(b.designation);
        if (tierDiff !== 0) return tierDiff;
        if (a.duty_count !== b.duty_count) return a.duty_count - b.duty_count;
        if (a.classes_that_day !== b.classes_that_day) return a.classes_that_day - b.classes_that_day;
        return a.name.localeCompare(b.name);
    });

    return eligible;
}

/**
 * Main entry point: generate (or regenerate) invigilation duties for an
 * exam session. Existing duties for this session are cleared first, so this
 * is safe to re-run after editing faculty/classroom/timetable data.
 */
async function generateDutiesForSession(examSessionId) {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        const sessionRes = await client.query(
            'SELECT * FROM exam_sessions WHERE id = $1',
            [examSessionId]
        );
        if (sessionRes.rows.length === 0) {
            throw new Error('Exam session not found');
        }
        const examSession = sessionRes.rows[0];

        const { priorityOrder, studentsPerFaculty, sessionPeriods } = await getSettings();
        const rooms = await getRoomsForSession(examSessionId, studentsPerFaculty);

        if (rooms.length === 0) {
            throw new Error('No rooms allocated to this exam session yet');
        }

        // Decrement duty_count for everyone currently assigned before wiping,
        // so re-generation doesn't double-count (idempotent regeneration).
        await client.query(
            `UPDATE faculty SET duty_count = GREATEST(duty_count - 1, 0)
             WHERE id IN (
                 SELECT faculty_id FROM invigilation_duty
                 WHERE exam_room_allocation_id IN (
                     SELECT id FROM exam_room_allocation WHERE exam_session_id = $1
                 )
             )`,
            [examSessionId]
        );

        // Now clear previous assignments for this session
        await client.query(
            `DELETE FROM invigilation_duty
             WHERE exam_room_allocation_id IN (
                 SELECT id FROM exam_room_allocation WHERE exam_session_id = $1
             )`,
            [examSessionId]
        );

        let pool = await getEligibleFacultyPool(
            examSession.exam_date,
            examSession.session,
            priorityOrder,
            sessionPeriods
        );

        const sortPool = (arr) => arr.slice().sort((a, b) => {
            const tierDiff = priorityOrder.indexOf(a.designation) - priorityOrder.indexOf(b.designation);
            if (tierDiff !== 0) return tierDiff;
            if (a.duty_count !== b.duty_count) return a.duty_count - b.duty_count;
            if (a.classes_that_day !== b.classes_that_day) return a.classes_that_day - b.classes_that_day;
            return a.name.localeCompare(b.name);
        });

        const assignments = [];
        const shortfalls = [];
        const usedThisSession = new Set();

        for (const room of rooms) {
            const picked = [];
            for (const candidate of pool) {
                if (picked.length >= room.facultyRequired) break;
                if (usedThisSession.has(candidate.id)) continue;
                picked.push(candidate);
                usedThisSession.add(candidate.id);
            }

            if (picked.length < room.facultyRequired) {
                shortfalls.push({
                    roomNo: room.roomNo,
                    required: room.facultyRequired,
                    assigned: picked.length,
                    reason: 'Not enough faculty free of class/lab conflicts and unavailability for this slot',
                });
            }

            for (const fac of picked) {
                assignments.push({ allocationId: room.allocationId, facultyId: fac.id });
                fac.duty_count += 1; // reflect locally so subsequent rooms keep balancing
            }

            pool = sortPool(pool);
        }

        for (const a of assignments) {
            await client.query(
                `INSERT INTO invigilation_duty (exam_room_allocation_id, faculty_id, status)
                 VALUES ($1, $2, 'assigned')
                 ON CONFLICT (exam_room_allocation_id, faculty_id) DO NOTHING`,
                [a.allocationId, a.facultyId]
            );
            await client.query(
                `UPDATE faculty SET duty_count = duty_count + 1, updated_at = now() WHERE id = $1`,
                [a.facultyId]
            );
        }

        await client.query('COMMIT');

        return {
            examSessionId,
            roomsProcessed: rooms.length,
            totalAssigned: assignments.length,
            shortfalls,
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Swap a single duty to a different faculty member manually
 * (used by the "modify" flow in the UI). Adjusts duty_count for both.
 * Does NOT block swaps onto a faculty member with a timetable conflict —
 * manual overrides are the invigilation coordinator's call — but the
 * conflict is surfaced by the caller via checkTimetableConflict below.
 */
async function swapDuty(dutyId, newFacultyId) {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        const { rows } = await client.query('SELECT * FROM invigilation_duty WHERE id = $1', [dutyId]);
        if (rows.length === 0) throw new Error('Duty not found');
        const duty = rows[0];

        await client.query('UPDATE faculty SET duty_count = GREATEST(duty_count - 1, 0) WHERE id = $1', [duty.faculty_id]);
        await client.query('UPDATE faculty SET duty_count = duty_count + 1 WHERE id = $1', [newFacultyId]);
        await client.query(
            `UPDATE invigilation_duty SET faculty_id = $1, status = 'swapped' WHERE id = $2`,
            [newFacultyId, dutyId]
        );

        await client.query('COMMIT');
        return { success: true };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Checks whether a specific faculty member has a class/lab conflict for a
 * given exam session — used by the frontend to warn the coordinator before
 * they manually reassign a duty to someone.
 */
async function checkTimetableConflict(facultyId, examSessionId) {
    const { rows: sessionRows } = await db.query('SELECT * FROM exam_sessions WHERE id = $1', [examSessionId]);
    if (sessionRows.length === 0) throw new Error('Exam session not found');
    const examSession = sessionRows[0];

    const { sessionPeriods } = await getSettings();
    const dayAbbrev = dayOfWeekAbbrev(examSession.exam_date);
    const relevantPeriods = sessionPeriods[examSession.session] || [];

    const { rows } = await db.query(
        `SELECT period, subject_code FROM faculty_timetable
         WHERE faculty_id = $1 AND day_of_week = $2 AND period = ANY($3::int[])`,
        [facultyId, dayAbbrev, relevantPeriods]
    );

    return { hasConflict: rows.length > 0, conflicts: rows };
}

/**
 * DRY-RUN: runs the full allocation logic for an exam session but writes
 * NOTHING to the database. Returns the same assignment plan as
 * generateDutiesForSession so the coordinator can review before committing.
 */
async function previewDutiesForSession(examSessionId) {
    const sessionRes = await db.query('SELECT * FROM exam_sessions WHERE id = $1', [examSessionId]);
    if (sessionRes.rows.length === 0) throw new Error('Exam session not found');
    const examSession = sessionRes.rows[0];

    const { priorityOrder, studentsPerFaculty, sessionPeriods } = await getSettings();

    // Read rooms without updating faculty_required in the DB
    const { rows: roomRows } = await db.query(
        `SELECT era.id AS allocation_id, era.students_count, c.room_no
         FROM exam_room_allocation era
         JOIN classrooms c ON c.id = era.classroom_id
         WHERE era.exam_session_id = $1 ORDER BY c.room_no`,
        [examSessionId]
    );
    if (roomRows.length === 0) throw new Error('No rooms allocated to this exam session yet');

    const rooms = roomRows.map((r) => ({
        allocationId: r.allocation_id,
        roomNo: r.room_no,
        studentsCount: r.students_count,
        facultyRequired: Math.max(1, Math.ceil(r.students_count / studentsPerFaculty)),
    }));

    let pool = await getEligibleFacultyPool(
        examSession.exam_date,
        examSession.session,
        priorityOrder,
        sessionPeriods
    );

    const sortPool = (arr) => arr.slice().sort((a, b) => {
        const tierDiff = priorityOrder.indexOf(a.designation) - priorityOrder.indexOf(b.designation);
        if (tierDiff !== 0) return tierDiff;
        if (a.duty_count !== b.duty_count) return a.duty_count - b.duty_count;
        if (a.classes_that_day !== b.classes_that_day) return a.classes_that_day - b.classes_that_day;
        return a.name.localeCompare(b.name);
    });

    const previewRooms = [];
    const shortfalls = [];
    const usedThisSession = new Set();
    let totalAssigned = 0;

    for (const room of rooms) {
        const picked = [];
        for (const candidate of pool) {
            if (picked.length >= room.facultyRequired) break;
            if (usedThisSession.has(candidate.id)) continue;
            picked.push(candidate);
            usedThisSession.add(candidate.id);
        }

        if (picked.length < room.facultyRequired) {
            shortfalls.push({
                roomNo: room.roomNo,
                required: room.facultyRequired,
                assigned: picked.length,
                reason: 'Not enough faculty free of conflicts and unavailability for this slot',
            });
        }

        picked.forEach((f) => { f.duty_count += 1; });
        pool = sortPool(pool);
        totalAssigned += picked.length;

        previewRooms.push({
            roomNo: room.roomNo,
            studentsCount: room.studentsCount,
            facultyRequired: room.facultyRequired,
            assignees: picked.map((f) => ({
                id: f.id,
                name: f.name,
                designation: f.designation,
                priority: f.priority,                // ← was missing; needed for priority badge in draft preview
                currentDutyCount: f.duty_count - 1, // show count BEFORE this assignment
            })),
        });
    }

    return { examSessionId, rooms: previewRooms, shortfalls, totalAssigned };
}

/**
 * Returns the list of faculty eligible to invigilate a given exam session.
 * Filters out:
 *   - inactive faculty
 *   - faculty marked unavailable on that date/session
 *   - faculty with a class/lab timetable conflict during the session periods
 * Used to populate the Reassign dropdown in the frontend.
 */
async function getAvailableFacultyForSession(examSessionId) {
    const { rows: sessionRows } = await db.query('SELECT * FROM exam_sessions WHERE id = $1', [examSessionId]);
    if (sessionRows.length === 0) throw new Error('Exam session not found');
    const examSession = sessionRows[0];

    const { priorityOrder, sessionPeriods } = await getSettings();
    const eligible = await getEligibleFacultyPool(
        examSession.exam_date,
        examSession.session,
        priorityOrder,
        sessionPeriods
    );

    return eligible.map((f) => ({
        id: f.id,
        name: f.name,
        designation: f.designation,
        duty_count: f.duty_count,
        priority: f.priority,
    }));
}

module.exports = {
    generateDutiesForSession,
    previewDutiesForSession,
    swapDuty,
    getSettings,
    checkTimetableConflict,
    getAvailableFacultyForSession,
};
