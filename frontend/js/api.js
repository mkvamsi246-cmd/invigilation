// Dynamic API Base URL depending on environment
// For local development, it defaults to '/api' (same-origin).
// For Vercel deployment, replace the URL below with your deployed Render URL.
const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? '/api'
    : 'https://invigilation-backend.onrender.com/api'; // 👈 REPLACE with your Render URL (must end with /api)

// In-memory response cache for GET requests to eliminate latency on tab switching
const apiCache = new Map();
const DEFAULT_CACHE_TTL = 60 * 1000; // 60 seconds

function clearApiCache() {
    apiCache.clear();
}

async function apiRequest(path, options = {}) {
    const isGet = !options.method || options.method === 'GET';
    const bypassCache = options.bypassCache || false;

    if (isGet && !bypassCache && apiCache.has(path)) {
        const cached = apiCache.get(path);
        if (Date.now() - cached.timestamp < DEFAULT_CACHE_TTL) {
            return cached.data;
        }
    }

    const res = await fetch(API_BASE + path, {
        credentials: 'include',
        headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
        ...options,
    });

    if (res.status === 401) {
        clearApiCache();
        showApp(false);
        throw new Error('Session expired. Please log in again.');
    }

    let data = null;
    try { data = await res.json(); } catch (e) { /* no body (e.g. file downloads) */ }

    if (!res.ok) {
        throw new Error((data && data.error) || `Request failed (${res.status})`);
    }

    if (isGet && !bypassCache) {
        apiCache.set(path, { data, timestamp: Date.now() });
    } else if (!isGet) {
        // Clear cache on write operations (POST, PUT, PATCH, DELETE) so state stays fresh
        clearApiCache();
    }

    return data;
}

const api = {
    get:        (path, opts) => apiRequest(path, { ...opts, method: 'GET' }),
    post:       (path, body) => apiRequest(path, { method: 'POST',   body: JSON.stringify(body) }),
    put:        (path, body) => apiRequest(path, { method: 'PUT',    body: JSON.stringify(body) }),
    patch:      (path, body) => apiRequest(path, { method: 'PATCH',  body: JSON.stringify(body) }),
    del:        (path)       => apiRequest(path, { method: 'DELETE' }),
    upload:     (path, formData) => apiRequest(path, { method: 'POST', body: formData }),
    clearCache: clearApiCache,
    getCached:  (path)       => apiCache.has(path) ? apiCache.get(path).data : null,
};

function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.toggle('toast-error', isError);
    toast.classList.remove('hidden');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => toast.classList.add('hidden'), 3500);
}
