async function renderExams(container) {
    const exams = await api.get('/exams');

    container.innerHTML = `
        <div class="panel">
            <h3 class="panel-title">Add Exam Session</h3>
            <form id="exam-form" class="row">
                <div class="field"><label class="field-label">Exam Name</label><input class="input" name="exam_name" required placeholder="e.g. Mid-1 DBMS"></div>
                <div class="field"><label class="field-label">Date</label><input class="input" name="exam_date" type="date" required></div>
                <div class="field">
                    <label class="field-label">Session</label>
                    <select class="input" name="session">
                        <option value="FN">Forenoon (FN)</option>
                        <option value="AN">Afternoon (AN)</option>
                    </select>
                </div>
                <div class="field" style="max-width:130px;">
                    <label class="field-label">Start Time <span style="font-size:10px;color:var(--gray-500);">(optional)</span></label>
                    <input class="input" name="start_time" type="time" placeholder="09:30">
                </div>
                <div class="field" style="max-width:130px;">
                    <label class="field-label">End Time <span style="font-size:10px;color:var(--gray-500);">(optional)</span></label>
                    <input class="input" name="end_time" type="time" placeholder="12:30">
                </div>
                <button class="btn btn-primary" type="submit">Add</button>
            </form>
        </div>

        <div class="panel">
            <h3 class="panel-title">Exam Sessions (${exams.length})</h3>
            ${exams.length === 0 ? '<p class="empty-state">No exam sessions yet.</p>' : `
            <div class="table-wrap">
                <table>
                    <thead><tr><th>Exam</th><th>Date</th><th>Session</th><th>Time</th><th></th></tr></thead>
                    <tbody>
                        ${exams.map((e) => `
                            <tr>
                                <td>${escapeHtml(e.exam_name)}</td>
                                <td>${escapeHtml(String(e.exam_date).slice(0,10))}</td>
                                <td>${escapeHtml(e.session)}</td>
                                <td style="font-size:12px;color:var(--gray-500);">
                                    ${e.start_time ? `${e.start_time}` : '—'}
                                    ${e.start_time && e.end_time ? ' → ' : ''}
                                    ${e.end_time ? `${e.end_time}` : ''}
                                </td>
                                <td>
                                    <button class="btn btn-sm" data-manage-rooms="${e.id}">Manage Rooms</button>
                                    <button class="btn btn-sm btn-danger" data-delete-exam="${e.id}">Delete</button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>`}
        </div>

        <div id="room-panel"></div>
    `;

    document.getElementById('exam-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const data = Object.fromEntries(fd);
        // Remove empty optional time fields so the backend doesn't receive empty strings
        if (!data.start_time) delete data.start_time;
        if (!data.end_time)   delete data.end_time;
        try {
            await api.post('/exams', data);
            showToast('Exam session added');
            renderExams(container);
        } catch (err) {
            showToast(err.message, true);
        }
    });

    container.querySelectorAll('[data-delete-exam]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            if (!confirm('Delete this exam session and all its room/duty data?')) return;
            try {
                await api.del(`/exams/${btn.dataset.deleteExam}`);
                showToast('Exam session deleted');
                renderExams(container);
            } catch (err) {
                showToast(err.message, true);
            }
        });
    });

    container.querySelectorAll('[data-manage-rooms]').forEach((btn) => {
        btn.addEventListener('click', () => renderRoomPanel(btn.dataset.manageRooms));
    });

    async function renderRoomPanel(examSessionId) {
        const panel = document.getElementById('room-panel');
        panel.innerHTML = '<p class="empty-state">Loading rooms…</p>';
        const [rooms, classrooms] = await Promise.all([
            api.get(`/exams/${examSessionId}/rooms`),
            api.get('/classrooms'),
        ]);

        panel.innerHTML = `
            <div class="panel">
                <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
                    <h3 class="panel-title" style="margin:0;">Rooms for this Exam Session</h3>
                    <a href="/api/templates/exam_rooms"
                       download
                       class="btn btn-sm"
                       style="font-size:12px;padding:4px 12px;"
                       title="Download a sample Excel file for bulk room allocation upload">
                        📥 Download Sample (Bulk Upload)
                    </a>
                </div>
                <p style="font-size:12px;color:var(--gray-500);margin:-6px 0 12px;">
                    Faculty required is automatically computed as <strong>ceil(Students ÷ 24)</strong>. Add rooms one-by-one below, or bulk-upload via <em>Import Data → Exam Room Allocation</em>.
                </p>
                <form id="room-alloc-form" class="row">
                    <div class="field">
                        <label class="field-label">Classroom</label>
                        <select class="input" name="classroom_id" required>
                            ${classrooms.length === 0
                                ? '<option value="">— No classrooms yet —</option>'
                                : classrooms.map((c) => `<option value="${c.id}">${escapeHtml(c.room_no)} (cap ${c.capacity})</option>`).join('')}
                        </select>
                    </div>
                    <div class="field"><label class="field-label">Students Sitting</label><input class="input" name="students_count" type="number" min="0" required></div>
                    <button class="btn btn-primary" type="submit" ${classrooms.length === 0 ? 'disabled' : ''}>Add Room</button>
                </form>

                ${rooms.length === 0 ? '<p class="empty-state">No rooms allocated to this session yet.</p>' : `
                <div class="table-wrap" style="margin-top:16px;">
                    <table>
                        <thead><tr><th>Room</th><th>Students</th><th>Faculty Required</th><th></th></tr></thead>
                        <tbody>
                            ${rooms.map((r) => `
                                <tr>
                                    <td>${escapeHtml(r.room_no)}</td>
                                    <td>${r.students_count}</td>
                                    <td>
                                        ${r.faculty_required}
                                        <small style="color:var(--gray-500);font-size:11px;">
                                            (= ceil(${r.students_count} ÷ 24))
                                        </small>
                                    </td>
                                    <td><button class="btn btn-sm btn-danger" data-delete-alloc="${r.id}">Remove</button></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>`}
            </div>
        `;

        document.getElementById('room-alloc-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            try {
                await api.post(`/exams/${examSessionId}/rooms`, Object.fromEntries(fd));
                showToast('Room added to session');
                renderRoomPanel(examSessionId);
            } catch (err) {
                showToast(err.message, true);
            }
        });

        panel.querySelectorAll('[data-delete-alloc]').forEach((b) => {
            b.addEventListener('click', async () => {
                try {
                    await api.del(`/exams/rooms/${b.dataset.deleteAlloc}`);
                    renderRoomPanel(examSessionId);
                } catch (err) {
                    showToast(err.message, true);
                }
            });
        });
    }
}
