async function renderGenerate(container) {
    const exams = await api.get('/exams');

    container.innerHTML = `
        <div class="panel">
            <h3 class="panel-title">Select Exam Session</h3>
            <div class="row">
                <div class="field">
                    <label class="field-label">Exam Session</label>
                    <select class="input" id="session-select">
                        <option value="">— select —</option>
                        ${exams.map((e) => `<option value="${e.id}">${escapeHtml(e.exam_name)} — ${escapeHtml(String(e.exam_date).slice(0,10))} (${escapeHtml(e.session)})</option>`).join('')}
                    </select>
                </div>
                <button class="btn btn-primary" id="generate-btn" disabled>Generate Draft</button>
                <a class="btn" id="export-excel-btn" style="display:none;">Export Excel</a>
                <a class="btn" id="export-pdf-btn"   style="display:none;">Export PDF</a>
            </div>
            <p style="font-size:12.5px;color:var(--gray-600);margin-top:10px;">
                <strong>Step 1 — Generate Draft:</strong> Preview proposed assignments (faculty ordered by their priority number, then duty count). Nothing is saved yet.<br>
                <strong>Step 2 — Finalize &amp; Save:</strong> Review and click <em>Finalize</em> to commit. Use <em>Download Draft Emails</em> to get email templates for each invigilator.
            </p>
        </div>
        <div id="duty-result"></div>
    `;

    const select      = document.getElementById('session-select');
    const generateBtn = document.getElementById('generate-btn');
    const excelBtn    = document.getElementById('export-excel-btn');
    const pdfBtn      = document.getElementById('export-pdf-btn');

    select.addEventListener('change', () => {
        const sid = select.value;
        generateBtn.disabled = !sid;
        if (sid) {
            excelBtn.style.display = 'inline-block';
            pdfBtn.style.display   = 'inline-block';
            excelBtn.href = `/api/allocation/export/${sid}/excel`;
            pdfBtn.href   = `/api/allocation/export/${sid}/pdf`;
            loadSavedDutyChart(sid);
        } else {
            excelBtn.style.display = 'none';
            pdfBtn.style.display   = 'none';
            document.getElementById('duty-result').innerHTML = '';
        }
    });

    // ── STEP 1: Generate Draft (preview only — nothing saved) ──────────
    generateBtn.addEventListener('click', async () => {
        const sid = select.value;
        if (!sid) return;
        generateBtn.disabled = true;
        generateBtn.textContent = 'Generating…';
        try {
            const preview = await api.post(`/allocation/preview/${sid}`, {});
            showPreviewChart(sid, preview);
        } catch (err) {
            showToast(err.message, true);
        } finally {
            generateBtn.disabled = false;
            generateBtn.textContent = 'Generate Draft';
        }
    });

    // ── PREVIEW chart ─────────────────────────────────────────────────
    function showPreviewChart(sid, preview) {
        const resultEl = document.getElementById('duty-result');

        const shortfallHtml = preview.shortfalls.length > 0
            ? `<div style="background:#fff3cd;border:1px solid #ffc107;border-radius:6px;padding:10px 14px;margin-bottom:12px;">
                   <strong>⚠ Shortfall in ${preview.shortfalls.length} room(s):</strong>
                   ${preview.shortfalls.map(s => `${escapeHtml(s.roomNo)}: need ${s.required}, only ${s.assigned} available`).join(' &nbsp;|&nbsp; ')}
               </div>` : '';

        // Build table rows with rowspan grouping
        let tableRows = '';
        preview.rooms.forEach(room => {
            if (room.assignees.length === 0) {
                tableRows += `<tr>
                    <td rowspan="1"><strong>${escapeHtml(room.roomNo)}</strong></td>
                    <td>${room.studentsCount}</td>
                    <td>${room.facultyRequired}</td>
                    <td colspan="3" style="color:#dc2626;font-weight:600;">No eligible faculty</td>
                </tr>`;
                return;
            }
            room.assignees.forEach((a, i) => {
                const priColor = a.priority <= 1 ? '#7c3aed' : a.priority <= 2 ? '#2563eb' : a.priority <= 3 ? '#16a34a' : 'var(--gray-600)';
                tableRows += `<tr>
                    ${i === 0
                        ? `<td rowspan="${room.assignees.length}" style="vertical-align:middle;font-weight:600;">
                               ${escapeHtml(room.roomNo)}<br>
                               <small style="color:var(--gray-500);font-weight:400;">${room.studentsCount} students</small>
                           </td>
                           <td rowspan="${room.assignees.length}" style="vertical-align:middle;text-align:center;">${room.facultyRequired}</td>`
                        : ''}
                    <td>
                        <span style="background:${priColor};color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:10px;margin-right:5px;">${a.priority}</span>
                        ${escapeHtml(a.name)}
                    </td>
                    <td>${formatDesignation(a.designation)}</td>
                    <td style="color:var(--gray-500);font-size:12px;">${a.currentDutyCount} duties so far</td>
                </tr>`;
            });
        });

        resultEl.innerHTML = `
            <div class="panel" style="border:2px dashed #f59e0b;border-radius:10px;">
                <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:14px;">
                    <div>
                        <h3 class="panel-title" style="margin:0 0 4px;">
                            📋 Draft Duty Chart
                            <span style="background:#f59e0b;color:#fff;font-size:11px;font-weight:700;padding:2px 9px;border-radius:4px;margin-left:8px;vertical-align:middle;">PREVIEW — NOT SAVED</span>
                        </h3>
                        <p style="margin:0;font-size:12.5px;color:var(--gray-600);">
                            ${preview.totalAssigned} duties proposed across ${preview.rooms.length} rooms.
                            Faculty ordered by <strong>priority number</strong> (↓ lower = first), then duty count for fairness.
                        </p>
                    </div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <button class="btn btn-primary" id="finalize-btn">✓ Finalize &amp; Save</button>
                        <button class="btn" id="discard-btn">✗ Discard Draft</button>
                    </div>
                </div>
                ${shortfallHtml}
                <div class="table-wrap">
                    <table>
                        <thead><tr>
                            <th>Room</th><th>Required</th>
                            <th>Proposed Invigilator <small style="font-weight:400;color:var(--gray-400);">(priority badge)</small></th>
                            <th>Designation</th><th>Duty History</th>
                        </tr></thead>
                        <tbody>${tableRows}</tbody>
                    </table>
                </div>
            </div>`;

        // STEP 2a: Finalize
        document.getElementById('finalize-btn').addEventListener('click', async () => {
            const btn = document.getElementById('finalize-btn');
            btn.disabled = true;
            btn.textContent = 'Saving…';
            try {
                const result = await api.post(`/allocation/generate/${sid}`, {});
                showToast(`✓ Finalized! ${result.totalAssigned} duties saved across ${result.roomsProcessed} rooms.`);
                if (result.shortfalls && result.shortfalls.length > 0) {
                    showToast(`⚠ ${result.shortfalls.length} room(s) had shortfalls.`, true);
                }
                await loadSavedDutyChart(sid);
            } catch (err) {
                showToast(err.message, true);
                btn.disabled = false;
                btn.textContent = '✓ Finalize & Save';
            }
        });

        // STEP 2b: Discard
        document.getElementById('discard-btn').addEventListener('click', () => {
            resultEl.innerHTML = '<p class="empty-state">Draft discarded. Click <strong>Generate Draft</strong> again to create a new one.</p>';
        });
    }

    // ── Load FINALIZED duty chart ──────────────────────────────────────
    async function loadSavedDutyChart(sid) {
        const [duties, availableFaculty, examsData] = await Promise.all([
            api.get(`/exams/${sid}/duties`),
            api.get(`/allocation/available/${sid}`),
            api.get('/exams'),
        ]);
        const resultEl = document.getElementById('duty-result');

        if (duties.length === 0) {
            resultEl.innerHTML = '<p class="empty-state">No duties finalized for this session yet. Click <strong>Generate Draft</strong> to start.</p>';
            return;
        }

        const sessionInfo = examsData.find(e => String(e.id) === String(sid));
        const sessionLabel = sessionInfo
            ? `${sessionInfo.exam_name} — ${String(sessionInfo.exam_date).slice(0,10)} (${sessionInfo.session})`
            : `Session #${sid}`;

        // Group by room preserving order
        const roomMap = new Map();
        for (const d of duties) {
            if (!roomMap.has(d.room_no)) {
                roomMap.set(d.room_no, { required: d.faculty_required, entries: [] });
            }
            if (d.duty_id) roomMap.get(d.room_no).entries.push(d);
        }

        let tableRows = '';
        for (const [room, info] of roomMap) {
            if (info.entries.length === 0) {
                tableRows += `<tr>
                    <td><strong>${escapeHtml(room)}</strong></td>
                    <td style="text-align:center;">${info.required}</td>
                    <td colspan="3" style="color:#dc2626;font-weight:600;">Unassigned</td>
                </tr>`;
                continue;
            }
            info.entries.forEach((e, i) => {
                tableRows += `<tr>
                    ${i === 0
                        ? `<td rowspan="${info.entries.length}" style="vertical-align:middle;font-weight:600;">
                               ${escapeHtml(room)}<br>
                               <small style="color:var(--gray-500);font-weight:400;">Required: ${info.required}</small>
                           </td>`
                        : ''}
                    <td>${escapeHtml(e.faculty_name)}</td>
                    <td>${formatDesignation(e.designation)}</td>
                    <td>
                        <span class="badge badge-ok" style="font-size:11px;">${e.status}</span>
                    </td>
                    <td style="white-space:nowrap;">
                        <select class="input" style="width:auto;font-size:12px;display:inline-block;padding:3px 6px;height:28px;" data-reassign="${e.duty_id}">
                             <option value="">Reassign…</option>
                             ${availableFaculty.map(f =>
                                 `<option value="${f.id}">[P${f.priority}] ${escapeHtml(f.name)} (${f.duty_count} duties)</option>`
                             ).join('')}
                         </select>
                        <button class="btn btn-sm btn-danger" data-cancel-duty="${e.duty_id}" style="margin-left:4px;">Cancel</button>
                    </td>
                </tr>`;
            });
        }

        resultEl.innerHTML = `
            <div class="panel" style="border:2px solid #22c55e;border-radius:10px;">
                <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:16px;">
                    <div>
                        <h3 class="panel-title" style="margin:0 0 4px;">
                            ✅ Finalized Duty Chart
                            <span style="background:#22c55e;color:#fff;font-size:11px;font-weight:700;padding:2px 9px;border-radius:4px;margin-left:8px;vertical-align:middle;">SAVED</span>
                        </h3>
                        <p style="margin:0;font-size:12.5px;color:var(--gray-600);">${escapeHtml(sessionLabel)}</p>
                    </div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <button class="btn btn-primary" id="regenerate-btn">↺ Re-generate Draft</button>
                        <button class="btn" id="download-emails-btn">📧 Download Draft Emails</button>
                    </div>
                </div>
                <div class="table-wrap">
                    <table>
                        <thead><tr>
                            <th>Room</th><th>Invigilator</th><th>Designation</th><th>Status</th><th>Actions</th>
                        </tr></thead>
                        <tbody>${tableRows}</tbody>
                    </table>
                </div>
            </div>`;

        // Re-generate
        document.getElementById('regenerate-btn').addEventListener('click', () => generateBtn.click());

        // Download draft emails
        document.getElementById('download-emails-btn').addEventListener('click', () => {
            downloadDraftEmails(duties, sessionLabel);
        });

        // Reassign
        resultEl.querySelectorAll('[data-reassign]').forEach((sel) => {
            sel.addEventListener('change', async () => {
                if (!sel.value) return;
                const selValue = sel.value;
                const dutyId = sel.dataset.reassign;
                try {
                    await api.put(`/allocation/duty/${dutyId}/reassign`, { faculty_id: selValue });
                    showToast('Duty reassigned');
                    loadSavedDutyChart(sid);
                } catch (err) {
                    showToast(err.message, true);
                    sel.value = '';
                }
            });
        });

        // Cancel duty
        resultEl.querySelectorAll('[data-cancel-duty]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                if (!confirm('Cancel this duty assignment?')) return;
                try {
                    await api.del(`/allocation/duty/${btn.dataset.cancelDuty}`);
                    showToast('Duty cancelled');
                    loadSavedDutyChart(sid);
                } catch (err) {
                    showToast(err.message, true);
                }
            });
        });
    }

    // ── Download Draft Emails ──────────────────────────────────────────
    function downloadDraftEmails(duties, sessionLabel) {
        if (duties.length === 0) { showToast('No duties to generate emails for', true); return; }

        // Group duties by faculty
        const byFaculty = new Map();
        for (const d of duties) {
            if (!d.duty_id) continue;
            if (!byFaculty.has(d.faculty_name)) {
                byFaculty.set(d.faculty_name, { designation: d.designation, rooms: [] });
            }
            byFaculty.get(d.faculty_name).rooms.push(d.room_no);
        }

        let emailsText = `INVIGILATION DUTY DRAFT EMAILS\n`;
        emailsText += `Session: ${sessionLabel}\n`;
        emailsText += `Generated: ${new Date().toLocaleString()}\n`;
        emailsText += `${'='.repeat(70)}\n\n`;

        for (const [name, info] of byFaculty) {
            const roomList = info.rooms.join(', ');
            emailsText += `TO      : [${escapeHtml(name)}'s email address]\n`;
            emailsText += `SUBJECT : Invigilation Duty Assignment — ${sessionLabel}\n`;
            emailsText += `\n`;
            emailsText += `Dear ${name},\n\n`;
            emailsText += `You have been assigned invigilation duty for the following examination session:\n\n`;
            emailsText += `  Exam Session : ${sessionLabel}\n`;
            emailsText += `  Room(s)      : ${roomList}\n\n`;
            emailsText += `Please report to your assigned room 15 minutes before the examination begins.\n\n`;
            emailsText += `Kindly acknowledge receipt of this email.\n\n`;
            emailsText += `Regards,\nExamination Coordinator\n`;
            emailsText += `\n${'-'.repeat(70)}\n\n`;
        }

        // Trigger download as .txt
        const blob = new Blob([emailsText], { type: 'text/plain;charset=utf-8' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `draft_emails_${sessionLabel.replace(/[^a-z0-9]/gi, '_').slice(0, 40)}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('Draft emails downloaded');
    }
}
