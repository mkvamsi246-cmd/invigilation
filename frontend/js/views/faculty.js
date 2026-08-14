async function renderFaculty(container) {
    const faculty = await api.get('/faculty');

    container.innerHTML = `
        <div class="panel">
            <h3 class="panel-title">Add Faculty</h3>
            <form id="faculty-form" class="row">
                <div class="field"><label class="field-label">Name</label><input class="input" name="name" required></div>
                <div class="field">
                    <label class="field-label">Designation</label>
                    <select class="input" name="designation" id="desig-select" required>
                        <option value="assistant_professor">Assistant Professor</option>
                        <option value="associate_professor">Associate Professor</option>
                        <option value="professor">Professor</option>
                    </select>
                </div>
                <div class="field"><label class="field-label">Department</label><input class="input" name="department"></div>
                <div class="field"><label class="field-label">Email</label><input class="input" name="email" type="email"></div>
                <div class="field" style="max-width:110px;">
                    <label class="field-label" title="Lower number = assigned first. Default: Professor=1, Assoc=2, Asst=3">
                        Priority <span style="font-size:10px;color:var(--gray-500);">↓ lower = first</span>
                    </label>
                    <input class="input" name="priority" id="priority-input" type="number" min="1" max="99" value="3">
                </div>
                <div class="field" style="max-width:110px;">
                    <label class="field-label">Duty Count <span style="font-size:10px;color:var(--gray-500);">(prior)</span></label>
                    <input class="input" name="duty_count" type="number" min="0" value="0">
                </div>
                <button class="btn btn-primary" type="submit">Add</button>
            </form>
        </div>

        <div class="panel">
            <h3 class="panel-title">All Faculty (${faculty.length})</h3>
            <p style="font-size:12px;color:var(--gray-500);margin:-6px 0 10px;">
                <strong>Priority</strong>: lower number = assigned first. Professors default to 1, Associate to 2, Assistant to 3. Override per-person as needed.
            </p>
            ${faculty.length === 0 ? '<p class="empty-state">No faculty added yet.</p>' : `
            <div class="table-wrap">
                <table>
                    <thead><tr>
                        <th>Name</th><th>Designation</th><th>Dept</th>
                        <th>Priority <span style="font-weight:400;font-size:10px;">↓ lower = first</span></th>
                        <th>Duty Count</th>
                        <th>Status</th><th></th>
                    </tr></thead>
                    <tbody>${faculty.map(facultyRow).join('')}</tbody>
                </table>
            </div>`}
        </div>
    `;

    // Auto-set default priority when designation changes
    document.getElementById('desig-select').addEventListener('change', (e) => {
        const defaults = { professor: 1, associate_professor: 2, assistant_professor: 3 };
        document.getElementById('priority-input').value = defaults[e.target.value] || 3;
    });

    // ── Add faculty ───────────────────────────────────────────────────
    document.getElementById('faculty-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const data = Object.fromEntries(fd);
        data.duty_count = parseInt(data.duty_count, 10) || 0;
        data.priority   = parseInt(data.priority, 10)   || 3;
        try {
            await api.post('/faculty', data);
            showToast('Faculty added');
            renderFaculty(container);
        } catch (err) {
            showToast(err.message, true);
        }
    });

    // ── Activate / Deactivate ─────────────────────────────────────────
    container.querySelectorAll('[data-toggle-active]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.toggleActive;
            try {
                await api.put(`/faculty/${id}`, { is_active: btn.dataset.isActive !== 'true' });
                renderFaculty(container);
            } catch (err) { showToast(err.message, true); }
        });
    });

    // ── Delete ────────────────────────────────────────────────────────
    container.querySelectorAll('[data-delete-faculty]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            if (!confirm('Remove this faculty member?')) return;
            try {
                await api.del(`/faculty/${btn.dataset.deleteFaculty}`);
                showToast('Faculty removed');
                renderFaculty(container);
            } catch (err) { showToast(err.message, true); }
        });
    });

    // ── Priority save ─────────────────────────────────────────────────
    container.querySelectorAll('button[data-save-pri]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const id  = btn.dataset.savePri;
            const inp = container.querySelector(`input[data-pri="${id}"]`);
            const val = parseInt(inp.value, 10);
            if (isNaN(val) || val < 1) { showToast('Priority must be ≥ 1', true); inp.focus(); return; }
            btn.textContent = '…'; btn.disabled = true;
            try {
                await api.put(`/faculty/${id}`, { priority: val });
                showToast('Priority saved');
                renderFaculty(container);
            } catch (err) {
                showToast(err.message, true);
                btn.textContent = '✓'; btn.disabled = false;
            }
        });
    });

    // ── Duty count save ───────────────────────────────────────────────
    container.querySelectorAll('button[data-save-dc]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const id  = btn.dataset.saveDc;
            const inp = container.querySelector(`input[data-dc="${id}"]`);
            const val = parseInt(inp.value, 10);
            if (isNaN(val) || val < 0) { showToast('Enter a valid non-negative number', true); inp.focus(); return; }
            btn.textContent = '…'; btn.disabled = true;
            try {
                await api.patch(`/faculty/${id}/duty-count`, { duty_count: val });
                showToast('Duty count saved');
                renderFaculty(container);
            } catch (err) {
                showToast(err.message, true);
                btn.textContent = '✓'; btn.disabled = false;
            }
        });
    });

    // Enter key on either input
    container.querySelectorAll('input[data-pri]').forEach((inp) => {
        inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); container.querySelector(`button[data-save-pri="${inp.dataset.pri}"]`).click(); }
        });
    });
    container.querySelectorAll('input[data-dc]').forEach((inp) => {
        inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); container.querySelector(`button[data-save-dc="${inp.dataset.dc}"]`).click(); }
        });
    });
}

function facultyRow(f) {
    const priColor = f.priority <= 1 ? '#7c3aed' : f.priority <= 2 ? '#2563eb' : f.priority <= 3 ? '#16a34a' : 'var(--gray-600)';
    return `
        <tr>
            <td><strong>${escapeHtml(f.name)}</strong></td>
            <td>${formatDesignation(f.designation)}</td>
            <td>${escapeHtml(f.department || '—')}</td>
            <td>
                <div style="display:flex;align-items:center;gap:5px;">
                    <span style="background:${priColor};color:#fff;font-size:11px;font-weight:700;padding:1px 7px;border-radius:12px;min-width:22px;text-align:center;">${f.priority}</span>
                    <input data-pri="${f.id}" type="number" min="1" max="99" value="${f.priority}" class="input"
                        style="width:58px;padding:3px 6px;height:28px;font-size:13px;">
                    <button data-save-pri="${f.id}" class="btn btn-sm btn-primary"
                        style="height:28px;padding:3px 8px;font-size:12px;" title="Save priority">✓</button>
                </div>
            </td>
            <td>
                <div style="display:flex;align-items:center;gap:5px;">
                    <input data-dc="${f.id}" type="number" min="0" value="${f.duty_count}" class="input"
                        style="width:58px;padding:3px 6px;height:28px;font-size:13px;">
                    <button data-save-dc="${f.id}" class="btn btn-sm btn-primary"
                        style="height:28px;padding:3px 8px;font-size:12px;" title="Save duty count">✓</button>
                </div>
            </td>
            <td>${f.is_active
                ? '<span class="badge badge-ok">Active</span>'
                : '<span class="badge badge-neutral">Inactive</span>'}</td>
            <td>
                <button class="btn btn-sm" data-toggle-active="${f.id}" data-is-active="${f.is_active}">
                    ${f.is_active ? 'Deactivate' : 'Activate'}
                </button>
                <button class="btn btn-sm btn-danger" data-delete-faculty="${f.id}">Delete</button>
            </td>
        </tr>
    `;
}
