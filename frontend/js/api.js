const API_BASE = '/api';

async function apiRequest(path, options = {}) {
    const res = await fetch(API_BASE + path, {
        credentials: 'include',
        headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
        ...options,
    });

    if (res.status === 401) {
        showApp(false);
        throw new Error('Session expired. Please log in again.');
    }

    let data = null;
    try { data = await res.json(); } catch (e) { /* no body (e.g. file downloads) */ }

    if (!res.ok) {
        throw new Error((data && data.error) || `Request failed (${res.status})`);
    }
    return data;
}

const api = {
    get:    (path)        => apiRequest(path),
    post:   (path, body)  => apiRequest(path, { method: 'POST',   body: JSON.stringify(body) }),
    put:    (path, body)  => apiRequest(path, { method: 'PUT',    body: JSON.stringify(body) }),
    patch:  (path, body)  => apiRequest(path, { method: 'PATCH',  body: JSON.stringify(body) }),
    del:    (path)        => apiRequest(path, { method: 'DELETE' }),
    upload: (path, formData) => apiRequest(path, { method: 'POST', body: formData }),
};

function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.toggle('toast-error', isError);
    toast.classList.remove('hidden');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => toast.classList.add('hidden'), 3500);
}
