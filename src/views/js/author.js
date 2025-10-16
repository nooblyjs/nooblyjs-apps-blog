'use strict';

const API_BASE = '/applications/blog/api';
const TOKEN_STORAGE_KEY = 'authToken';

const state = {
  posts: [],
  filtered: [],
  currentPostId: null,
  loading: false
};

const elements = {
  alert: document.getElementById('author-alert'),
  tableBody: document.querySelector('#author-post-table tbody'),
  filterInput: document.getElementById('post-filter-input'),
  form: document.getElementById('post-editor-form'),
  resetBtn: document.getElementById('reset-editor-btn'),
  newPostBtn: document.getElementById('create-new-post-btn'),
  editorHeading: document.getElementById('editor-heading'),
  editorStatusBadge: document.getElementById('editor-status-badge'),
  inputs: {
    id: document.getElementById('post-id'),
    title: document.getElementById('post-title'),
    subtitle: document.getElementById('post-subtitle'),
    author: document.getElementById('post-author'),
    tags: document.getElementById('post-tags'),
    status: document.getElementById('post-status'),
    cover: document.getElementById('post-cover'),
    content: document.getElementById('post-content'),
    scheduledFor: document.getElementById('post-scheduled')
  }
};

function getAuthToken() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('authToken');
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    params.delete('authToken');
    const search = params.toString();
    const newUrl = `${window.location.pathname}${search ? `?${search}` : ''}`;
    window.history.replaceState({}, document.title, newUrl);
    return token;
  }
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

const authToken = getAuthToken();

function setAlert(message, variant = 'info') {
  if (!elements.alert) return;
  if (!message) {
    elements.alert.classList.add('d-none');
    elements.alert.textContent = '';
    return;
  }
  elements.alert.className = `alert alert-${variant}`;
  elements.alert.textContent = message;
}

function formatDate(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (_) {
    return value;
  }
}

function statusBadge(status) {
  if (status === 'published') return '<span class="badge bg-success-subtle text-success-emphasis">Published</span>';
  if (status === 'scheduled') return '<span class="badge bg-warning-subtle text-warning-emphasis">Scheduled</span>';
  return '<span class="badge bg-secondary-subtle text-secondary-emphasis">Draft</span>';
}

async function apiRequest(path, options = {}) {
  const init = { ...options };
  init.headers = { Accept: 'application/json', ...(options.headers || {}) };

  if (init.body && typeof init.body === 'object' && !(init.body instanceof FormData)) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(init.body);
  }

  const token = authToken || localStorage.getItem(TOKEN_STORAGE_KEY);
  if (token) {
    init.headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, init);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = payload?.errors?.[0]?.message || `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload;
}

function renderRows(posts) {
  if (!elements.tableBody) return;
  if (!posts.length) {
    elements.tableBody.innerHTML = `
      <tr>
        <td colspan="4" class="text-center py-5 text-muted">
          <i class="bi bi-inboxes display-6 d-block mb-2"></i>
          <div>No posts found. Create a new draft to get started.</div>
        </td>
      </tr>
    `;
    return;
  }

  elements.tableBody.innerHTML = posts
    .map((post) => {
      const updatedAt = post.updatedAt || post.publishedAt || post.createdAt;
      return `
        <tr data-post-id="${post.id}">
          <td>
            <div class="fw-semibold">${post.title || 'Untitled'}</div>
            <div class="text-muted small">${post.subtitle || post.excerpt || ''}</div>
          </td>
          <td>${statusBadge(post.status)}</td>
          <td class="text-nowrap">${formatDate(updatedAt)}</td>
          <td class="text-end">
            <div class="btn-group btn-group-sm" role="group">
              <button class="btn btn-outline-primary" data-action="edit" title="Edit post">
                <i class="bi bi-pencil-square"></i>
              </button>
              ${
                post.status === 'published'
                  ? `<button class="btn btn-outline-warning" data-action="unpublish" title="Unpublish"><i class="bi bi-eye-slash"></i></button>`
                  : `<button class="btn btn-outline-success" data-action="publish" title="Publish"><i class="bi bi-upload"></i></button>`
              }
              <button class="btn btn-outline-danger" data-action="delete" title="Delete post">
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');
}

function applyFilter() {
  if (!elements.filterInput) return state.posts;
  const term = elements.filterInput.value.trim().toLowerCase();
  if (!term) {
    state.filtered = [...state.posts];
  } else {
    state.filtered = state.posts.filter((post) => {
      const tags = post.tags || [];
      return (
        (post.title || '').toLowerCase().includes(term) ||
        (post.subtitle || '').toLowerCase().includes(term) ||
        (post.author?.name || '').toLowerCase().includes(term) ||
        tags.some((tag) => tag.toLowerCase().includes(term))
      );
    });
  }
  renderRows(state.filtered);
}

async function loadPosts() {
  try {
    state.loading = true;
    setAlert('');
    const { data } = await apiRequest('/posts');
    state.posts = Array.isArray(data) ? data : [];
    applyFilter();
  } catch (error) {
    setAlert(error.message || 'Unable to load posts.', 'danger');
    if (elements.tableBody) {
      elements.tableBody.innerHTML = `
        <tr>
          <td colspan="4" class="text-center py-5 text-danger">
            <i class="bi bi-exclamation-triangle display-6 d-block mb-2"></i>
            <div>${error.message || 'Unable to load posts.'}</div>
          </td>
        </tr>
      `;
    }
  } finally {
    state.loading = false;
  }
}

function formatTagsInput(tags) {
  if (!Array.isArray(tags)) return '';
  return tags.join(', ');
}

function populateForm(post) {
  state.currentPostId = post?.id || null;
  elements.inputs.id.value = post?.id || '';
  elements.inputs.title.value = post?.title || '';
  elements.inputs.subtitle.value = post?.subtitle || '';
  elements.inputs.author.value = post?.author?.name || '';
  elements.inputs.tags.value = formatTagsInput(post?.tags || []);
  elements.inputs.status.value = post?.status || 'draft';
  elements.inputs.cover.value = post?.coverImage || '';
  elements.inputs.content.value = post?.content || '';
  elements.inputs.scheduledFor.value = post?.scheduledFor
    ? new Date(post.scheduledFor).toISOString().slice(0, 16)
    : '';

  const headingText = post?.id ? `Editing: ${post.title || 'Untitled story'}` : 'Create a new story';
  const statusText =
    post?.status === 'published'
      ? 'Published'
      : post?.status === 'scheduled'
        ? 'Scheduled'
        : 'Draft';

  elements.editorHeading.textContent = headingText;
  elements.editorStatusBadge.textContent = statusText;
  elements.editorStatusBadge.className = `badge ${
    post?.status === 'published'
      ? 'bg-success-subtle text-success-emphasis'
      : post?.status === 'scheduled'
        ? 'bg-warning-subtle text-warning-emphasis'
        : 'bg-secondary-subtle text-secondary-emphasis'
  }`;
}

function resetForm() {
  state.currentPostId = null;
  elements.form.classList.remove('was-validated');
  elements.form.reset();
  Object.values(elements.inputs).forEach((input) => {
    if (input && input.type !== 'hidden') {
      input.value = '';
    }
  });
  elements.inputs.status.value = 'draft';
  elements.inputs.id.value = '';
  elements.editorStatusBadge.textContent = 'Draft';
  elements.editorStatusBadge.className = 'badge bg-secondary-subtle text-secondary-emphasis';
  elements.editorHeading.textContent = 'Create a new story';
}

function parseTags(value) {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function buildPayloadFromForm() {
  return {
    title: elements.inputs.title.value.trim(),
    subtitle: elements.inputs.subtitle.value.trim() || undefined,
    author: elements.inputs.author.value.trim() || undefined,
    tags: parseTags(elements.inputs.tags.value || ''),
    status: elements.inputs.status.value || 'draft',
    coverImage: elements.inputs.cover.value.trim() || undefined,
    content: elements.inputs.content.value.trim(),
    scheduledFor: elements.inputs.scheduledFor.value || undefined
  };
}

async function handleFormSubmit(event) {
  event.preventDefault();
  event.stopPropagation();

  if (!elements.form.checkValidity()) {
    elements.form.classList.add('was-validated');
    return;
  }

  const payload = buildPayloadFromForm();
  if (!payload.title || !payload.content) {
    elements.form.classList.add('was-validated');
    return;
  }

  try {
    setAlert('');
    const postId = state.currentPostId;
    if (postId) {
      await apiRequest(`/posts/${encodeURIComponent(postId)}`, { method: 'PATCH', body: payload });
      setAlert('Post updated successfully.', 'success');
    } else {
      const body = { ...payload };
      if (body.status === 'published') {
        body.status = 'draft';
      }
      const { data } = await apiRequest('/posts', { method: 'POST', body });
      if (elements.inputs.status.value === 'published') {
        await apiRequest(`/posts/${encodeURIComponent(data.id)}/publish`, { method: 'POST' });
      }
      setAlert('Draft created successfully.', 'success');
    }
    await loadPosts();
    resetForm();
  } catch (error) {
    setAlert(error.message || 'Unable to save post.', 'danger');
  }
}

async function handleDelete(postId) {
  if (!postId) return;
  if (!confirm('Delete this post? This action cannot be undone.')) {
    return;
  }
  try {
    await apiRequest(`/posts/${encodeURIComponent(postId)}`, { method: 'DELETE' });
    setAlert('Post deleted.', 'success');
    if (state.currentPostId === postId) {
      resetForm();
    }
    await loadPosts();
  } catch (error) {
    setAlert(error.message || 'Unable to delete post.', 'danger');
  }
}

async function handlePublish(postId) {
  if (!postId) return;
  try {
    await apiRequest(`/posts/${encodeURIComponent(postId)}/publish`, {
      method: 'POST'
    });
    setAlert('Post published.', 'success');
    if (state.currentPostId === postId) {
      elements.inputs.status.value = 'published';
    }
    await loadPosts();
  } catch (error) {
    setAlert(error.message || 'Unable to publish post.', 'danger');
  }
}

async function handleUnpublish(postId) {
  if (!postId) return;
  try {
    await apiRequest(`/posts/${encodeURIComponent(postId)}`, {
      method: 'PATCH',
      body: { status: 'draft' }
    });
    setAlert('Post moved back to draft.', 'info');
    if (state.currentPostId === postId) {
      elements.inputs.status.value = 'draft';
    }
    await loadPosts();
  } catch (error) {
    setAlert(error.message || 'Unable to update post status.', 'danger');
  }
}

function handleTableClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const row = button.closest('tr[data-post-id]');
  const postId = row?.getAttribute('data-post-id');
  const action = button.getAttribute('data-action');
  const post = state.posts.find((item) => item.id === postId);

  if (action === 'edit') {
    populateForm(post || null);
    window.scrollTo({ top: elements.form.offsetTop - 80, behavior: 'smooth' });
  } else if (action === 'publish') {
    handlePublish(postId);
  } else if (action === 'unpublish') {
    handleUnpublish(postId);
  } else if (action === 'delete') {
    handleDelete(postId);
  }
}

function registerEvents() {
  elements.filterInput?.addEventListener('input', () => {
    applyFilter();
  });

  elements.tableBody?.addEventListener('click', handleTableClick);

  elements.form?.addEventListener('submit', handleFormSubmit);

  elements.resetBtn?.addEventListener('click', resetForm);

  elements.newPostBtn?.addEventListener('click', () => {
    resetForm();
    elements.inputs.title.focus();
  });
}

function init() {
  if (!authToken && !localStorage.getItem(TOKEN_STORAGE_KEY)) {
    setAlert('Authentication token missing. Please sign in again.', 'danger');
    return;
  }
  registerEvents();
  resetForm();
  loadPosts();
}

document.addEventListener('DOMContentLoaded', init);
