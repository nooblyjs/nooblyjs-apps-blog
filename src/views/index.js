'use strict';

const path = require('path');
const express = require('express');
const { promises: fs } = require('fs');

const VIEW_BASE_PATH = '/applications/blog';
const STATIC_PATH = `${VIEW_BASE_PATH}/assets`;

// Default site settings
const DEFAULT_SITE_SETTINGS = {
  title: 'NooblyJS Blog',
  primaryColor: '#0d6efd',
  backgroundColor: '#ffffff',
  bannerImage: '',
  links: {
    twitter: '',
    instagram: '',
    tiktok: '',
    custom: { name: '', url: '' }
  }
};

const SETTINGS_FILE_PATH = path.join(process.cwd(), '.data', 'blog-settings.json');

/**
 * Loads site settings from file or returns defaults
 */
async function loadSettings() {
  try {
    const data = await fs.readFile(SETTINGS_FILE_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return DEFAULT_SITE_SETTINGS;
    }
    console.error('Error loading settings:', error);
    return DEFAULT_SITE_SETTINGS;
  }
}

/**
 * Generates CSS string for custom theme
 */
function generateThemeCSS(settings) {
  const { primaryColor = DEFAULT_SITE_SETTINGS.primaryColor, backgroundColor = DEFAULT_SITE_SETTINGS.backgroundColor } = settings;

  return `<style id="theme-overrides">
/* Inject custom theme before page renders to avoid flash of unstyled content */
:root {
  --bs-primary: ${primaryColor};
  --bs-body-bg: ${backgroundColor};
}
body {
  background-color: ${backgroundColor} !important;
}
.navbar.bg-primary,
.navbar.bg-primary .navbar-toggler,
.btn-primary,
.badge.bg-primary,
.badge.bg-primary-subtle,
.btn-outline-primary,
.btn-outline-primary:hover,
.spinner-border.text-primary {
  background-color: ${primaryColor} !important;
  border-color: ${primaryColor} !important;
}
.text-primary,
.text-primary-emphasis {
  color: ${primaryColor} !important;
}
.form-control.bg-primary-subtle,
.input-group-text.bg-primary-subtle {
  background-color: ${primaryColor}20 !important;
}
.bg-primary-subtle {
  background-color: ${primaryColor}20 !important;
}
</style>`;
}

/**
 * Injects theme CSS into HTML content
 */
function injectThemeCSS(htmlContent, themeCSS) {
  // Insert after the custom styles.css link to ensure it overrides Bootstrap defaults
  return htmlContent.replace(
    '</head>',
    `${themeCSS}\n</head>`
  );
}

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

  // HTML entrypoints for the blog interfaces with injected theme CSS
  const sendIndex = async (_req, res) => {
    try {
      const settings = await loadSettings();
      let htmlContent = await fs.readFile(path.join(viewRoot, 'index.html'), 'utf8');
      const themeCSS = generateThemeCSS(settings);
      htmlContent = injectThemeCSS(htmlContent, themeCSS);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(htmlContent);
    } catch (error) {
      log.error('Error rendering index', { error: error.message });
      res.sendFile(path.join(viewRoot, 'index.html'));
    }
  };

  const sendAuthor = async (_req, res) => {
    try {
      const settings = await loadSettings();
      let htmlContent = await fs.readFile(path.join(viewRoot, 'author.html'), 'utf8');
      const themeCSS = generateThemeCSS(settings);
      htmlContent = injectThemeCSS(htmlContent, themeCSS);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(htmlContent);
    } catch (error) {
      log.error('Error rendering author', { error: error.message });
      res.sendFile(path.join(viewRoot, 'author.html'));
    }
  };

  const protect = typeof servicesAuthMiddleware === 'function' ? servicesAuthMiddleware : (_req, _res, next) => next();

  app.get(VIEW_BASE_PATH, sendIndex);
  app.get(`${VIEW_BASE_PATH}/`, sendIndex);
  app.get(`${VIEW_BASE_PATH}/posts/:slug`, sendIndex);
  app.get(`${VIEW_BASE_PATH}/posts/:slug/`, sendIndex);
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
