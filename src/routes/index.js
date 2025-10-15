'use strict';

const API_BASE_PATH = '/applications/blog/api';
const CONTAINERS = {
  POSTS: 'blog_posts',
  COMMENTS: 'blog_comments',
  BOOKMARKS: 'blog_bookmarks'
};

const CACHE_KEYS = {
  HOME_FEED: 'blog:feed:home'
};

const ONE_MINUTE = 60 * 1000;

/**
 * Normalizes a string into a URL-friendly slug.
 * @param {string} value
 * @return {string}
 */
function toSlug(value = '') {
  return value
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Generates a short excerpt from content.
 * @param {string} content
 * @param {number} length
 * @return {string}
 */
function buildExcerpt(content = '', length = 200) {
  const clean = content.replace(/\s+/g, ' ').trim();
  if (clean.length <= length) return clean;
  return `${clean.substring(0, length).trim()}…`;
}

/**
 * Estimates read time in minutes based on word count.
 * @param {string} content
 * @return {number}
 */
function estimateReadTime(content = '') {
  const words = content ? content.trim().split(/\s+/).length : 0;
  return Math.max(1, Math.ceil(words / 220));
}

/**
 * Normalizes and deduplicates tags.
 * @param {Array<string>} tags
 * @return {Array<string>}
 */
function normalizeTags(tags = []) {
  if (!Array.isArray(tags)) return [];
  const unique = new Set();
  tags.forEach((tag) => {
    if (typeof tag !== 'string') return;
    const trimmed = tag.trim();
    if (!trimmed) return;
    unique.add(trimmed.replace(/\s+/g, ' '));
  });
  return Array.from(unique).slice(0, 10);
}

/**
 * Builds a safe default logger when the registry logger is unavailable.
 * @param {Object|undefined} logger
 * @return {{info: Function, warn: Function, error: Function, debug: Function}}
 */
function buildLogger(logger) {
  if (logger) return logger;
  return {
    info: console.log.bind(console, '[blog]'),
    warn: console.warn.bind(console, '[blog]'),
    error: console.error.bind(console, '[blog]'),
    debug: console.debug.bind(console, '[blog]')
  };
}

/**
 * Sends a standardized JSON response.
 * @param {import('express').Response} res
 * @param {number} status
 * @param {*} data
 * @param {Object=} meta
 */
function sendJson(res, status, data, meta) {
  res.status(status).json({
    data,
    meta: meta || {}
  });
}

/**
 * Sends a standardized JSON error response.
 * @param {import('express').Response} res
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @param {Object=} details
 */
function sendError(res, status, code, message, details) {
  res.status(status).json({
    errors: [
      {
        code,
        message,
        details: details || {}
      }
    ]
  });
}

/**
 * Configures and registers Blog API routes with the Express application.
 *
 * @param {Object} options Express binding
 * @param {import('events').EventEmitter} eventEmitter
 * @param {Object} services NooblyJS services
 */
module.exports = (options, eventEmitter, services) => {
  const app = options.app;
  const { dataService, cache, logger, search } = services;

  if (!app) {
    throw new Error('Blog routes require an Express application instance.');
  }

  if (!dataService || !dataService.provider) {
    throw new Error('Blog routes require the noobly-core dataService.');
  }

  const log = buildLogger(logger);
  const provider = dataService.provider;

  /**
   * Ensures a container exists on the data service.
   * @param {string} containerName
   * @return {Promise<void>}
   */
  const ensureContainer = async (containerName) => {
    const containers = provider.containers;
    if (containers && containers.has(containerName)) {
      return;
    }
    try {
      await dataService.createContainer(containerName);
    } catch (error) {
      const alreadyExists = typeof error.message === 'string' && error.message.includes('already exists');
      if (!alreadyExists) {
        log.error('Failed to initialize container', { containerName, error: error.message });
        throw error;
      }
    }
  };

  const containersReady = (async () => {
    for (const container of Object.values(CONTAINERS)) {
      await ensureContainer(container);
    }
  })();

  /**
   * Retrieves the backing map for a container.
   * @param {string} container
   * @return {Map<string, Object>}
   */
  const getContainerMap = (container) => {
    return provider.containers?.get(container) || new Map();
  };

  /**
   * Lists all records for a container.
   * @param {string} container
   * @return {Promise<Array<Object>>}
   */
  const listRecords = async (container) => {
    await containersReady;
    return Array.from(getContainerMap(container).values());
  };

  /**
   * Retrieves a record by id.
   * @param {string} container
   * @param {string} id
   * @return {Promise<Object|null>}
   */
  const getRecord = async (container, id) => {
    await containersReady;
    const record = getContainerMap(container).get(id);
    return record || null;
  };

  /**
   * Persists a new record.
   * @param {string} container
   * @param {Object} payload
   * @return {Promise<Object>}
   */
  const createRecord = async (container, payload) => {
    await containersReady;
    const now = new Date().toISOString();
    const record = { ...payload, createdAt: payload.createdAt || now, updatedAt: payload.updatedAt || now };
    const id = await dataService.add(container, record);
    const containerMap = getContainerMap(container);
    const saved = { ...(containerMap.get(id) || record), id };
    containerMap.set(id, saved);
    return saved;
  };

  /**
   * Updates an existing record in-place.
   * @param {string} container
   * @param {string} id
   * @param {Function|Object} updater
   * @return {Promise<Object|null>}
   */
  const updateRecord = async (container, id, updater) => {
    await containersReady;
    const containerMap = getContainerMap(container);
    const existing = containerMap.get(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    const next = typeof updater === 'function' ? updater(existing) : { ...existing, ...updater };
    next.id = id;
    next.updatedAt = now;
    containerMap.set(id, next);
    return next;
  };

  /**
   * Removes a record.
   * @param {string} container
   * @param {string} id
   * @return {Promise<boolean>}
   */
  const deleteRecord = async (container, id) => {
    await containersReady;
    const success = await dataService.remove(container, id);
    if (success) {
      const containerMap = getContainerMap(container);
      containerMap.delete(id);
    }
    return success;
  };

  /**
   * Invalidates cached feed data.
   * @return {Promise<void>}
   */
  const invalidateFeedCache = async () => {
    if (cache && typeof cache.delete === 'function') {
      await cache.delete(CACHE_KEYS.HOME_FEED);
    }
  };

  /**
   * Updates the search index for a post.
   * @param {Object} post
   * @return {Promise<void>}
   */
  const upsertSearchIndex = async (post) => {
    if (!search) return;
    const payload = {
      id: post.id,
      slug: post.slug,
      title: post.title,
      subtitle: post.subtitle,
      excerpt: post.excerpt,
      author: post.author?.name,
      tags: post.tags,
      summary: [post.title, post.subtitle, post.excerpt, post.author?.name, ...(post.tags || [])].join(' ')
    };
    try {
      await search.remove(post.id, 'blog-posts');
    } catch (_) {
      // ignore remove errors
    }
    try {
      await search.add(post.id, payload, 'blog-posts');
    } catch (error) {
      log.warn('Failed to index post for search', { postId: post.id, error: error.message });
    }
  };

  /**
   * Removes a post from the search index.
   * @param {string} id
   * @return {Promise<void>}
   */
  const removeFromSearchIndex = async (id) => {
    if (!search) return;
    try {
      await search.remove(id, 'blog-posts');
    } catch (error) {
      log.warn('Failed to remove post from search index', { postId: id, error: error.message });
    }
  };

  /**
   * Builds the home feed payload.
   * @return {Promise<Object>}
   */
  const buildHomeFeed = async () => {
    const posts = await listRecords(CONTAINERS.POSTS);
    const published = posts.filter((post) => post.status === 'published');

    const sortedByFreshness = [...published].sort((a, b) => {
      const dateB = new Date(b.publishedAt || b.updatedAt || b.createdAt).getTime();
      const dateA = new Date(a.publishedAt || a.updatedAt || a.createdAt).getTime();
      return dateB - dateA;
    });

    const trending = [...published].sort((a, b) => {
      const scoreA = (a.stats?.claps || 0) * 3 + (a.stats?.bookmarks || 0) * 2 + (a.stats?.views || 0);
      const scoreB = (b.stats?.claps || 0) * 3 + (b.stats?.bookmarks || 0) * 2 + (b.stats?.views || 0);
      if (scoreB !== scoreA) return scoreB - scoreA;
      const freshB = new Date(b.publishedAt || b.updatedAt || b.createdAt).getTime();
      const freshA = new Date(a.publishedAt || a.updatedAt || a.createdAt).getTime();
      return freshB - freshA;
    });

    const featured = trending.slice(0, 1);
    const latest = sortedByFreshness.slice(0, 6);
    const trendingShort = trending.slice(0, 5);

    const tagCounts = new Map();
    published.forEach((post) => {
      (post.tags || []).forEach((tag) => {
        const count = tagCounts.get(tag) || 0;
        tagCounts.set(tag, count + 1);
      });
    });
    const tags = Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count, slug: toSlug(tag) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const drafts = posts.filter((post) => post.status !== 'published');

    return {
      featured,
      latest,
      trending: trendingShort,
      tags,
      drafts: drafts.slice(0, 6),
      totals: {
        posts: posts.length,
        published: published.length,
        drafts: drafts.length
      }
    };
  };

  /**
   * Retrieves the home feed with caching.
   * @return {Promise<Object>}
   */
  const getHomeFeed = async () => {
    if (cache && typeof cache.get === 'function' && typeof cache.put === 'function') {
      const cached = await cache.get(CACHE_KEYS.HOME_FEED);
      if (cached && cached.expiresAt && cached.expiresAt > Date.now() && cached.value) {
        return cached.value;
      }
      const fresh = await buildHomeFeed();
      await cache.put(CACHE_KEYS.HOME_FEED, { value: fresh, expiresAt: Date.now() + ONE_MINUTE });
      return fresh;
    }
    return buildHomeFeed();
  };

  /**
   * Seeds initial content when the store is empty.
   * @return {Promise<void>}
   */
  const seedContent = async () => {
    const posts = await listRecords(CONTAINERS.POSTS);
    if (posts.length > 0) {
      return;
    }

    const now = new Date();
    const seedPosts = [
      {
        title: 'Welcome to NooblyJS Blog',
        subtitle: 'A modern publishing experience built on the NooblyJS Core accelerator',
        content: `Building a publication-quality blog no longer requires stitching together dozens of libraries. 
With NooblyJS Core we get data storage, caching, search, and observability out of the box.

This blog showcases how an API-first publishing workflow and a Bootstrap-powered client can deliver a Medium-like experience with minimal friction.

Highlights of this build:
- API-first Node.js backend with native routing
- Bootstrap 5 interface that feels at home on any device
- NooblyJS services for data, caching, search, queues, and metrics`,
        author: {
          name: 'NooblyJS Core Team',
          handle: 'core-team',
          avatar: 'https://avatars.dicebear.com/api/initials/NJ.svg'
        },
        tags: ['NooblyJS', 'Architecture', 'Product Updates'],
        coverImage: 'https://images.unsplash.com/photo-1523475472560-d2df97ec485c?auto=format&fit=crop&w=1400&q=80',
        status: 'published',
        publishedAt: new Date(now.getTime() - 3 * ONE_MINUTE).toISOString(),
        stats: {
          views: 128,
          claps: 32,
          bookmarks: 18,
          comments: 4
        }
      },
      {
        title: 'Designing an API-First Publishing Workflow',
        subtitle: 'From drafting to distribution—why API consistency matters',
        content: `An API-first mindset ensures that web, mobile, and partner experiences stay in sync.

In NooblyJS Blog every feature—from drafts to claps—is an HTTP endpoint. The Bootstrap client consumes those APIs the same way future integrations will.

Key practices:
1. Version every endpoint under /v1
2. Use consistent response envelopes
3. Document schemas alongside code with OpenAPI
4. Keep presentation concerns out of the API layer`,
        author: {
          name: 'Leah Ndlovu',
          handle: 'leah-n',
          avatar: 'https://images.unsplash.com/photo-1544723795-3fb6469f5b39?auto=format&fit=crop&w=240&q=80'
        },
        tags: ['API Design', 'Best Practices', 'Editorial'],
        coverImage: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1400&q=80',
        status: 'published',
        publishedAt: new Date(now.getTime() - ONE_MINUTE).toISOString(),
        stats: {
          views: 92,
          claps: 21,
          bookmarks: 9,
          comments: 2
        }
      }
    ];

    for (const seed of seedPosts) {
      await createPostRecord(seed);
    }
    await invalidateFeedCache();
    log.info('Seeded initial blog posts');
  };

  /**
   * Creates a post record with derived fields.
   * @param {Object} payload
   * @return {Promise<Object>}
   */
  const createPostRecord = async (payload) => {
    const status = payload.status || 'draft';
    const publishedAt = status === 'published' ? payload.publishedAt || new Date().toISOString() : null;
    const tags = normalizeTags(payload.tags);
    const content = payload.content || '';
    const title = (payload.title || '').trim();
    const subtitle = (payload.subtitle || '').trim();
    const author = normalizeAuthor(payload.author);

    const baseRecord = {
      title,
      subtitle,
      slug: payload.slug || toSlug(title || `post-${Date.now()}`),
      author,
      content,
      excerpt: payload.excerpt || buildExcerpt(content, 220),
      coverImage: payload.coverImage || null,
      tags,
      tagSlugs: tags.map((tag) => toSlug(tag)),
      status,
      publishedAt,
      scheduledFor: payload.scheduledFor || null,
      readTimeMinutes: estimateReadTime(content),
      stats: {
        views: payload.stats?.views || 0,
        claps: payload.stats?.claps || 0,
        bookmarks: payload.stats?.bookmarks || 0,
        comments: payload.stats?.comments || 0
      },
      seo: {
        title: payload.seo?.title || title,
        description: payload.seo?.description || buildExcerpt(content, 160),
        canonicalUrl: payload.seo?.canonicalUrl || null
      },
      contentFormat: payload.contentFormat || 'markdown'
    };

    const created = await createRecord(CONTAINERS.POSTS, baseRecord);
    await upsertSearchIndex(created);
    await invalidateFeedCache();
    return created;
  };

  /**
   * Normalizes an author payload.
   * @param {Object|string} author
   * @return {{name: string, handle: string, avatar: string|null, bio: string|null}}
   */
  function normalizeAuthor(author) {
    if (!author) {
      return {
        name: 'Anonymous',
        handle: 'anonymous',
        avatar: null,
        bio: null
      };
    }
    if (typeof author === 'string') {
      return {
        name: author,
        handle: toSlug(author) || 'contributor',
        avatar: null,
        bio: null
      };
    }
    return {
      name: author.name || 'Anonymous',
      handle: author.handle || toSlug(author.name || 'contributor'),
      avatar: author.avatar || null,
      bio: author.bio || null
    };
  }

  // Initialize data store
  containersReady
    .then(seedContent)
    .catch((error) => {
      log.error('Failed to seed blog content', { error: error.message });
    });

  /**
   * STATUS
   */
  app.get(`${API_BASE_PATH}/status`, async (req, res) => {
    try {
      await containersReady;
      const posts = await listRecords(CONTAINERS.POSTS);
      const comments = await listRecords(CONTAINERS.COMMENTS);
      const published = posts.filter((post) => post.status === 'published');
      sendJson(res, 200, {
        status: 'running',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        totals: {
          posts: posts.length,
          published: published.length,
          comments: comments.length
        }
      });
    } catch (error) {
      log.error('Status endpoint failed', { error: error.message });
      sendError(res, 500, 'STATUS_ERROR', 'Unable to retrieve blog status.');
    }
  });

  /**
   * HOME FEED
   */
  app.get(`${API_BASE_PATH}/feed/home`, async (_req, res) => {
    try {
      const feed = await getHomeFeed();
      sendJson(res, 200, feed, { cached: false });
    } catch (error) {
      log.error('Failed to load home feed', { error: error.message });
      sendError(res, 500, 'FEED_FETCH_FAILED', 'Unable to load home feed.');
    }
  });

  /**
   * POSTS COLLECTION
   */
  app.get(`${API_BASE_PATH}/posts`, async (req, res) => {
    try {
      const { status, tag, author, q, limit } = req.query;
      const posts = await listRecords(CONTAINERS.POSTS);
      let filtered = posts;

      if (status) {
        filtered = filtered.filter((post) => post.status === status);
      }

      if (tag) {
        filtered = filtered.filter((post) => (post.tags || []).includes(tag));
      }

      if (author) {
        filtered = filtered.filter((post) => post.author?.handle === author || post.author?.name === author);
      }

      if (q) {
        const searchTerm = q.toLowerCase();
        filtered = filtered.filter((post) => {
          return (
            post.title?.toLowerCase().includes(searchTerm) ||
            post.subtitle?.toLowerCase().includes(searchTerm) ||
            post.excerpt?.toLowerCase().includes(searchTerm) ||
            post.author?.name?.toLowerCase().includes(searchTerm) ||
            (post.tags || []).some((tagValue) => tagValue.toLowerCase().includes(searchTerm))
          );
        });
      }

      filtered.sort((a, b) => {
        const dateB = new Date(b.publishedAt || b.updatedAt || b.createdAt).getTime();
        const dateA = new Date(a.publishedAt || a.updatedAt || a.createdAt).getTime();
        return dateB - dateA;
      });

      const limited = limit ? filtered.slice(0, Number(limit)) : filtered;

      sendJson(res, 200, limited, {
        total: filtered.length,
        limit: limit ? Number(limit) : undefined
      });
    } catch (error) {
      log.error('Failed to list posts', { error: error.message });
      sendError(res, 500, 'POST_LIST_FAILED', 'Unable to load posts.');
    }
  });

  /**
   * CREATE POST
   */
  app.post(`${API_BASE_PATH}/posts`, async (req, res) => {
    try {
      const { title, content, tags, status, subtitle, author, coverImage, seo, scheduledFor } = req.body || {};
      if (!title || !content) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Title and content are required.');
      }

      const post = await createPostRecord({
        title,
        subtitle,
        content,
        tags,
        status,
        author,
        coverImage,
        seo,
        scheduledFor
      });

      sendJson(res, 201, post);
    } catch (error) {
      log.error('Failed to create post', { error: error.message });
      sendError(res, 500, 'POST_CREATE_FAILED', 'Unable to create post.');
    }
  });

  /**
   * GET POST DETAIL
   */
  app.get(`${API_BASE_PATH}/posts/:id`, async (req, res) => {
    try {
      const { id } = req.params;
      const post = await getRecord(CONTAINERS.POSTS, id);
      if (!post) {
        return sendError(res, 404, 'POST_NOT_FOUND', 'Post not found.');
      }

      const updated = await updateRecord(CONTAINERS.POSTS, id, (existing) => {
        const stats = {
          ...existing.stats,
          views: (existing.stats?.views || 0) + 1
        };
        return { ...existing, stats };
      });

      sendJson(res, 200, updated || post);
    } catch (error) {
      log.error('Failed to load post', { error: error.message });
      sendError(res, 500, 'POST_FETCH_FAILED', 'Unable to load post.');
    }
  });

  /**
   * UPDATE POST
   */
  app.patch(`${API_BASE_PATH}/posts/:id`, async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await getRecord(CONTAINERS.POSTS, id);
      if (!existing) {
        return sendError(res, 404, 'POST_NOT_FOUND', 'Post not found.');
      }

      const payload = req.body || {};
      if (payload.title !== undefined && !payload.title) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Title cannot be empty.');
      }
      if (payload.content !== undefined && !payload.content) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Content cannot be empty.');
      }

      const updated = await updateRecord(CONTAINERS.POSTS, id, (current) => {
        const nextStatus = payload.status || current.status;
        const content = payload.content !== undefined ? payload.content : current.content;
        const tags = payload.tags ? normalizeTags(payload.tags) : current.tags;
        const title = payload.title !== undefined ? payload.title.trim() : current.title;
        const subtitle = payload.subtitle !== undefined ? payload.subtitle.trim() : current.subtitle;
        const author = payload.author ? normalizeAuthor(payload.author) : current.author;

        return {
          ...current,
          title,
          subtitle,
          slug: payload.slug || (title ? toSlug(title) : current.slug),
          content,
          excerpt: payload.excerpt || buildExcerpt(content, 220),
          coverImage: payload.coverImage !== undefined ? payload.coverImage : current.coverImage,
          tags,
          tagSlugs: tags.map((tag) => toSlug(tag)),
          status: nextStatus,
          publishedAt: nextStatus === 'published' ? current.publishedAt || new Date().toISOString() : current.publishedAt,
          scheduledFor: payload.scheduledFor !== undefined ? payload.scheduledFor : current.scheduledFor,
          readTimeMinutes: estimateReadTime(content),
          stats: {
            ...current.stats
          },
          seo: {
            title: payload.seo?.title || current.seo?.title || title,
            description: payload.seo?.description || current.seo?.description || buildExcerpt(content, 160),
            canonicalUrl: payload.seo?.canonicalUrl !== undefined ? payload.seo?.canonicalUrl : current.seo?.canonicalUrl
          },
          author
        };
      });

      await upsertSearchIndex(updated);
      await invalidateFeedCache();
      sendJson(res, 200, updated);
    } catch (error) {
      log.error('Failed to update post', { error: error.message });
      sendError(res, 500, 'POST_UPDATE_FAILED', 'Unable to update post.');
    }
  });

  /**
   * DELETE POST
   */
  app.delete(`${API_BASE_PATH}/posts/:id`, async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await getRecord(CONTAINERS.POSTS, id);
      if (!existing) {
        return sendError(res, 404, 'POST_NOT_FOUND', 'Post not found.');
      }

      const success = await deleteRecord(CONTAINERS.POSTS, id);
      if (!success) {
        return sendError(res, 500, 'POST_DELETE_FAILED', 'Unable to delete post.');
      }

      await removeFromSearchIndex(id);
      await invalidateFeedCache();
      sendJson(res, 200, { id }, { deleted: true });
    } catch (error) {
      log.error('Failed to delete post', { error: error.message });
      sendError(res, 500, 'POST_DELETE_FAILED', 'Unable to delete post.');
    }
  });

  /**
   * PUBLISH POST
   */
  app.post(`${API_BASE_PATH}/posts/:id/publish`, async (req, res) => {
    try {
      const { id } = req.params;
      const { scheduledFor } = req.body || {};
      const existing = await getRecord(CONTAINERS.POSTS, id);
      if (!existing) {
        return sendError(res, 404, 'POST_NOT_FOUND', 'Post not found.');
      }

      const updated = await updateRecord(CONTAINERS.POSTS, id, (current) => ({
        ...current,
        status: scheduledFor ? 'scheduled' : 'published',
        scheduledFor: scheduledFor || null,
        publishedAt: scheduledFor ? current.publishedAt : current.publishedAt || new Date().toISOString()
      }));

      await upsertSearchIndex(updated);
      await invalidateFeedCache();
      sendJson(res, 200, updated);
    } catch (error) {
      log.error('Failed to publish post', { error: error.message });
      sendError(res, 500, 'POST_PUBLISH_FAILED', 'Unable to publish post.');
    }
  });

  /**
   * CLAP FOR A POST
   */
  app.post(`${API_BASE_PATH}/posts/:id/clap`, async (req, res) => {
    try {
      const { id } = req.params;
      const { amount = 1 } = req.body || {};
      const clapsToAdd = Math.max(1, Math.min(Number(amount) || 1, 50));

      const updated = await updateRecord(CONTAINERS.POSTS, id, (current) => {
        if (!current) return null;
        const stats = {
          ...current.stats,
          claps: (current.stats?.claps || 0) + clapsToAdd
        };
        return { ...current, stats };
      });

      if (!updated) {
        return sendError(res, 404, 'POST_NOT_FOUND', 'Post not found.');
      }

      await invalidateFeedCache();
      sendJson(res, 200, updated);
    } catch (error) {
      log.error('Failed to clap post', { error: error.message });
      sendError(res, 500, 'POST_CLAP_FAILED', 'Unable to record applause.');
    }
  });

  /**
   * BOOKMARK A POST
   */
  app.post(`${API_BASE_PATH}/posts/:id/bookmark`, async (req, res) => {
    try {
      const { id } = req.params;
      const updated = await updateRecord(CONTAINERS.POSTS, id, (current) => {
        if (!current) return null;
        const stats = {
          ...current.stats,
          bookmarks: (current.stats?.bookmarks || 0) + 1
        };
        return { ...current, stats };
      });
      if (!updated) {
        return sendError(res, 404, 'POST_NOT_FOUND', 'Post not found.');
      }
      await invalidateFeedCache();
      sendJson(res, 200, updated);
    } catch (error) {
      log.error('Failed to bookmark post', { error: error.message });
      sendError(res, 500, 'POST_BOOKMARK_FAILED', 'Unable to bookmark post.');
    }
  });

  /**
   * LIST COMMENTS FOR POST
   */
  app.get(`${API_BASE_PATH}/posts/:id/comments`, async (req, res) => {
    try {
      const { id } = req.params;
      const comments = await listRecords(CONTAINERS.COMMENTS);
      const filtered = comments
        .filter((comment) => comment.postId === id)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      sendJson(res, 200, filtered, { total: filtered.length });
    } catch (error) {
      log.error('Failed to list comments', { error: error.message });
      sendError(res, 500, 'COMMENT_LIST_FAILED', 'Unable to load comments.');
    }
  });

  /**
   * CREATE COMMENT
   */
  app.post(`${API_BASE_PATH}/posts/:id/comments`, async (req, res) => {
    try {
      const { id } = req.params;
      const post = await getRecord(CONTAINERS.POSTS, id);
      if (!post) {
        return sendError(res, 404, 'POST_NOT_FOUND', 'Post not found.');
      }

      const { body, author } = req.body || {};
      if (!body || !body.trim()) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Comment text is required.');
      }

      const commentRecord = {
        postId: id,
        author: normalizeAuthor(author),
        body: body.trim(),
        status: 'published'
      };

      const created = await createRecord(CONTAINERS.COMMENTS, commentRecord);
      await updateRecord(CONTAINERS.POSTS, id, (current) => ({
        ...current,
        stats: {
          ...current.stats,
          comments: (current.stats?.comments || 0) + 1
        }
      }));
      await invalidateFeedCache();
      sendJson(res, 201, created);
    } catch (error) {
      log.error('Failed to create comment', { error: error.message });
      sendError(res, 500, 'COMMENT_CREATE_FAILED', 'Unable to create comment.');
    }
  });

  /**
   * UPDATE COMMENT
   */
  app.patch(`${API_BASE_PATH}/comments/:id`, async (req, res) => {
    try {
      const { id } = req.params;
      const { body, status } = req.body || {};

      const updated = await updateRecord(CONTAINERS.COMMENTS, id, (current) => {
        if (!current) return null;
        return {
          ...current,
          body: body !== undefined ? body.trim() : current.body,
          status: status || current.status
        };
      });

      if (!updated) {
        return sendError(res, 404, 'COMMENT_NOT_FOUND', 'Comment not found.');
      }
      sendJson(res, 200, updated);
    } catch (error) {
      log.error('Failed to update comment', { error: error.message });
      sendError(res, 500, 'COMMENT_UPDATE_FAILED', 'Unable to update comment.');
    }
  });

  /**
   * GLOBAL TAG LIST
   */
  app.get(`${API_BASE_PATH}/tags`, async (_req, res) => {
    try {
      const posts = await listRecords(CONTAINERS.POSTS);
      const tagCounts = new Map();
      posts.forEach((post) => {
        if (post.status !== 'published') return;
        (post.tags || []).forEach((tag) => {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        });
      });
      const tags = Array.from(tagCounts.entries())
        .map(([tag, count]) => ({ tag, count, slug: toSlug(tag) }))
        .sort((a, b) => b.count - a.count);
      sendJson(res, 200, tags, { total: tags.length });
    } catch (error) {
      log.error('Failed to list tags', { error: error.message });
      sendError(res, 500, 'TAG_LIST_FAILED', 'Unable to load tags.');
    }
  });

  /**
   * SEARCH POSTS
   */
  app.get(`${API_BASE_PATH}/search`, async (req, res) => {
    try {
      const { q } = req.query;
      if (!q || !q.trim()) {
        return sendJson(res, 200, []);
      }

      if (search && typeof search.search === 'function') {
        const results = await search.search(q.trim(), 'blog-posts');
        sendJson(res, 200, results.map((entry) => entry.object || entry));
        return;
      }

      const posts = await listRecords(CONTAINERS.POSTS);
      const term = q.trim().toLowerCase();
      const matches = posts.filter((post) => {
        return (
          post.title?.toLowerCase().includes(term) ||
          post.subtitle?.toLowerCase().includes(term) ||
          post.excerpt?.toLowerCase().includes(term) ||
          (post.tags || []).some((tag) => tag.toLowerCase().includes(term))
        );
      });
      sendJson(res, 200, matches);
    } catch (error) {
      log.error('Failed to search posts', { error: error.message });
      sendError(res, 500, 'SEARCH_FAILED', 'Unable to search posts.');
    }
  });
};
