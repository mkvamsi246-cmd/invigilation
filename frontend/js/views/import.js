const IMPORT_TYPES = [
    {
        key:   'timetable',
        label: 'Faculty Weekly Timetable',
        hint:  'Upload the "Individual Load" sheet as-is (one block per faculty: name row, period header row, Mon–Sat rows). Import Faculty first — names must match exactly.',
        note:  'This prevents faculty from being double-booked during their classes/labs.',
    },
    {
        key:   'faculty',
        label: 'Faculty List',
        hint:  'Columns: Name, Designation (Professor / Associate Professor / Assistant Professor), Department, Email, Priority (optional — lower number = assigned first)',
        note:  'Priority defaults to 1 for Professor, 2 for Associate Professor, 3 for Assistant Professor if not provided.',
    },
    {
        key:   'classrooms',
        label: 'Classrooms',
        hint:  'Columns: Room No, Building (optional), Capacity',
        note:  'Rooms with the same Room No will be updated (upsert).',
    },
    {
        key:   'exam_rooms',
        label: 'Exam Room Allocation',
        hint:  'Columns: Exam Name, Date, Session (FN/AN), Room No, Students Count',
        note:  'Rooms must already exist in Classrooms. Faculty Required = ceil(Students / 24).',
    },
];

async function renderImport(container) {
    container.innerHTML = `
        <div class="panel">
            <h3 class="panel-title">Import from Excel or PDF</h3>
            <p style="font-size:12.5px;color:var(--gray-600);">
                Excel (.xlsx) is recommended for reliable column matching. PDF import works for simple faculty/room lists
                but Excel gives more accurate results.
                <br><strong>Recommended order:</strong> Timetable → Faculty → Classrooms → Exam Rooms.
            </p>
        </div>
        ${IMPORT_TYPES.map((t) => `
            <div class="panel">
                <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:6px;">
                    <h3 class="panel-title" style="margin:0;">${t.label}</h3>
                    <a href="/api/templates/${t.key}"
                       download
                       class="btn btn-sm"
                       style="font-size:12px;padding:4px 12px;white-space:nowrap;"
                       title="Download a sample Excel file showing the expected format">
                        📥 Download Sample
                    </a>
                </div>
                <p style="font-size:12.5px;color:var(--gray-600);margin:0 0 4px;">
                    <strong>Columns:</strong> ${t.hint}
                </p>
                <p style="font-size:11.5px;color:var(--gray-500);margin:0 0 10px;">
                    💡 ${t.note}
                </p>
                <div class="dropzone" data-dropzone="${t.key}">
                    <input type="file" accept=".xlsx,.xls,.pdf" style="display:none;" data-file-input="${t.key}">
                    Click to choose a file, or drag one here (.xlsx recommended)
                </div>
                <div id="result-${t.key}" style="margin-top:10px;"></div>
            </div>
        `).join('')}
    `;

    IMPORT_TYPES.forEach((t) => {
        const zone  = container.querySelector(`[data-dropzone="${t.key}"]`);
        const input = container.querySelector(`[data-file-input="${t.key}"]`);

        zone.addEventListener('click', () => input.click());
        zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.style.borderColor = '#111'; });
        zone.addEventListener('dragleave', () => { zone.style.borderColor = ''; });
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.style.borderColor = '';
            if (e.dataTransfer.files.length) handleUpload(t.key, e.dataTransfer.files[0]);
        });
        input.addEventListener('change', () => {
            if (input.files.length) handleUpload(t.key, input.files[0]);
        });
    });

    async function handleUpload(type, file) {
        const resultEl = document.getElementById(`result-${type}`);
        resultEl.innerHTML = '<p class="empty-state">Uploading and parsing…</p>';
        const fd = new FormData();
        fd.append('file', file);
        try {
            const res = await api.upload(`/upload/${type}`, fd);
            resultEl.innerHTML = `<p class="badge badge-ok">✓ Imported ${res.imported} of ${res.total} rows${res.skipped ? ` (${res.skipped} skipped — check headers match the sample)` : ''}</p>`
                + (res.warning ? `<p class="badge badge-danger" style="margin-top:6px;display:block;width:fit-content;">⚠ ${escapeHtml(res.warning)}</p>` : '');
            showToast(`${file.name}: ${res.imported} rows imported`);
        } catch (err) {
            resultEl.innerHTML = `<p class="badge badge-danger">${escapeHtml(err.message)}</p>`;
        }
    }
}
