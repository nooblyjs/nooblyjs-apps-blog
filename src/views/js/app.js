'use strict';

(function () {
  const appRoot = document.getElementById('blog-app');
  if (!appRoot) return;

  const API_BASE = '/applications/blog/api';

  const state = {
    feed: null,
    posts: new Map(),
    currentPostId: null
  };

  const elements = {
    featured: document.getElementById('featured'),
    latestHeading: document.getElementById('latest-heading'),
    latestList: document.getElementById('latest-list'),
    trendingList: document.getElementById('trending-list'),
    topicsList: document.getElementById('topics-list'),
    draftList: document.getElementById('draft-list'),
    refreshFeedBtn: document.getElementById('refresh-feed-btn'),
    searchInput: document.getElementById('post-search-input'),
    searchBtn: document.getElementById('search-btn'),
    createPostForm: document.getElementById('create-post-form'),
    createPostModal: document.getElementById('createPostModal'),
    readPostModal: document.getElementById('readPostModal'),
    readPostTitle: document.getElementById('read-post-title'),
    readPostMeta: document.getElementById('read-post-meta'),
    readPostCover: document.getElementById('read-post-cover'),
    readPostContent: document.getElementById('read-post-content'),
    readPostActions: document.getElementById('read-post-actions'),
    readPostCommentCount: document.getElementById('read-post-comment-count'),
    readPostComments: document.getElementById('read-post-comments'),
    commentForm: document.getElementById('comment-form'),
    commentAuthor: document.getElementById('comment-author'),
    commentBody: document.getElementById('comment-body'),
    toastContainer: document.getElementById('toast-container')
  };

  const modalRefs = {
    read: null,
    create: null
  };

  const defaultHeaders = {
    Accept: 'application/json'
  };

  async function request(path, options = {}) {
    const init = { ...options };
    init.headers = { ...defaultHeaders, ...(options.headers || {}) };

    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }

    try {
      const response = await fetch(`${API_BASE}${path}`, init);
      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};
      if (!response.ok) {
        const message = payload?.errors?.[0]?.message || `Request failed (${response.status})`;
        throw new Error(message);
      }
      return {
        data: payload.data !== undefined ? payload.data : payload,
        meta: payload.meta || {}
      };
    } catch (error) {
      throw new Error(error.message || 'Network request failed');
    }
  }

  function showToast(message, variant = 'primary', title = 'NooblyJS Blog') {
    if (!elements.toastContainer || typeof bootstrap === 'undefined' || !bootstrap.Toast) return;
    const toast = document.createElement('div');
    toast.className = `toast align-items-center text-bg-${variant} border-0`;
    toast.role = 'alert';
    toast.ariaLive = 'assertive';
    toast.ariaAtomic = 'true';
    toast.innerHTML = `
      <div class="d-flex">
        <div class="toast-body">
          <strong class="me-2">${escapeHtml(title)}:</strong>${escapeHtml(message)}
        </div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
      </div>
    `;
    elements.toastContainer.appendChild(toast);
    new bootstrap.Toast(toast, { delay: 3500 }).show();
    toast.addEventListener('hidden.bs.toast', () => toast.remove());
  }

  function escapeHtml(value = '') {
    return value
      .toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDate(value) {
    if (!value) return '';
    try {
      return new Date(value).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch (_) {
      return value;
    }
  }

  function formatReadTime(post) {
    const minutes = Number(post?.readTimeMinutes) || Math.max(1, Math.ceil((post?.content || '').split(/\s+/).length / 220));
    return `${minutes} min read`;
  }

  function buildPostMeta(post) {
    const parts = [];
    if (post?.author?.name) parts.push(post.author.name);
    parts.push(formatReadTime(post));
    if (post?.publishedAt || post?.updatedAt || post?.createdAt) {
      parts.push(formatDate(post.publishedAt || post.updatedAt || post.createdAt));
    }
    return parts.filter(Boolean).join(' · ');
  }

  function setLoading(container, message) {
    if (!container) return;
    container.innerHTML = `
      <div class="text-center text-muted py-4">
        <div class="spinner-border text-primary" role="status"></div>
        <p class="small mt-3 mb-0">${escapeHtml(message)}</p>
      </div>
    `;
  }

  function setError(container, message) {
    if (!container) return;
    container.innerHTML = `
      <div class="alert alert-warning mb-0" role="alert">
        ${escapeHtml(message)}
      </div>
    `;
  }

  function hydratePosts(collections = []) {
    collections.flat().forEach((post) => {
      if (post && post.id) {
        state.posts.set(post.id, post);
      }
    });
  }

  async function loadFeed({ announce = false } = {}) {
    setLoading(elements.latestList, 'Loading stories…');
    setLoading(elements.trendingList, 'Crunching the numbers…');
    setLoading(elements.topicsList, 'Gathering hot topics…');
    setLoading(elements.draftList, 'Syncing drafts…');
    if (elements.featured) {
      elements.featured.innerHTML = `
        <div class="featured-placeholder flex-grow-1 d-flex align-items-center justify-content-center">
          <div class="text-center text-muted">
            <div class="spinner-border text-primary mb-3" role="status"></div>
            <p class="mb-0">Fetching featured story…</p>
          </div>
        </div>
      `;
    }

    try {
      const { data } = await request('/feed/home');
      state.feed = data || {};
      hydratePosts([data?.featured || [], data?.latest || [], data?.trending || [], data?.drafts || []]);
      renderFeed();
      if (announce) {
        showToast('Home feed refreshed', 'success');
      }
    } catch (error) {
      setError(elements.latestList, `Unable to load stories: ${error.message}`);
      setError(elements.trendingList, 'Trending stories unavailable right now.');
      setError(elements.topicsList, 'Failed to load topics.');
      setError(elements.draftList, 'Drafts could not be retrieved.');
    }
  }

  function renderFeed() {
    renderFeatured(state.feed?.featured?.[0]);
    renderLatest(state.feed?.latest || []);
    renderTrending(state.feed?.trending || []);
    renderTopics(state.feed?.tags || []);
    renderDrafts(state.feed?.drafts || []);
  }

  function renderFeatured(post) {
    if (!elements.featured) return;
    if (!post) {
      elements.featured.innerHTML = `
        <div class="featured-placeholder flex-grow-1 d-flex align-items-center justify-content-center">
          <div class="text-center text-muted">
            <div class="bi bi-journal-richtext display-6 mb-3"></div>
            <p class="mb-0">Publish a story to see it highlighted here.</p>
          </div>
        </div>
      `;
      return;
    }

    const primaryTag = post.tags?.[0] ? escapeHtml(post.tags[0]) : 'Featured';

    elements.featured.innerHTML = `
      <article class="card card-featured shadow h-100 overflow-hidden">
        ${post.coverImage ? `<img src="${escapeHtml(post.coverImage)}" class="card-img-top" alt="${escapeHtml(post.title)}">` : ''}
        <div class="card-body d-flex flex-column gap-2">
          <div class="d-flex align-items-center text-muted small gap-2">
            <span class="badge bg-primary-subtle text-primary-emphasis">${primaryTag}</span>
            <span>${escapeHtml(buildPostMeta(post))}</span>
          </div>
          <h2 class="card-title h3 mb-1">${escapeHtml(post.title)}</h2>
          ${post.subtitle ? `<p class="text-muted mb-2">${escapeHtml(post.subtitle)}</p>` : ''}
          <p class="mb-3">${escapeHtml(post.excerpt || '')}</p>
          <button class="btn btn-primary align-self-start" data-post-id="${escapeHtml(post.id)}" data-action="open-post">
            <i class="bi bi-journal-text me-2"></i>Read story
          </button>
        </div>
      </article>
    `;
  }

  function renderLatest(posts) {
    if (!elements.latestList) return;
    if (!posts.length) {
      elements.latestList.innerHTML = `
        <div class="alert alert-info mb-0" role="alert">
          No stories published yet—be the first to create one.
        </div>
      `;
      return;
    }

    const cards = posts
      .map((post) => {
        const tags = (post.tags || []).slice(0, 3);
        const stats = post.stats || {};
        return `
          <article class="card shadow-sm" data-post-id="${escapeHtml(post.id)}">
            <div class="card-body">
              <div class="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2 text-muted small">
                <span>${escapeHtml(buildPostMeta(post))}</span>
                <span class="d-flex align-items-center gap-3">
                  <span><i class="bi bi-eye me-1"></i>${Number(stats.views || 0)}</span>
                  <span><i class="bi bi-hand-thumbs-up me-1"></i>${Number(stats.claps || 0)}</span>
                  <span><i class="bi bi-bookmark me-1"></i>${Number(stats.bookmarks || 0)}</span>
                </span>
              </div>
              <h3 class="h4 mb-2">
                <a href="#" class="text-decoration-none" data-post-id="${escapeHtml(post.id)}" data-action="open-post">
                  ${escapeHtml(post.title)}
                </a>
              </h3>
              ${post.subtitle ? `<p class="text-muted mb-2">${escapeHtml(post.subtitle)}</p>` : ''}
              <p class="mb-3">${escapeHtml(post.excerpt || '')}</p>
              <div class="d-flex align-items-center justify-content-between flex-wrap gap-3">
                <div class="d-flex gap-2 flex-wrap">
                  ${tags
                    .map((tag) => `<span class="badge bg-primary-subtle text-primary-emphasis">${escapeHtml(tag)}</span>`)
                    .join('')}
                </div>
                <button class="btn btn-outline-primary btn-sm" data-post-id="${escapeHtml(post.id)}" data-action="open-post">
                  Read
                </button>
              </div>
            </div>
          </article>
        `;
      })
      .join('');

    elements.latestList.innerHTML = cards;
  }

  function renderTrending(posts) {
    if (!elements.trendingList) return;
    if (!posts.length) {
      elements.trendingList.innerHTML = `
        <div class="text-center text-muted py-4">
          <i class="bi bi-graph-up-arrow display-6 d-block mb-2"></i>
          <p class="small mb-0">Trending stories will appear once readers engage.</p>
        </div>
      `;
      return;
    }

    elements.trendingList.innerHTML = posts
      .map((post, index) => {
        return `
          <a href="#" class="list-group-item list-group-item-action d-flex gap-3 align-items-start" data-post-id="${escapeHtml(
            post.id
          )}" data-action="open-post">
            <span class="badge bg-primary-subtle text-primary-emphasis rounded-pill">${index + 1}</span>
            <div>
              <h3 class="h6 mb-1">${escapeHtml(post.title)}</h3>
              <p class="text-muted small mb-0">${escapeHtml(buildPostMeta(post))}</p>
            </div>
          </a>
        `;
      })
      .join('');
  }

  function renderTopics(tags) {
    if (!elements.topicsList) return;
    if (!tags.length) {
      elements.topicsList.innerHTML = `
        <div class="text-muted small">Tags will populate once published stories include them.</div>
      `;
      return;
    }

    elements.topicsList.innerHTML = tags
      .map(
        (entry) => `
          <button type="button" class="btn btn-outline-primary btn-sm" data-tag="${escapeHtml(entry.tag)}" data-action="filter-tag">
            <i class="bi bi-hash me-1"></i>${escapeHtml(entry.tag)}<span class="badge bg-light text-muted ms-2">${Number(entry.count)}</span>
          </button>
        `
      )
      .join('');
  }

  function renderDrafts(drafts) {
    if (!elements.draftList) return;
    if (!drafts.length) {
      elements.draftList.innerHTML = `
        <li class="list-group-item text-muted">No drafts yet. Save a story as draft to track it here.</li>
      `;
      return;
    }

    elements.draftList.innerHTML = drafts
      .map((post) => {
        return `
          <li class="list-group-item d-flex justify-content-between align-items-center">
            <div>
              <h3 class="h6 mb-1">${escapeHtml(post.title)}</h3>
              <p class="small text-muted mb-0">Updated ${escapeHtml(formatDate(post.updatedAt || post.createdAt))}</p>
            </div>
            <button class="btn btn-outline-secondary btn-sm" data-post-id="${escapeHtml(post.id)}" data-action="open-post">
              Continue
            </button>
          </li>
        `;
      })
      .join('');
  }

  function markdownToHtml(content = '') {
    const safe = escapeHtml(content);
    const paragraphs = safe
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean);

    return paragraphs
      .map((block) => {
        if (/^[-*]\s+/m.test(block)) {
          const items = block
            .split(/\n/)
            .map((line) => line.replace(/^[-*]\s+/, '').trim())
            .filter(Boolean)
            .map((line) => `<li>${line}</li>`)
            .join('');
          return `<ul>${items}</ul>`;
        }
        return `<p>${block.replace(/\n/g, '<br>')}</p>`;
      })
      .join('');
  }

  function syncPost(post) {
    state.posts.set(post.id, post);
    if (!state.feed) return;
    ['featured', 'latest', 'trending', 'drafts'].forEach((key) => {
      if (!Array.isArray(state.feed[key])) return;
      state.feed[key] = state.feed[key].map((entry) => (entry.id === post.id ? { ...entry, ...post } : entry));
    });
  }

  async function refreshPostFromServer(postId) {
    if (!postId) return null;
    try {
      const { data: post } = await request(`/posts/${encodeURIComponent(postId)}`);
      syncPost(post);
      renderActionButtons(post);
      renderFeed();
      return post;
    } catch (_) {
      return null;
    }
  }

  async function openPost(postId) {
    if (!postId) return;
    try {
      const { data: post } = await request(`/posts/${encodeURIComponent(postId)}`);
      state.currentPostId = post.id;
      syncPost(post);
      renderPostModal(post);
      await loadComments(post.id);
      ensureReadModal().show();
    } catch (error) {
      showToast(error.message, 'danger', 'Unable to load story');
    }
  }

  function renderPostModal(post) {
    elements.readPostTitle.textContent = post.title || 'Untitled story';
    elements.readPostMeta.textContent = buildPostMeta(post);
    elements.readPostCover.innerHTML = post.coverImage
      ? `<img src="${escapeHtml(post.coverImage)}" class="img-fluid rounded" alt="${escapeHtml(post.title)}">`
      : '';
    elements.readPostContent.innerHTML = markdownToHtml(post.content || post.excerpt || '');
    renderActionButtons(post);
  }

  function renderActionButtons(post) {
    const stats = post.stats || {};
    elements.readPostActions.innerHTML = `
      <button class="btn btn-outline-primary btn-sm d-flex align-items-center gap-2" data-action="clap" data-post-id="${escapeHtml(
        post.id
      )}">
        <i class="bi bi-hand-thumbs-up"></i><span>${Number(stats.claps || 0)}</span>
      </button>
      <button class="btn btn-outline-secondary btn-sm d-flex align-items-center gap-2" data-action="bookmark" data-post-id="${escapeHtml(
        post.id
      )}">
        <i class="bi bi-bookmark"></i><span>${Number(stats.bookmarks || 0)}</span>
      </button>
    `;
  }

  async function loadComments(postId) {
    setLoading(elements.readPostComments, 'Loading comments…');
    try {
      const { data: comments } = await request(`/posts/${encodeURIComponent(postId)}/comments`);
      renderComments(Array.isArray(comments) ? comments : []);
    } catch (error) {
      setError(elements.readPostComments, `Unable to load comments: ${error.message}`);
      elements.readPostCommentCount.textContent = '0 comments';
    }
  }

  function renderComments(comments) {
    if (!comments.length) {
      elements.readPostComments.innerHTML = `
        <div class="text-muted">No comments yet. Start the conversation!</div>
      `;
      elements.readPostCommentCount.textContent = '0 comments';
      return;
    }

    elements.readPostComments.innerHTML = comments
      .map((comment) => {
        const name = comment.author?.name || 'Reader';
        return `
          <div class="card card-body bg-body-tertiary">
            <div class="d-flex justify-content-between align-items-start mb-2">
              <div>
                <strong>${escapeHtml(name)}</strong>
                <div class="text-muted small">${escapeHtml(formatDate(comment.createdAt))}</div>
              </div>
              <span class="badge bg-success-subtle text-success-emphasis">${escapeHtml(comment.status || 'published')}</span>
            </div>
            <p class="mb-0">${escapeHtml(comment.body || '')}</p>
          </div>
        `;
      })
      .join('');

    elements.readPostCommentCount.textContent = `${comments.length} comment${comments.length === 1 ? '' : 's'}`;
  }

  function ensureReadModal() {
    if (!modalRefs.read) {
      modalRefs.read = new bootstrap.Modal(elements.readPostModal, { focus: true });
    }
    return modalRefs.read;
  }

  function ensureCreateModal() {
    if (!modalRefs.create) {
      modalRefs.create = new bootstrap.Modal(elements.createPostModal);
    }
    return modalRefs.create;
  }

  function parseTags(value = '') {
    return value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 10);
  }

  async function handleCreatePost(event) {
    event.preventDefault();
    if (!elements.createPostForm) return;

    const form = elements.createPostForm;
    form.classList.add('was-validated');
    if (!form.checkValidity()) {
      return;
    }

    const data = new FormData(form);
    const payload = {
      title: data.get('title')?.toString().trim(),
      subtitle: data.get('subtitle')?.toString().trim() || undefined,
      content: data.get('content')?.toString().trim(),
      tags: parseTags(data.get('tags')?.toString() || ''),
      status: data.get('status') || 'draft',
      coverImage: data.get('coverImage')?.toString().trim() || undefined,
      scheduledFor: data.get('scheduledFor') || undefined,
      author: {
        name: data.get('author')?.toString().trim() || 'Anonymous'
      }
    };

    try {
      const { data: post } = await request('/posts', {
        method: 'POST',
        body: payload
      });
      syncPost(post);
      ensureCreateModal().hide();
      form.reset();
      form.classList.remove('was-validated');
      showToast('Story saved successfully', 'success');
      await loadFeed();
    } catch (error) {
      showToast(error.message, 'danger', 'Unable to save story');
    }
  }

  async function handleCommentSubmit(event) {
    event.preventDefault();
    if (!state.currentPostId) return;
    const author = elements.commentAuthor.value.trim();
    const body = elements.commentBody.value.trim();
    if (!author || !body) {
      showToast('Please provide your name and a comment.', 'warning');
      return;
    }

    try {
      await request(`/posts/${encodeURIComponent(state.currentPostId)}/comments`, {
        method: 'POST',
        body: {
          body,
          author: { name: author }
        }
      });
      elements.commentForm.reset();
      showToast('Comment posted', 'success');
      await loadComments(state.currentPostId);
      await refreshPostFromServer(state.currentPostId);
    } catch (error) {
      showToast(error.message, 'danger', 'Unable to post comment');
    }
  }

  async function handlePostAction(action, postId) {
    if (!postId) return;
    let endpoint = null;
    if (action === 'clap') endpoint = `/posts/${encodeURIComponent(postId)}/clap`;
    if (action === 'bookmark') endpoint = `/posts/${encodeURIComponent(postId)}/bookmark`;
    if (!endpoint) return;

    try {
      const { data: post } = await request(endpoint, { method: 'POST' });
      syncPost(post);
      renderActionButtons(post);
      renderFeed();
      showToast(action === 'clap' ? 'Thanks for showing support!' : 'Saved to your reading list', 'success');
    } catch (error) {
      showToast(error.message, 'danger');
    }
  }

  async function runSearch(term) {
    const query = term.trim();
    if (!query) {
      elements.latestHeading.textContent = 'Latest posts';
      renderLatest(state.feed?.latest || []);
      return;
    }

    setLoading(elements.latestList, 'Searching stories…');
    try {
      const { data } = await request(`/search?q=${encodeURIComponent(query)}`);
      const results = Array.isArray(data) ? data : [];
      hydratePosts([results]);
      elements.latestHeading.innerHTML = `Search results for “${escapeHtml(query)}”`;
      renderLatest(results);
      if (!results.length) {
        elements.latestList.innerHTML = `
          <div class="alert alert-secondary mb-0" role="alert">
            No stories matched “${escapeHtml(query)}”.
          </div>
        `;
      }
    } catch (error) {
      setError(elements.latestList, `Search failed: ${error.message}`);
    }
  }

  function handleGlobalClick(event) {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.getAttribute('data-action');
    const postId = target.getAttribute('data-post-id');
    const tag = target.getAttribute('data-tag');

    if (action === 'open-post') {
      event.preventDefault();
      openPost(postId);
    } else if (action === 'clap' || action === 'bookmark') {
      event.preventDefault();
      handlePostAction(action, postId);
    } else if (action === 'filter-tag' && tag) {
      event.preventDefault();
      elements.searchInput.value = tag;
      runSearch(tag);
    }
  }

  function registerEvents() {
    elements.refreshFeedBtn?.addEventListener('click', () => loadFeed({ announce: true }));
    elements.searchBtn?.addEventListener('click', () => runSearch(elements.searchInput.value));
    elements.searchInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        runSearch(elements.searchInput.value);
      }
    });
    elements.createPostForm?.addEventListener('submit', handleCreatePost);
    elements.commentForm?.addEventListener('submit', handleCommentSubmit);
    document.addEventListener('click', handleGlobalClick);
    document.addEventListener('shown.bs.modal', (event) => {
      if (event.target === elements.readPostModal) {
        elements.commentAuthor.focus();
      }
    });
  }

  registerEvents();
  loadFeed();
})();
