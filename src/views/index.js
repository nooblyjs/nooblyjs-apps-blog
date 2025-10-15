
/**
 * @fileoverview Wiki service views module for noobly-applications framework.
 * This module provides Express.js view registration and static file serving 
 * capabilities for the Wiki service. It registers static routes to serve
 * Wiki-related view files and templates through the Express application.
 * 
 * @author NooblyJS
 * @version 1.0.0
 * @module Wiki
 */

'use strict';

const path = require('path');
const express = require('express');

/**
 * Wiki service views module for noobly-applications framework.
 * This module provides Express.js view registration and static file serving 
 * capabilities for the Wiki service. It registers static routes to serve
 * Wiki-related view files and templates through the Express application.
 * 
 * @function
 * @param {Object} options - Configuration options for the views setup
 * @param {express.Application} options.express-app - The Express application instance
 * @param {Object} eventEmitter - Event emitter instance for inter-service communication
 * @param {Object} services - NooblyJS Core services (dataServe, filing, cache, logger, queue, search)
 * @returns {void}
 */
module.exports = (options, eventEmitter, services) => {
  
  const app = options.app;
  const { logger } = services;
  
  // Serve static files for the wiki application
  app.use('/applications/blog', express.static(path.join(__dirname)));
  
};
