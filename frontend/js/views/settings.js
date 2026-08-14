async function renderSettings(container) {
    const settings = await api.get('/allocation/settings');
    const labels = {
        assistant_professor: 'Assistant Professor',
        associate_professor: 'Associate Professor',
        professor: 'Professor',
    };

    container.innerHTML = `
        <div class="panel">
            <h3 class="panel-title">Duty Priority Order</h3>
            <p style="font-size:12.5px;color:var(--gray-600);">
                Faculty in the first tier are assigned duties before the next tier. Within the same tier,
                whoever has the fewest duties so far is picked first, so load stays balanced.
            </p>
            <ol id="priority-list" style="padding-left:20px;">
                ${settings.priorityOrder.map((d, i) => `
                    <li style="margin:6px 0;display:flex;align-items:center;gap:8px;">
                        <span style="flex:1;">${labels[d] || d}</span>
                        <button class="btn btn-sm" data-move="up" data-idx="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
                        <button class="btn btn-sm" data-move="down" data-idx="${i}" ${i === settings.priorityOrder.length - 1 ? 'disabled' : ''}>↓</button>
                    </li>
                `).join('')}
            </ol>
        </div>

        <div class="panel">
            <h3 class="panel-title">Students per Faculty</h3>
            <div class="row">
                <div class="field">
                    <label class="field-label">Students per invigilator</label>
                    <input class="input" id="ratio-input" type="number" min="1" value="${settings.studentsPerFaculty}">
                </div>
                <button class="btn btn-primary" id="save-settings-btn">Save Settings</button>
            </div>
        </div>

        <div class="panel">
            <h3 class="panel-title">Session → Period Mapping</h3>
            <p style="font-size:12.5px;color:var(--gray-600);">
                Which timetable periods each exam session overlaps. A faculty member with a class or lab
                in any of these periods that weekday is automatically excluded from duty for that session.
            </p>
            <div class="row">
                <div class="field">
                    <label class="field-label">Forenoon (FN) periods</label>
                    <input class="input" id="fn-periods" value="${(settings.sessionPeriods.FN || []).join(', ')}" placeholder="e.g. 1, 2, 3, 4">
                </div>
                <div class="field">
                    <label class="field-label">Afternoon (AN) periods</label>
                    <input class="input" id="an-periods" value="${(settings.sessionPeriods.AN || []).join(', ')}" placeholder="e.g. 5, 6, 7, 8">
                </div>
            </div>
        </div>
    `;

    let order = [...settings.priorityOrder];

    function rerenderList() {
        document.getElementById('priority-list').innerHTML = order.map((d, i) => `
            <li style="margin:6px 0;display:flex;align-items:center;gap:8px;">
                <span style="flex:1;">${labels[d] || d}</span>
                <button class="btn btn-sm" data-move="up" data-idx="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
                <button class="btn btn-sm" data-move="down" data-idx="${i}" ${i === order.length - 1 ? 'disabled' : ''}>↓</button>
            </li>
        `).join('');
        attachMoveHandlers();
    }

    function attachMoveHandlers() {
        container.querySelectorAll('[data-move]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const idx = Number(btn.dataset.idx);
                const dir = btn.dataset.move === 'up' ? -1 : 1;
                const swapIdx = idx + dir;
                [order[idx], order[swapIdx]] = [order[swapIdx], order[idx]];
                rerenderList();
            });
        });
    }
    attachMoveHandlers();

    document.getElementById('save-settings-btn').addEventListener('click', async () => {
        const parseList = (str) => str.split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
        try {
            await api.put('/allocation/settings', {
                priorityOrder: order,
                studentsPerFaculty: Number(document.getElementById('ratio-input').value),
                sessionPeriods: {
                    FN: parseList(document.getElementById('fn-periods').value),
                    AN: parseList(document.getElementById('an-periods').value),
                },
            });
            showToast('Settings saved');
        } catch (err) {
            showToast(err.message, true);
        }
    });
}
