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
 
  const logger = serviceRegistry.logger();  
  const cache = serviceRegistry.cache();
  const queue = serviceRegistry.queue();
  const filing = serviceRegistry.filing();
  const dataService = serviceRegistry.dataService();
  const search = serviceRegistry.searching();
  const measuring = serviceRegistry.measuring();
  const authService = serviceRegistry.authservice();

  // Create the middleware
  const servicesAuthMiddleware = serviceRegistry.servicesAuthMiddleware || ((req, res, next) => next());

  // Register routes and views
  options.app = app

  Routes(options, eventEmitter, { filing, cache, logger, queue, dataService, search, measuring, authService });
  Views(options, eventEmitter, { filing, cache, logger, queue, dataService, search, measuring, authService, servicesAuthMiddleware });

  // Serve README.md from root directory
  app.get('/applications/blog/README.md', (req, res) => {
    res.sendFile(path.join(__dirname, 'README.md'));
  });

}
