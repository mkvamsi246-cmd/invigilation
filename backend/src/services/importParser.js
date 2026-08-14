/**
 * Import Parser
 * -------------
 * Reads uploaded Excel (.xlsx) or PDF files and extracts structured rows for:
 *   - faculty        (Name, Designation, Department, Email, Phone)
 *   - classrooms      (Room No, Building, Capacity)
 *   - exam_rooms      (Exam Name, Date, Session, Room No, Students Count)
 *   - workload        (matches this college's "Work Load" sheet format,
 *                       used only to seed starting duty_count for fairness)
 *
 * Column matching is header-based and case/spacing-insensitive, so the
 * uploader doesn't need an exact template — reasonable header variants
 * (e.g. "Faculty Name" / "Name", "Room No" / "Room Number") are accepted.
 */

const XLSX = require('xlsx');
const pdfParse = require('pdf-parse');

function normalizeHeader(h) {
    return String(h || '').trim().toLowerCase().replace(/[\s_]+/g, '');
}

function findColumn(headerRow, candidates) {
    const normalized = headerRow.map(normalizeHeader);
    for (const cand of candidates) {
        const idx = normalized.indexOf(normalizeHeader(cand));
        if (idx !== -1) return idx;
    }
    return -1;
}

function designationFromText(text) {
    const t = String(text || '').toLowerCase();
    if (t.includes('assistant')) return 'assistant_professor';
    if (t.includes('associate')) return 'associate_professor';
    if (t.includes('professor')) return 'professor';
    return null;
}

// ---------- Excel parsing ----------

function sheetToRows(worksheet) {
    return XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null, blankrows: false });
}

function parseFacultyExcel(workbook) {
    const sheetName = workbook.SheetNames[0];
    const rows = sheetToRows(workbook.Sheets[sheetName]);
    if (rows.length < 2) return { records: [], skipped: 0 };

    const header = rows[0];
    const nameCol        = findColumn(header, ['name', 'facultyname', 'faculty']);
    const designationCol = findColumn(header, ['designation', 'type', 'facultytype', 'rank']);
    const deptCol        = findColumn(header, ['department', 'dept', 'branch']);
    const emailCol       = findColumn(header, ['email', 'emailid']);
    const phoneCol       = findColumn(header, ['phone', 'mobile', 'contact']);
    const dutyCountCol   = findColumn(header, ['dutycount', 'duties', 'dutiesdone', 'noofduties', 'total']);
    const priorityCol    = findColumn(header, ['priority', 'priorityno', 'prioritynumber', 'order']);

    const records = [];
    let skipped = 0;

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || nameCol === -1 || !row[nameCol]) { skipped++; continue; }

        const designation = designationCol !== -1 ? designationFromText(row[designationCol]) : null;
        if (!designation) { skipped++; continue; }

        const rawDutyCount = dutyCountCol !== -1 ? row[dutyCountCol] : null;
        const dutyCount = rawDutyCount !== null && rawDutyCount !== undefined
            ? Math.max(0, parseInt(rawDutyCount, 10) || 0)
            : 0;

        // Priority: use column value if present, else default by designation
        const defaultPriority = designation === 'professor' ? 1 : designation === 'associate_professor' ? 2 : 3;
        const rawPriority = priorityCol !== -1 ? row[priorityCol] : null;
        const priority = (rawPriority !== null && rawPriority !== undefined && String(rawPriority).trim() !== '')
            ? (parseInt(rawPriority, 10) || defaultPriority)
            : defaultPriority;

        records.push({
            name:        String(row[nameCol]).trim(),
            designation,
            department:  deptCol  !== -1 ? (row[deptCol]  || null) : null,
            email:       emailCol !== -1 ? (row[emailCol] || null) : null,
            phone:       phoneCol !== -1 ? (row[phoneCol] || null) : null,
            duty_count:  dutyCount,
            priority,
        });
    }

    return { records, skipped };
}

function parseClassroomsExcel(workbook) {
    const sheetName = workbook.SheetNames[0];
    const rows = sheetToRows(workbook.Sheets[sheetName]);
    if (rows.length < 2) return { records: [], skipped: 0 };

    const header = rows[0];
    const roomCol = findColumn(header, ['roomno', 'room', 'roomnumber', 'classroom']);
    const capacityCol = findColumn(header, ['capacity', 'seatingcapacity', 'seats', 'strength']);
    const buildingCol = findColumn(header, ['building', 'block']);

    const records = [];
    let skipped = 0;

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || roomCol === -1 || capacityCol === -1 || !row[roomCol] || !row[capacityCol]) { skipped++; continue; }
        const capacity = parseInt(row[capacityCol], 10);
        if (!capacity || capacity <= 0) { skipped++; continue; }

        records.push({
            roomNo: String(row[roomCol]).trim(),
            capacity,
            building: buildingCol !== -1 ? (row[buildingCol] || null) : null,
        });
    }

    return { records, skipped };
}

function parseExamRoomsExcel(workbook) {
    const sheetName = workbook.SheetNames[0];
    const rows = sheetToRows(workbook.Sheets[sheetName]);
    if (rows.length < 2) return { records: [], skipped: 0 };

    const header = rows[0];
    const examCol = findColumn(header, ['examname', 'exam', 'subject']);
    const dateCol = findColumn(header, ['date', 'examdate']);
    const sessionCol = findColumn(header, ['session', 'slot']);
    const roomCol = findColumn(header, ['roomno', 'room', 'classroom']);
    const studentsCol = findColumn(header, ['studentscount', 'students', 'strength', 'noofstudents']);

    const records = [];
    let skipped = 0;

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[examCol] || !row[dateCol] || !row[roomCol] || !row[studentsCol]) { skipped++; continue; }

        let dateVal = row[dateCol];
        // Excel serial dates come through as numbers when cellDates isn't set
        if (typeof dateVal === 'number') {
            const parsed = XLSX.SSF.parse_date_code(dateVal);
            dateVal = `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
        }

        records.push({
            examName: String(row[examCol]).trim(),
            date: dateVal,
            session: sessionCol !== -1 ? (row[sessionCol] || 'FN') : 'FN',
            roomNo: String(row[roomCol]).trim(),
            studentsCount: parseInt(row[studentsCol], 10) || 0,
        });
    }

    return { records, skipped };
}

/**
 * Parses this college's "Work Load" sheet format (S.No, Faculty Name, ..., Total)
 * to seed starting duty_count values, matched to existing faculty by name.
 */
function parseWorkloadExcel(workbook) {
    const sheetName = workbook.SheetNames.find((n) => /work\s*load/i.test(n)) || workbook.SheetNames[0];
    const rows = sheetToRows(workbook.Sheets[sheetName]);
    if (rows.length < 2) return { records: [], skipped: 0 };

    const header = rows[0];
    const nameCol = findColumn(header, ['facultyname', 'name']);
    const totalCol = findColumn(header, ['total']);

    const records = [];
    let skipped = 0;

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || nameCol === -1 || !row[nameCol]) { skipped++; continue; }
        const total = totalCol !== -1 ? parseInt(row[totalCol], 10) : null;
        records.push({ name: String(row[nameCol]).trim(), workloadTotal: total || 0 });
    }

    return { records, skipped };
}

/**
 * Parses the "Individual Load" style timetable sheet: a repeating block per
 * faculty member —
 *   [blank col, Faculty Name, ...]
 *   [blank col, 1, 2, 3, 4, blank, 5, 6, 7, 8]        <- period header
 *   [Mon, <p1>, <p2>, <p3>, <p4>, blank, <p5>, <p6>, <p7>, <p8>]
 *   [Tue, ...]
 *   ... up to Sat/Sun
 *   [blank row separating the next faculty block]
 *
 * A period cell is "busy" if it has any non-empty value (subject/section code).
 * Faculty are matched to existing `faculty` rows by name (case-insensitive,
 * trimmed) — the timetable import does not create new faculty records, since
 * designation isn't available in this sheet format.
 */
const DAY_ABBREVIATIONS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function isPeriodHeaderRow(row) {
    // Looks like: [null, 1, 2, 3, 4, null, 5, 6, 7, 8] — at least 4 sequential small integers
    const nums = row.filter((c) => typeof c === 'number' || (typeof c === 'string' && /^\d+$/.test(c.trim())));
    return nums.length >= 4 && nums.every((n) => Number(n) >= 1 && Number(n) <= 12);
}

function isDayRow(row) {
    const first = String(row[0] || '').trim();
    return DAY_ABBREVIATIONS.some((d) => d.toLowerCase() === first.toLowerCase());
}

function buildColumnToPeriodMap(headerRow) {
    // Maps the column index in the row to the period number it represents,
    // based on wherever the numbers 1..N actually sit in that header row
    // (handles the lunch-break gap column automatically).
    const map = {};
    headerRow.forEach((cell, idx) => {
        if (idx === 0) return; // day-name column
        const n = typeof cell === 'number' ? cell : (typeof cell === 'string' && /^\d+$/.test(cell.trim()) ? Number(cell) : null);
        if (n !== null) map[idx] = n;
    });
    return map;
}

function parseTimetableExcel(workbook) {
    const sheetName = workbook.SheetNames.find((n) => /individual\s*load/i.test(n)) || workbook.SheetNames[0];
    const rows = sheetToRows(workbook.Sheets[sheetName]);

    const records = []; // { facultyName, dayOfWeek, period, subjectCode }
    let skipped = 0;
    let currentFacultyName = null;
    let columnToPeriod = null;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i] || [];

        if (isPeriodHeaderRow(row)) {
            columnToPeriod = buildColumnToPeriodMap(row);
            // The faculty name is expected on the row immediately above the header
            const nameRow = rows[i - 1] || [];
            const nameCell = nameRow.find((c) => typeof c === 'string' && c.trim().length > 2);
            currentFacultyName = nameCell ? nameCell.trim() : null;
            continue;
        }

        if (isDayRow(row) && currentFacultyName && columnToPeriod) {
            const dayAbbrev = DAY_ABBREVIATIONS.find((d) => d.toLowerCase() === String(row[0]).trim().toLowerCase());
            for (const [colIdx, period] of Object.entries(columnToPeriod)) {
                const cell = row[Number(colIdx)];
                if (cell !== null && cell !== undefined && String(cell).trim() !== '') {
                    records.push({
                        facultyName: currentFacultyName,
                        dayOfWeek: dayAbbrev,
                        period,
                        subjectCode: String(cell).trim(),
                    });
                }
            }
        }
    }

    if (records.length === 0) skipped = rows.length;
    return { records, skipped };
}

// ---------- PDF parsing (best-effort, line-based) ----------
// PDF has no reliable column structure, so we parse line-by-line using
// patterns. This works for simple tabular PDFs exported "as text" but
// Excel remains the recommended format for anything complex.

async function parsePdfBuffer(buffer) {
    const data = await pdfParse(buffer);
    return data.text.split('\n').map((l) => l.trim()).filter(Boolean);
}

async function parseFacultyPdf(buffer) {
    const lines = await parsePdfBuffer(buffer);
    const records = [];
    let skipped = 0;

    for (const line of lines) {
        const designation = designationFromText(line);
        if (!designation) { skipped++; continue; }
        // Expect something like: "Dr. K Ramaprasada Raju - Professor - CSE"
        const namePart = line.split(/[-|,]/)[0].trim();
        if (!namePart) { skipped++; continue; }
        records.push({ name: namePart, designation, department: null, email: null, phone: null });
    }

    return { records, skipped };
}

async function parseClassroomsPdf(buffer) {
    const lines = await parsePdfBuffer(buffer);
    const records = [];
    let skipped = 0;
    const roomLinePattern = /([A-Za-z0-9\-\/]+)\s+(\d{1,4})\s*$/;

    for (const line of lines) {
        const match = line.match(roomLinePattern);
        if (!match) { skipped++; continue; }
        const capacity = parseInt(match[2], 10);
        if (!capacity) { skipped++; continue; }
        records.push({ roomNo: match[1], capacity, building: null });
    }

    return { records, skipped };
}

// ---------- Public dispatch ----------

async function parseImportFile({ buffer, mimetype, originalname, importType }) {
    const isPdf = mimetype === 'application/pdf' || /\.pdf$/i.test(originalname);
    const isExcel = /\.(xlsx|xls)$/i.test(originalname) || mimetype.includes('sheet') || mimetype.includes('excel');

    if (isExcel) {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        switch (importType) {
            case 'faculty': return parseFacultyExcel(workbook);
            case 'classrooms': return parseClassroomsExcel(workbook);
            case 'exam_rooms': return parseExamRoomsExcel(workbook);
            case 'workload': return parseWorkloadExcel(workbook);
            case 'timetable': return parseTimetableExcel(workbook);
            default: throw new Error(`Unknown importType: ${importType}`);
        }
    }

    if (isPdf) {
        switch (importType) {
            case 'faculty': return parseFacultyPdf(buffer);
            case 'classrooms': return parseClassroomsPdf(buffer);
            default: throw new Error(`PDF import not supported for type: ${importType}. Please use Excel.`);
        }
    }

    throw new Error('Unsupported file type. Please upload .xlsx or .pdf');
}

module.exports = { parseImportFile };
