'use strict';

const path = require('path');
const fs = require('fs').promises;

const POST_EXTENSION = '.post';

/**
 * Creates a file-backed post store using the NooblyJS filing service.
 * @param {Object} deps
 * @param {Object} deps.filing
 * @param {Object} deps.logger
 * @param {Function} deps.toSlug
 * @param {Function} deps.buildExcerpt
 * @param {Function} deps.estimateReadTime
 * @param {Function} deps.normalizeTags
 * @param {Function} deps.normalizeAuthor
 * @return {Object}
 */
function createFilePostStore({ filing, logger, toSlug, buildExcerpt, estimateReadTime, normalizeTags, normalizeAuthor }) {
  if (!filing) {
    throw new Error('filePostStore requires a filing provider.');
  }

  const log = logger || {
    info: () => {},
    error: console.error.bind(console, '[postStore:error]')
  };

  const baseDir = path.resolve(process.cwd(), 'posts');
  const publishedDir = path.join(baseDir, 'published');
  const draftsDir = path.join(baseDir, 'drafts');

  let readyPromise;

  const ensureReady = () => {
    if (!readyPromise) {
      readyPromise = (async () => {
        await fs.mkdir(publishedDir, { recursive: true });
        await fs.mkdir(draftsDir, { recursive: true });
        await seedIfNeeded();
      })().catch((error) => {
        log.error?.('postStore initialization failed', { error: error.message });
        throw error;
      });
    }
    return readyPromise;
  };

  const isPostFile = (fileName) => fileName.endsWith(POST_EXTENSION);

  const safeList = async (dir) => {
    try {
      return await filing.list(dir);
    } catch (error) {
      if (error.code === 'ENOENT') {
        await fs.mkdir(dir, { recursive: true });
        return [];
      }
      throw error;
    }
  };

  const fileExists = async (filePath) => {
    try {
      await fs.access(filePath);
      return true;
    } catch (_) {
      return false;
    }
  };

  const parseDocument = (raw = '') => {
    const text = raw.toString();
    const lines = text.split(/\r?\n/);
    const storyIndex = lines.findIndex((line) => line.trim().toLowerCase() === 'story:');
    const headerLines = storyIndex === -1 ? lines : lines.slice(0, storyIndex);
    const storyLines = storyIndex === -1 ? [] : lines.slice(storyIndex + 1);
    const meta = {};
    headerLines.forEach((line) => {
      const separator = line.indexOf(':');
      if (separator === -1) return;
      const key = line.slice(0, separator).trim().toLowerCase();
      const value = line.slice(separator + 1).trim();
      if (key) {
        meta[key] = value;
      }
    });
    const story = storyLines.join('\n').replace(/^\s*\n/, '').replace(/\r\n/g, '\n');
    return { meta, story };
  };

  const parseDateField = (value) => {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const direct = new Date(trimmed);
    if (!Number.isNaN(direct.getTime())) {
      return direct.toISOString();
    }
    const match = trimmed.match(/^(\d{4})[\/-](\d{2})[\/-](\d{2})(?:\s+(\d{2}):(\d{2}))?$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = match[4] !== undefined ? Number(match[4]) : 0;
    const minute = match[5] !== undefined ? Number(match[5]) : 0;
    if (!year || !month || !day) return null;
    const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute));
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
  };

  const pad2 = (value) => String(value).padStart(2, '0');

  const formatDateOutput = (iso) => {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getUTCFullYear();
    const month = pad2(date.getUTCMonth() + 1);
    const day = pad2(date.getUTCDate());
    return `${year}/${month}/${day}`;
  };

  const formatDateTimeOutput = (iso) => {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const time = `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
    return `${formatDateOutput(iso)} ${time}`;
  };

  const normalizeStatus = (value) => {
    const status = (value || '').toString().toLowerCase();
    if (status === 'published') return 'published';
    if (status === 'scheduled') return 'scheduled';
    return 'draft';
  };

  const attachInternal = (post, filePath) => {
    if (filePath) {
      Object.defineProperty(post, '__filePath', {
        value: filePath,
        enumerable: false,
        writable: true,
        configurable: true
      });
    }
    return post;
  };

  const finalize = (post, filePath) => {
    const result = {
      ...post,
      tags: Array.isArray(post.tags) ? [...post.tags] : [],
      tagSlugs: Array.isArray(post.tagSlugs) ? [...post.tagSlugs] : [],
      stats: {
        views: Number(post.stats?.views || 0),
        claps: Number(post.stats?.claps || 0),
        bookmarks: Number(post.stats?.bookmarks || 0),
        comments: Number(post.stats?.comments || 0)
      },
      author: post.author ? { ...post.author } : null,
      seo: post.seo ? { ...post.seo } : null
    };
    result.contentFormat = post.contentFormat || 'markdown';
    attachInternal(result, filePath);
    return result;
  };

  const buildRecordFromMeta = (meta, story, filePath, statusHint, fileStats) => {
    const id = path.basename(filePath, POST_EXTENSION);
    const title = meta.title || 'Untitled';
    const content = (story || '').replace(/\r\n/g, '\n').trimEnd();
    const tags = normalizeTags(meta.tags ? meta.tags.split(',') : []);
    const slug = meta.slug || toSlug(title) || id;
    const author = normalizeAuthor(meta.author || 'Anonymous');
    const status = normalizeStatus(meta.status || statusHint);
    const scheduledFor = parseDateField(meta.schedule);
    let publishedAt = parseDateField(meta.published);
    if (status !== 'published') {
      if (status !== 'scheduled') {
        publishedAt = null;
      }
    } else if (!publishedAt && fileStats) {
      publishedAt = fileStats.mtime.toISOString();
    }
    const createdAt = parseDateField(meta.created) || publishedAt || (fileStats ? fileStats.birthtime.toISOString() : new Date().toISOString());
    const updatedAt = parseDateField(meta.updated) || (fileStats ? fileStats.mtime.toISOString() : createdAt);
    const stats = {
      views: Number(meta.views ?? 0) || 0,
      claps: Number(meta.claps ?? 0) || 0,
      bookmarks: Number(meta.bookmarks ?? 0) || 0,
      comments: Number(meta.comments ?? 0) || 0
    };

    const record = {
      id,
      title,
      subtitle: meta.subtitle || '',
      slug,
      author,
      content,
      excerpt: buildExcerpt(content, 220),
      coverImage: meta['cover image url'] || null,
      tags,
      tagSlugs: tags.map((tag) => toSlug(tag)),
      status,
      publishedAt,
      scheduledFor,
      readTimeMinutes: estimateReadTime(content),
      stats,
      seo: {
        title,
        description: buildExcerpt(content, 160),
        canonicalUrl: null
      },
      contentFormat: 'markdown',
      createdAt,
      updatedAt
    };

    return record;
  };

  const serializePost = (post) => {
    const tagsLine = Array.isArray(post.tags) ? post.tags.join(', ') : '';
    const story = (post.content || '').replace(/\r\n/g, '\n').trimEnd();
    const lines = [
      ['Title', post.title || 'Untitled'],
      ['Subtitle', post.subtitle || ''],
      ['Author', post.author?.name || 'Anonymous'],
      ['Tags', tagsLine],
      ['Cover Image URL', post.coverImage || ''],
      ['Slug', post.slug || post.id],
      ['Status', post.status || 'draft'],
      ['Published', formatDateOutput(post.publishedAt)],
      ['Schedule', formatDateTimeOutput(post.scheduledFor)],
      ['Created', post.createdAt || ''],
      ['Updated', post.updatedAt || ''],
      ['Claps', Number(post.stats?.claps || 0)],
      ['Bookmarks', Number(post.stats?.bookmarks || 0)],
      ['Views', Number(post.stats?.views || 0)],
      ['Comments', Number(post.stats?.comments || 0)]
    ];
    const header = lines
      .map(([label, value]) => `${label}: ${value === null || value === undefined ? '' : value}`)
      .join('\n');
    const storyBlock = story ? `${story}\n` : '';
    return `${header}\n\nStory:\n\n${storyBlock}`;
  };

  const persistRecord = async (record, previousPath) => {
    await ensureReady();
    const normalized = {
      ...record,
      id: record.id,
      title: record.title || 'Untitled',
      subtitle: record.subtitle || '',
      tags: Array.isArray(record.tags) ? [...record.tags] : [],
      stats: { ...(record.stats || {}) },
      seo: record.seo ? { ...record.seo } : null,
      author: record.author ? { ...record.author } : record.author
    };

    normalized.slug = normalized.slug || toSlug(normalized.title) || normalized.id;
    normalized.status = normalizeStatus(normalized.status);
    normalized.tags = normalizeTags(normalized.tags);
    normalized.tagSlugs = normalized.tags.map((tag) => toSlug(tag));
    normalized.author = normalizeAuthor(normalized.author);
    normalized.content = (normalized.content || '').replace(/\r\n/g, '\n');
    normalized.excerpt = normalized.excerpt || buildExcerpt(normalized.content, 220);
    normalized.readTimeMinutes = normalized.readTimeMinutes || estimateReadTime(normalized.content);
    normalized.coverImage = normalized.coverImage || null;
    normalized.scheduledFor = normalized.scheduledFor || null;
    if (normalized.status === 'published') {
      normalized.publishedAt = normalized.publishedAt || new Date().toISOString();
    } else if (normalized.status === 'scheduled') {
      normalized.publishedAt = normalized.publishedAt || null;
    } else {
      normalized.publishedAt = null;
    }
    normalized.stats = {
      views: Number(normalized.stats.views || 0),
      claps: Number(normalized.stats.claps || 0),
      bookmarks: Number(normalized.stats.bookmarks || 0),
      comments: Number(normalized.stats.comments || 0)
    };
    normalized.seo = normalized.seo
      ? {
          title: normalized.seo.title || normalized.title,
          description: normalized.seo.description || buildExcerpt(normalized.content, 160),
          canonicalUrl: normalized.seo.canonicalUrl || null
        }
      : {
          title: normalized.title,
          description: buildExcerpt(normalized.content, 160),
          canonicalUrl: null
        };
    normalized.contentFormat = normalized.contentFormat || 'markdown';

    const nowIso = new Date().toISOString();
    normalized.createdAt = normalized.createdAt || nowIso;
    normalized.updatedAt = nowIso;

    const targetDir = normalized.status === 'published' ? publishedDir : draftsDir;
    const targetPath = path.join(targetDir, `${normalized.id}${POST_EXTENSION}`);
    const doc = serializePost(normalized);

    if (await fileExists(targetPath)) {
      await filing.update(targetPath, doc);
    } else {
      await filing.create(targetPath, doc);
    }

    if (previousPath && previousPath !== targetPath) {
      try {
        await filing.delete(previousPath);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }
    }

    return finalize(normalized, targetPath);
  };

  const readPostFile = async (filePath, statusHint) => {
    const raw = await filing.read(filePath, 'utf8');
    let fileStats = null;
    try {
      fileStats = await fs.stat(filePath);
    } catch (_) {
      // ignore stat errors
    }
    const { meta, story } = parseDocument(raw);
    const record = buildRecordFromMeta(meta, story, filePath, statusHint, fileStats);
    return finalize(record, filePath);
  };

  const readDirectory = async (dir, statusHint) => {
    const files = (await safeList(dir)).filter(isPostFile);
    const posts = [];
    for (const file of files) {
      const filePath = path.join(dir, file);
      posts.push(await readPostFile(filePath, statusHint));
    }
    return posts;
  };

  const listAll = async () => {
    await ensureReady();
    const [published, drafts] = await Promise.all([readDirectory(publishedDir, 'published'), readDirectory(draftsDir, 'draft')]);
    return [...published, ...drafts];
  };

  const get = async (id) => {
    await ensureReady();
    const publishedPath = path.join(publishedDir, `${id}${POST_EXTENSION}`);
    if (await fileExists(publishedPath)) {
      return readPostFile(publishedPath, 'published');
    }
    const draftPath = path.join(draftsDir, `${id}${POST_EXTENSION}`);
    if (await fileExists(draftPath)) {
      return readPostFile(draftPath, 'draft');
    }
    return null;
  };

  const ensureUniqueId = async (baseId) => {
    let candidate = baseId;
    let suffix = 1;
    while (
      await fileExists(path.join(publishedDir, `${candidate}${POST_EXTENSION}`)) ||
      await fileExists(path.join(draftsDir, `${candidate}${POST_EXTENSION}`))
    ) {
      candidate = `${baseId}-${suffix++}`;
    }
    return candidate;
  };

  const create = async (payload) => {
    await ensureReady();
    const baseSlug = toSlug(payload.slug || payload.title || `post-${Date.now()}`) || `post-${Date.now()}`;
    const id = await ensureUniqueId(baseSlug);
    const record = {
      ...payload,
      id,
      slug: payload.slug || baseSlug
    };
    return persistRecord(record);
  };

  const update = async (id, updater) => {
    await ensureReady();
    const existing = await get(id);
    if (!existing) return null;
    const previousPath = existing.__filePath;
    const base = finalize(existing, previousPath);
    let next;
    if (typeof updater === 'function') {
      next = await updater(base);
    } else {
      next = { ...base, ...updater };
    }
    if (!next) return null;
    next.id = id;
    next.slug = next.slug || existing.slug || id;
    next.createdAt = next.createdAt || existing.createdAt;
    return persistRecord(next, previousPath);
  };

  const remove = async (id) => {
    await ensureReady();
    const publishedPath = path.join(publishedDir, `${id}${POST_EXTENSION}`);
    if (await fileExists(publishedPath)) {
      await filing.delete(publishedPath);
      return true;
    }
    const draftPath = path.join(draftsDir, `${id}${POST_EXTENSION}`);
    if (await fileExists(draftPath)) {
      await filing.delete(draftPath);
      return true;
    }
    return false;
  };

  const buildSamplePosts = () => {
    const samples = [];
    const author = normalizeAuthor('Stephen');

    const firstContent = `Stephen keeps a journal of the tiny rebellions that stack into a life.

He writes before dawn, deleting more than he keeps, trusting that consistency beats sudden flashes of genius.

The courage he leans on is quiet: publish the note, share the draft, ask for the uncomfortable feedback.

Key rituals he returns to:
- Block time for wandering research.
- Track claps only to celebrate the reader, not the ego.
- Ship a paragraph even when the story feels half baked.`;

    const firstPost = {
      id: toSlug('Quiet Courage for Future Posts'),
      title: 'Quiet Courage for Future Posts',
      subtitle: 'Why Stephen trusts tiny habits more than viral spikes.',
      slug: toSlug('Quiet Courage for Future Posts'),
      author,
      content: firstContent,
      coverImage: 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=1600&q=80',
      tags: ['inspite', 'life', 'craft'],
      status: 'published',
      publishedAt: new Date(Date.UTC(2024, 2, 20, 9, 30)).toISOString(),
      scheduledFor: null,
      stats: {
        views: 1280,
        claps: 312,
        bookmarks: 146,
        comments: 14
      },
      seo: {
        title: 'Quiet Courage for Future Posts',
        description: buildExcerpt(firstContent, 160),
        canonicalUrl: null
      },
      createdAt: new Date(Date.UTC(2024, 2, 19, 7, 15)).toISOString(),
      updatedAt: new Date(Date.UTC(2024, 2, 20, 9, 30)).toISOString()
    };
    firstPost.tags = normalizeTags(firstPost.tags);
    firstPost.tagSlugs = firstPost.tags.map((tag) => toSlug(tag));
    firstPost.excerpt = buildExcerpt(firstPost.content, 220);
    firstPost.readTimeMinutes = estimateReadTime(firstPost.content);
    firstPost.contentFormat = 'markdown';
    samples.push(firstPost);

    const secondContent = `Stephen maps the drafts he never published.

Some become talks, some whisper into newsletters, and a few hibernate until a better example arrives.

He now keeps a \"rituals board\" beside his desk:
- Monday mornings celebrate community wins.
- Wednesdays reserve time for structure edits.
- Fridays highlight a reader's question.

Scheduling creativity sounds cold, but the calendar liberates his weekends for real adventures.`;

    const secondPost = {
      id: toSlug('Scheduling Wonder Without Killing Joy'),
      title: 'Scheduling Wonder Without Killing Joy',
      subtitle: 'Stephen proves that planning can still leave room for spontaneity.',
      slug: toSlug('Scheduling Wonder Without Killing Joy'),
      author,
      content: secondContent,
      coverImage: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1600&q=80',
      tags: ['inspite', 'life', 'systems'],
      status: 'published',
      publishedAt: new Date(Date.UTC(2024, 3, 2, 14, 5)).toISOString(),
      scheduledFor: null,
      stats: {
        views: 940,
        claps: 245,
        bookmarks: 101,
        comments: 9
      },
      seo: {
        title: 'Scheduling Wonder Without Killing Joy',
        description: buildExcerpt(secondContent, 160),
        canonicalUrl: null
      },
      createdAt: new Date(Date.UTC(2024, 3, 1, 16, 40)).toISOString(),
      updatedAt: new Date(Date.UTC(2024, 3, 2, 14, 5)).toISOString()
    };
    secondPost.tags = normalizeTags(secondPost.tags);
    secondPost.tagSlugs = secondPost.tags.map((tag) => toSlug(tag));
    secondPost.excerpt = buildExcerpt(secondPost.content, 220);
    secondPost.readTimeMinutes = estimateReadTime(secondPost.content);
    secondPost.contentFormat = 'markdown';
    samples.push(secondPost);

    const draftContent = `This draft is the reminder Stephen refuses to delete.

It holds the questions he will answer once the next cohort of readers arrives.

He keeps it close to remember that drafts are promises, not debts.`;

    const draftPost = {
      id: toSlug('The Draft Stephen Keeps Nearby'),
      title: 'The Draft Stephen Keeps Nearby',
      subtitle: 'A letter to his future collaborators.',
      slug: toSlug('The Draft Stephen Keeps Nearby'),
      author,
      content: draftContent,
      coverImage: 'https://images.unsplash.com/photo-1489515217757-5fd1be406fef?auto=format&fit=crop&w=1600&q=80',
      tags: ['inspite', 'life', 'reflection'],
      status: 'draft',
      publishedAt: null,
      scheduledFor: new Date(Date.UTC(2024, 5, 1, 11, 0)).toISOString(),
      stats: {
        views: 0,
        claps: 68,
        bookmarks: 17,
        comments: 0
      },
      seo: {
        title: 'The Draft Stephen Keeps Nearby',
        description: buildExcerpt(draftContent, 160),
        canonicalUrl: null
      },
      createdAt: new Date(Date.UTC(2024, 2, 28, 10, 20)).toISOString(),
      updatedAt: new Date(Date.UTC(2024, 2, 28, 10, 20)).toISOString()
    };
    draftPost.tags = normalizeTags(draftPost.tags);
    draftPost.tagSlugs = draftPost.tags.map((tag) => toSlug(tag));
    draftPost.excerpt = buildExcerpt(draftPost.content, 220);
    draftPost.readTimeMinutes = estimateReadTime(draftPost.content);
    draftPost.contentFormat = 'markdown';
    samples.push(draftPost);

    return samples;
  };

  const seedIfNeeded = async () => {
    const publishedFiles = (await safeList(publishedDir)).filter(isPostFile);
    const draftFiles = (await safeList(draftsDir)).filter(isPostFile);
    if (publishedFiles.length || draftFiles.length) {
      return;
    }
    const samples = buildSamplePosts();
    for (const sample of samples) {
      await persistRecord(sample);
    }
    log.info?.('Seeded sample posts', { count: samples.length });
  };

  return {
    ready: ensureReady,
    listAll,
    get,
    create,
    update,
    remove
  };
}

module.exports = createFilePostStore;
