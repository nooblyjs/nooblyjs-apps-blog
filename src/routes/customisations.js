'use strict';

const path = require('path');
const { promises: fs } = require('fs');
const { DEFAULT_SITE_SETTINGS, sendJson, sendError } = require('./shared/helpers');

const SETTINGS_FILE_PATH = path.join(process.cwd(), '.data', 'blog-settings.json');

/**
 * Loads site settings from file or returns defaults.
 */
async function loadSettings() {
  try {
    const data = await fs.readFile(SETTINGS_FILE_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return DEFAULT_SITE_SETTINGS;
    }
    throw error;
  }
}

/**
 * Saves site settings to file.
 */
async function saveSettings(settings, log) {
  try {
    const dataDir = path.dirname(SETTINGS_FILE_PATH);
    await fs.mkdir(dataDir, { recursive: true });

    const { id, key, createdAt, updatedAt, ...cleanSettings } = settings;

    await fs.writeFile(SETTINGS_FILE_PATH, JSON.stringify(cleanSettings, null, 2), 'utf8');
    return cleanSettings;
  } catch (error) {
    log.error('Failed to save settings file', { error: error.message });
    throw error;
  }
}

/**
 * Registers customisation/settings routes.
 * @param {Object} app Express application
 * @param {Object} log Logger instance
 */
module.exports = (app, log) => {
  /**
   * GET SITE SETTINGS
   */
  app.get('/applications/blog/api/settings', async (_req, res) => {
    try {
      const settings = await loadSettings();
      sendJson(res, 200, settings);
    } catch (error) {
      log.error('Failed to load settings', { error: error.message });
      sendError(res, 500, 'SETTINGS_FETCH_FAILED', 'Unable to load site settings.');
    }
  });

  /**
   * UPDATE SITE SETTINGS
   */
  app.patch('/applications/blog/api/settings', async (req, res) => {
    try {
      const payload = req.body || {};
      const currentSettings = await loadSettings();

      const updatedSettings = {
        ...currentSettings,
        title: payload.title !== undefined ? payload.title : currentSettings.title,
        primaryColor: payload.primaryColor !== undefined ? payload.primaryColor : currentSettings.primaryColor,
        backgroundColor: payload.backgroundColor !== undefined ? payload.backgroundColor : currentSettings.backgroundColor,
        bannerImage: payload.bannerImage !== undefined ? payload.bannerImage : currentSettings.bannerImage,
        links: {
          twitter: payload.links?.twitter !== undefined ? payload.links.twitter : currentSettings.links?.twitter || '',
          instagram: payload.links?.instagram !== undefined ? payload.links.instagram : currentSettings.links?.instagram || '',
          tiktok: payload.links?.tiktok !== undefined ? payload.links.tiktok : currentSettings.links?.tiktok || '',
          custom: {
            name: payload.links?.custom?.name !== undefined ? payload.links.custom.name : currentSettings.links?.custom?.name || '',
            url: payload.links?.custom?.url !== undefined ? payload.links.custom.url : currentSettings.links?.custom?.url || ''
          }
        }
      };

      await saveSettings(updatedSettings, log);
      sendJson(res, 200, updatedSettings);
    } catch (error) {
      log.error('Failed to update settings', { error: error.message });
      sendError(res, 500, 'SETTINGS_UPDATE_FAILED', 'Unable to update site settings.');
    }
  });
};
