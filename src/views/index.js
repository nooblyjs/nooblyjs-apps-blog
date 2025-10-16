'use strict';

const path = require('path');
const express = require('express');

const VIEW_BASE_PATH = '/applications/blog';
const STATIC_PATH = `${VIEW_BASE_PATH}/assets`;

/**
 * Registers view routes for the blog experience.
 *
 * @param {Object} options Express binding
 * @param {import('events').EventEmitter} eventEmitter
 * @param {Object} services NooblyJS services (logger, cache, dataService, etc.)
 */
module.exports = (options, eventEmitter, services) => {
  const app = options.app;
  const { logger, servicesAuthMiddleware } = services;

  const log = logger || {
    info: console.log.bind(console, '[blog:view]'),
    error: console.error.bind(console, '[blog:view]')
  };

  const viewRoot = __dirname;
  const staticRoot = path.join(__dirname, 'js');

  // Serve compiled client assets (vanilla JS modules, helpers)
  app.use(STATIC_PATH, express.static(staticRoot));

  // HTML entrypoints for the blog interfaces
  const sendIndex = (_req, res) => {
    res.sendFile(path.join(viewRoot, 'index.html'));
  };

  const sendAuthor = (_req, res) => {
    res.sendFile(path.join(viewRoot, 'author.html'));
  };

  const protect = typeof servicesAuthMiddleware === 'function' ? servicesAuthMiddleware : (_req, _res, next) => next();

  app.get(VIEW_BASE_PATH, sendIndex);
  app.get(`${VIEW_BASE_PATH}/`, sendIndex);
  app.get(`${VIEW_BASE_PATH}/author`, protect, sendAuthor);
  app.get(`${VIEW_BASE_PATH}/author/`, protect, sendAuthor);
  app.get('/appplications/blog/author', (_req, res) => res.redirect(`${VIEW_BASE_PATH}/author`));

  // Provide a lightweight manifest endpoint for client bootstrapping
  app.get(`${VIEW_BASE_PATH}/manifest.json`, (_req, res) => {
    res.json({
      name: 'NooblyJS Blog',
      short_name: 'NooblyBlog',
      description: 'A Medium-inspired publishing experience built on NooblyJS Core.',
      icons: [],
      start_url: VIEW_BASE_PATH,
      display: 'standalone',
      lang: 'en'
    });
  });

  log.info('Blog views registered', { basePath: VIEW_BASE_PATH, assets: STATIC_PATH, authorPath: `${VIEW_BASE_PATH}/author` });
};
