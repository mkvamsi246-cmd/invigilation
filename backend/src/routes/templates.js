const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const XLSX    = require('xlsx');

// Map import-type keys to the pre-built template files in backend/templates/
const TEMPLATE_FILES = {
    faculty:    'Faculty_Master_Template.xlsx',
    classrooms: 'Classroom_Master_Template.xlsx',
    exam_rooms: 'Exam_Room_Allocation_Template.xlsx',
    timetable:  'Faculty_Timetable_Template.xlsx',
    workload:   null, // generated inline (no pre-built template file)
};

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

/**
 * GET /api/templates/:type
 * Returns a downloadable sample Excel file for the given import type.
 * No authentication required so users can download before even logging in,
 * but in practice the frontend only shows these buttons when logged in.
 */
router.get('/:type', (req, res) => {
    const { type } = req.params;

    if (!(type in TEMPLATE_FILES)) {
        return res.status(404).json({ error: `No template for type: ${type}` });
    }

    const fileName = TEMPLATE_FILES[type];

    // workload — build a simple inline sample workbook on the fly
    if (!fileName) {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([
            ['Faculty Name', 'Total'],
            ['Dr. A Kumar',  5],
            ['Prof. B Rao',  3],
            ['Dr. C Reddy',  7],
        ]);
        ws['!cols'] = [{ wch: 30 }, { wch: 12 }];
        XLSX.utils.book_append_sheet(wb, ws, 'Work Load');
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="Workload_Template.xlsx"');
        return res.send(buf);
    }

    const filePath = path.join(TEMPLATES_DIR, fileName);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: `Template file not found: ${fileName}` });
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.sendFile(filePath);
});

module.exports = router;
