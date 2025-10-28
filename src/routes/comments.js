'use strict';

const { API_BASE_PATH, CONTAINERS, normalizeAuthor, sendJson, sendError } = require('./shared/helpers');

/**
 * Registers comment routes.
 * @param {Object} app Express application
 * @param {Object} dataStore Data store instance
 * @param {Object} log Logger instance
 */
module.exports = (app, dataStore, log) => {
  const { getRecord, listRecords, createRecord, updateRecord, invalidateFeedCache } = dataStore;

  /**
   * LIST COMMENTS FOR A POST
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
   * CREATE COMMENT FOR A POST
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
};
