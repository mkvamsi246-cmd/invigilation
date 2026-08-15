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
    
    // Only show loading placeholder if container is empty or if render takes time
    let isInstant = true;
    const loadingTimer = setTimeout(() => {
        isInstant = false;
        container.innerHTML = '<p class="empty-state">Loading…</p>';
    }, 50);

    try {
        await view.render(container);
        clearTimeout(loadingTimer);
    } catch (err) {
        clearTimeout(loadingTimer);
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
    // 1. Fire non-blocking health ping to warm up backend (if sleeping on free tier)
    api.get('/health').catch(() => {});

    const loginForm = document.getElementById('login-form');
    const submitBtn = document.getElementById('login-submit-btn');
    const statusEl  = document.getElementById('login-status');
    const errEl     = document.getElementById('login-error');

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value;
        errEl.textContent = '';
        if (statusEl) { statusEl.textContent = ''; statusEl.classList.add('hidden'); }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Signing in…';

        // Timer to notify user if free-tier server is warming up
        const warmUpTimer = setTimeout(() => {
            if (statusEl) {
                statusEl.textContent = '⚡ Waking up backend server from free-tier sleep mode (takes ~15-30s)...';
                statusEl.classList.remove('hidden');
            }
        }, 1200);

        try {
            await api.post('/auth/login', { username, password });
            clearTimeout(warmUpTimer);
            showApp(true);
        } catch (err) {
            clearTimeout(warmUpTimer);
            errEl.textContent = err.message;
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Sign In';
            if (statusEl) statusEl.classList.add('hidden');
        }
    });

    document.getElementById('logout-btn').addEventListener('click', async () => {
        await api.post('/auth/logout', {});
        showApp(false);
    });

    document.querySelectorAll('.nav-item[data-view]').forEach((btn) => {
        btn.addEventListener('click', () => navigateTo(btn.dataset.view));
    });

    // Check auth status
    api.get('/auth/status')
        .then((res) => showApp(res.authenticated))
        .catch(() => showApp(false));
});
