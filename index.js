/**
 * @fileoverview Blog Application
 * Factory module for creating a Blog application instance.
 * 
 * @author NooblyJS Team
 * @version 0.0.0
 * @since  0.0.0
 */

'use strict';

const Routes = require('./src/routes');
const Views = require('./src/views');


/**
 * Creates the wiki service
 * Automatically configures routes and views for the wiki service.
 * Integrates with noobly-core services for data persistence, file storage, caching, etc.
 * @param {Object} app - The Express application instance
 * @param {EventEmitter} eventEmitter - Global event emitter for inter-service communication
 * @param {Object} serviceRegistry - NooblyJS Core service registry
 * @param {Object} options - Configuration options
 * @return {void}
 */
module.exports = (app, server, eventEmitter, serviceRegistry, options) => {
  
  const express = require('express');
  const path = require('path');

  const dataDirectory = options.dataDirectory || './.application/'
  const filesDir = options.filesDir || './.application/wiki-files'
  const cacheProvider = options.filesDir || 'memory'
  const filerProvider = options.filesDir || 'local'
  const loggerProvider = options.filesDir || 'console'
  const queueProvider = options.filesDir || 'memory'
  
  const filing = serviceRegistry.filing(filerProvider, { baseDir: filesDir});
  const cache = serviceRegistry.cache(cacheProvider);
  const logger = serviceRegistry.logger(loggerProvider);
  const queue = serviceRegistry.queue(queueProvider);


  // Register routes and views
  options.app = app

  Routes(options, eventEmitter, { filing, cache, logger, queue });
  Views(options, eventEmitter, { filing, cache, logger, queue });

  // Serve README.md from root directory
  app.get('/applications/blog/README.md', (req, res) => {
    res.sendFile(path.join(__dirname, 'README.md'));
  });

}

