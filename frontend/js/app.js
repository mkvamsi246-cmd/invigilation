const views = {
    dashboard: { title: 'Dashboard', render: renderDashboard },
    faculty: { title: 'Faculty', render: renderFaculty },
    classrooms: { title: 'Classrooms', render: renderClassrooms },
    exams: { title: 'Exam Sessions', render: renderExams },
    generate: { title: 'Generate Duties', render: renderGenerate },
    import: { title: 'Import Data', render: renderImport },
    settings: { title: 'Settings', render: renderSettings },
};

let currentView = 'dashboard';

function showApp(loggedIn) {
    document.getElementById('login-screen').classList.toggle('hidden', loggedIn);
    document.getElementById('app-shell').classList.toggle('hidden', !loggedIn);
    if (loggedIn) navigateTo(currentView);
}

async function navigateTo(viewName) {
    const view = views[viewName];
    if (!view) return;
    currentView = viewName;

    document.querySelectorAll('.nav-item[data-view]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.view === viewName);
    });
    document.getElementById('view-title').textContent = view.title;

    const container = document.getElementById('view-container');
    container.innerHTML = '<p class="empty-state">Loading…</p>';
    try {
        await view.render(container);
    } catch (err) {
        container.innerHTML = `<p class="error-text">${escapeHtml(err.message)}</p>`;
    }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
}

function formatDesignation(d) {
    if (!d) return '';
    return d.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------- Init ----------

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value;
        const errEl = document.getElementById('login-error');
        errEl.textContent = '';
        try {
            await api.post('/auth/login', { username, password });
            showApp(true);
        } catch (err) {
            errEl.textContent = err.message;
        }
    });

    document.getElementById('logout-btn').addEventListener('click', async () => {
        await api.post('/auth/logout', {});
        showApp(false);
    });

    document.querySelectorAll('.nav-item[data-view]').forEach((btn) => {
        btn.addEventListener('click', () => navigateTo(btn.dataset.view));
    });

    api.get('/auth/status')
        .then((res) => showApp(res.authenticated))
        .catch(() => showApp(false));
});
