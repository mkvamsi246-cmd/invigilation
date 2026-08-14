async function renderDashboard(container) {
    const [faculty, classrooms, exams] = await Promise.all([
        api.get('/faculty'),
        api.get('/classrooms'),
        api.get('/exams'),
    ]);

    const activeFaculty = faculty.filter((f) => f.is_active);
    const totalDuties = faculty.reduce((sum, f) => sum + f.duty_count, 0);
    const upcoming = exams.slice(0, 6);

    container.innerHTML = `
        <div class="stat-grid">
            <div class="stat-card"><div class="stat-value">${activeFaculty.length}</div><div class="stat-label">Active Faculty</div></div>
            <div class="stat-card"><div class="stat-value">${classrooms.length}</div><div class="stat-label">Classrooms</div></div>
            <div class="stat-card"><div class="stat-value">${exams.length}</div><div class="stat-label">Exam Sessions</div></div>
            <div class="stat-card"><div class="stat-value">${totalDuties}</div><div class="stat-label">Total Duties Assigned</div></div>
        </div>

        <div class="panel">
            <h3 class="panel-title">Recent Exam Sessions</h3>
            ${upcoming.length === 0 ? '<p class="empty-state">No exam sessions yet. Add one under "Exam Sessions".</p>' : `
            <div class="table-wrap">
                <table>
                    <thead><tr><th>Exam</th><th>Date</th><th>Session</th></tr></thead>
                    <tbody>
                        ${upcoming.map((e) => `
                            <tr>
                                <td>${escapeHtml(e.exam_name)}</td>
                                <td>${escapeHtml(e.exam_date)}</td>
                                <td>${escapeHtml(e.session)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>`}
        </div>
    `;
}
