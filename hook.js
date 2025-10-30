/**
 * Comprehensive Fetch Hook System
 * Provides before/after hooks for fetch requests with plugin-style architecture
 */
(function(global) {
  'use strict';

  class LaunchdHookSystem {
    constructor() {
      this.hooks = {
        beforeRequest: [],
        afterRequest: [],
        onError: [],
        urlReplace: [],
        dataTransform: []
      };

      this.storage = new Map(); // For saving requests
      this.originalFetch = global.fetch;
      this.originalXHR = global.XMLHttpRequest;
      this.startupProcesses = [];
      this.startupInitiated = false;
      this.eventLoops = new Map();

      this.setupInterception();
      this.setupStorage();
    }

    /**
     * Register a hook callback
     * @param {string} hookName - Name of the hook
     * @param {function} callback - Callback function
     * @param {object} options - Additional options
     */
    registerHook(hookName, callback, options = {}) {
      if (!this.hooks[hookName]) {
        throw new Error(`Unknown hook: ${hookName}`);
      }
      
      this.hooks[hookName].push({
        callback,
        priority: options.priority || 0,
        id: options.id || `hook_${Date.now()}_${Math.random()}`,
        enabled: options.enabled !== false
      });
      
      // Sort by priority (higher priority runs first)
      this.hooks[hookName].sort((a, b) => b.priority - a.priority);
      
      return options.id || this.hooks[hookName][this.hooks[hookName].length - 1].id;
    }

    /**
     * Remove a hook by ID
     * @param {string} hookName - Name of the hook
     * @param {string} hookId - ID of the hook to remove
     */
    removeHook(hookName, hookId) {
      if (this.hooks[hookName]) {
        this.hooks[hookName] = this.hooks[hookName].filter(hook => hook.id !== hookId);
      }
    }

    /**
     * Execute hooks in sequence
     * @param {string} hookName - Name of the hook
     * @param {*} data - Data to pass to hooks
     * @returns {Promise<*>} Modified data
     */
    async executeHooks(hookName, data) {
      const hooks = this.hooks[hookName].filter(hook => hook.enabled);
      let result = data;

      for (const hook of hooks) {
        try {
          const hookResult = await hook.callback(result, data);
          if (hookResult !== undefined) {
            result = hookResult;
          }
        } catch (error) {
          console.error(`Hook ${hookName}:${hook.id} failed:`, error);
          // Continue with other hooks
        }
      }
      
      return result;
    }

    /**
     * Setup fetch interception
     */
    setupInterception() {
      const self = this;

      // Intercept fetch
      global.fetch = async function(resource, options = {}) {
        const requestData = {
          url: typeof resource === 'string' ? resource : resource.url,
          method: options.method || 'GET',
          headers: options.headers || {},
          body: options.body,
          timestamp: new Date().toISOString(),
          id: `req_${Date.now()}_${Math.random()}`
        };

        try {
          await self.ensureStartup('fetch', { resource, options });

          // Execute beforeRequest hooks
          const modifiedRequest = await self.executeHooks('beforeRequest', {
            resource,
            options: { ...options },
            requestData: { ...requestData }
          });

          // Apply URL replacement hooks
          let finalResource = modifiedRequest.resource;
          const urlReplacement = await self.executeHooks('urlReplace', {
            url: modifiedRequest.requestData.url,
            originalUrl: requestData.url
          });
          
          if (urlReplacement && urlReplacement.url !== modifiedRequest.requestData.url) {
            finalResource = typeof resource === 'string' 
              ? urlReplacement.url 
              : new Request(urlReplacement.url, modifiedRequest.resource);
            modifiedRequest.requestData.url = urlReplacement.url;
            modifiedRequest.requestData.urlReplaced = true;
          }

          // Make the actual request
          const response = await self.originalFetch(finalResource, modifiedRequest.options);
          const responseClone = response.clone();

          // Prepare response data
          let responseData = {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            url: response.url,
            ok: response.ok,
            timestamp: new Date().toISOString(),
            requestData: modifiedRequest.requestData
          };

          // Get response body for processing
          let responseBody;
          const contentType = response.headers.get('content-type') || '';
          
          try {
            if (contentType.includes('application/json')) {
              responseBody = await responseClone.json();
              responseData.bodyType = 'json';
            } else if (contentType.includes('text/')) {
              responseBody = await responseClone.text();
              responseData.bodyType = 'text';
            } else {
              responseBody = await responseClone.arrayBuffer();
              responseData.bodyType = 'binary';
            }
            responseData.body = responseBody;
          } catch (e) {
            responseData.body = null;
            responseData.bodyType = 'unknown';
          }

          // Execute data transformation hooks
          const transformedData = await self.executeHooks('dataTransform', {
            ...responseData,
            originalBody: responseBody
          });

          if (transformedData.body !== responseBody) {
            // Create new response with transformed data
            const newBody = typeof transformedData.body === 'string' 
              ? transformedData.body 
              : JSON.stringify(transformedData.body);
            
            const newResponse = new Response(newBody, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers
            });

            responseData.body = transformedData.body;
            responseData.bodyTransformed = true;

            // Execute afterRequest hooks
            await self.executeHooks('afterRequest', {
              request: modifiedRequest.requestData,
              response: responseData,
              originalResponse: response
            });

            return newResponse;
          }

          // Execute afterRequest hooks
          await self.executeHooks('afterRequest', {
            request: modifiedRequest.requestData,
            response: responseData,
            originalResponse: response
          });

          return response;

        } catch (error) {
          // Execute error hooks
          await self.executeHooks('onError', {
            request: requestData,
            error,
            timestamp: new Date().toISOString()
          });

          throw error;
        }
      };

      // Intercept XMLHttpRequest
      global.XMLHttpRequest = function() {
        const xhr = new self.originalXHR();
        const originalOpen = xhr.open;
        const originalSend = xhr.send;

        xhr.open = function(method, url, ...args) {
          this._interceptorData = { method, url, timestamp: new Date().toISOString() };
          return originalOpen.apply(this, arguments);
        };

        xhr.send = function(data) {
          if (this._interceptorData) {
            self.ensureStartup('xhr', { data: this._interceptorData });
            // Convert XHR to fetch-like format for hooks
            const requestData = {
              url: this._interceptorData.url,
              method: this._interceptorData.method,
              body: data,
              timestamp: this._interceptorData.timestamp,
              id: `xhr_${Date.now()}_${Math.random()}`,
              type: 'xhr'
            };

            // Execute beforeRequest hooks for XHR
            self.executeHooks('beforeRequest', {
              resource: this._interceptorData.url,
              options: { method: this._interceptorData.method, body: data },
              requestData
            }).catch(console.error);
          }
          
          return originalSend.apply(this, arguments);
        };
        
        return xhr;
      };
    }

    /**
     * Setup request storage system
     */
    setupStorage() {
      this.registerHook('afterRequest', (data) => {
        // Auto-save all requests to storage
        this.storage.set(data.request.id, {
          request: data.request,
          response: data.response,
          savedAt: new Date().toISOString()
        });
      }, { id: 'auto-save', priority: -1000 });
    }

    /**
     * Get stored request data
     * @param {string} requestId - Optional specific request ID
     * @returns {*} Stored data
     */
    getStoredRequests(requestId = null) {
      if (requestId) {
        return this.storage.get(requestId);
      }
      return Object.fromEntries(this.storage.entries());
    }

    /**
     * Clear stored requests
     */
    clearStorage() {
      this.storage.clear();
    }

    /**
     * Convenience methods for common use cases
     */

    // URL replacement
    replaceUrl(fromUrl, toUrl, options = {}) {
      const matcher = typeof fromUrl === 'string'
        ? new RegExp('^' + fromUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$')
        : fromUrl;

      return this.registerHook('urlReplace', (data) => {
        if (matcher.test(data.url)) {
          const newUrl = typeof toUrl === 'function' 
            ? toUrl(data.url, matcher.exec(data.url))
            : data.url.replace(matcher, toUrl);
          
          if (options.log !== false) {
            console.log('🔄 URL replaced:', data.url, '->', newUrl);
          }
          
          return { ...data, url: newUrl };
        }
        return data;
      }, options);
    }

    // String replacement in response data
    replaceInResponse(fromString, toString, options = {}) {
      const matcher = typeof fromString === 'string'
        ? new RegExp(fromString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
        : fromString;

      return this.registerHook('dataTransform', (data) => {
        if (data.bodyType === 'text' || data.bodyType === 'json') {
          let content = typeof data.body === 'string' ? data.body : JSON.stringify(data.body);
          
          if (matcher.test(content)) {
            const newContent = content.replace(matcher, toString);
            
            if (options.log !== false) {
              console.log('🔄 Content replaced in response from:', data.requestData.url);
            }
            
            return {
              ...data,
              body: data.bodyType === 'json' ? JSON.parse(newContent) : newContent
            };
          }
        }
        return data;
      }, options);
    }

    // Log all requests
    enableLogging(options = {}) {
      return this.registerHook('afterRequest', (data) => {
        const logData = {
          method: data.request.method,
          url: data.request.url,
          status: data.response.status,
          timestamp: data.response.timestamp
        };
        
        if (options.detailed) {
          logData.headers = data.response.headers;
          logData.bodyType = data.response.bodyType;
        }
        
        console.log('📡 Request completed:', logData);
      }, { id: 'logger', ...options });
    }

    // Save responses to localStorage (with size limits)
    enablePersistence(options = {}) {
      const maxSize = options.maxSize || 1000; // Max number of requests to store

      return this.registerHook('afterRequest', (data) => {
        try {
          const storageKey = 'fetchHookSystem_requests';
          let stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
          
          stored.unshift({
            id: data.request.id,
            url: data.request.url,
            method: data.request.method,
            status: data.response.status,
            timestamp: data.response.timestamp,
            body: options.saveBody ? data.response.body : null
          });
          
          // Limit storage size
          if (stored.length > maxSize) {
            stored = stored.slice(0, maxSize);
          }
          
          localStorage.setItem(storageKey, JSON.stringify(stored));
        } catch (error) {
          console.warn('Failed to persist request data:', error);
        }
      }, { id: 'persistence', ...options });
    }

    /**
     * Register startup processes executed once when the system is first triggered
     * @param {function} callback
     * @param {object} options
     * @returns {string}
     */
    registerStartupProcess(callback, options = {}) {
      const process = {
        id: options.id || `startup_${Date.now()}_${Math.random()}`,
        callback,
        priority: options.priority || 0,
        runIfAlreadyStarted: options.runIfAlreadyStarted !== false
      };

      this.startupProcesses.push(process);
      this.startupProcesses.sort((a, b) => b.priority - a.priority);

      if (this.startupInitiated && process.runIfAlreadyStarted) {
        Promise.resolve().then(() => {
          this.safeInvokeStartup(process, { trigger: 'late-registration', context: {} });
        });
      }

      return process.id;
    }

    /**
     * Remove a startup process by ID
     * @param {string} id
     */
    removeStartupProcess(id) {
      this.startupProcesses = this.startupProcesses.filter(proc => proc.id !== id);
    }

    async ensureStartup(trigger, context = {}) {
      if (this.startupInitiated) {
        return;
      }

      this.startupInitiated = true;

      for (const process of this.startupProcesses) {
        await this.safeInvokeStartup(process, { trigger, context });
      }
    }

    async safeInvokeStartup(process, meta) {
      const context = meta && meta.context ? meta.context : {};
      try {
        await process.callback({
          trigger: meta.trigger,
          context,
          startedAt: new Date().toISOString()
        });
      } catch (error) {
        console.error(`Startup process failed (${process.id}):`, error);
      }
    }

    /**
     * Create a configurable event loop that can manage conditional intervals
     * @param {object} config
     */
    createEventLoop(config = {}) {
      if (typeof config.task !== 'function') {
        throw new Error('Event loop requires a task function');
      }

      const id = config.id || `loop_${Date.now()}_${Math.random()}`;
      const loopConfig = {
        interval: config.interval || 1000,
        task: config.task,
        condition: config.condition || null,
        maxIterations: typeof config.maxIterations === 'number' ? config.maxIterations : Infinity,
        autoStart: config.autoStart !== false,
        onStop: config.onStop || null,
        metadata: config.metadata || {}
      };

      const state = {
        id,
        iterations: 0,
        lastRunAt: null,
        running: false,
        timer: null
      };

      const scheduleNext = () => {
        if (!state.running) {
          return;
        }

        const interval = typeof loopConfig.interval === 'function'
          ? loopConfig.interval({ ...state, config: loopConfig })
          : loopConfig.interval;

        const delay = Math.max(0, Number(interval) || 0);
        state.timer = setTimeout(runTask, delay);
      };

      const stop = (reason = 'manual') => {
        if (!state.running) {
          return;
        }

        state.running = false;
        if (state.timer) {
          clearTimeout(state.timer);
          state.timer = null;
        }

        if (typeof loopConfig.onStop === 'function') {
          try {
            loopConfig.onStop({ state: { ...state }, reason, config: loopConfig });
          } catch (error) {
            console.error(`Event loop onStop failed (${id}):`, error);
          }
        }
      };

      const runTask = async () => {
        if (!state.running) {
          return;
        }

        if (loopConfig.condition && !loopConfig.condition({ ...state, config: loopConfig })) {
          stop('condition');
          return;
        }

        state.iterations += 1;
        state.lastRunAt = new Date().toISOString();

        try {
          await loopConfig.task({
            state: { ...state },
            config: loopConfig,
            stop
          });
        } catch (error) {
          console.error(`Event loop task failed (${id}):`, error);
        }

        if (!state.running) {
          return;
        }

        if (state.iterations >= loopConfig.maxIterations) {
          stop('maxIterations');
          return;
        }

        scheduleNext();
      };

      const start = () => {
        if (state.running) {
          return;
        }
        state.running = true;
        state.iterations = 0;
        scheduleNext();
      };

      const update = (newConfig = {}) => {
        Object.assign(loopConfig, newConfig);
        if (state.running) {
          if (state.timer) {
            clearTimeout(state.timer);
            state.timer = null;
          }
          scheduleNext();
        }
      };

      const controller = {
        id,
        start,
        stop,
        update,
        get state() {
          return { ...state };
        },
        get config() {
          return { ...loopConfig };
        }
      };

      this.eventLoops.set(id, controller);

      if (loopConfig.autoStart) {
        start();
      }

      return controller;
    }

    stopEventLoop(id, reason = 'manual') {
      const controller = this.eventLoops.get(id);
      if (controller) {
        controller.stop(reason);
      }
    }

    getEventLoop(id) {
      return this.eventLoops.get(id) || null;
    }

    listEventLoops() {
      return Array.from(this.eventLoops.keys());
    }
  }

  // Create global instance
  global.Launchd = new LaunchdHookSystem();

  // Expose convenience methods globally
  global.launchctl = {
    // Register hooks
    before: (callback, options) => global.Launchd.registerHook('beforeRequest', callback, options),
    after: (callback, options) => global.Launchd.registerHook('afterRequest', callback, options),
    onError: (callback, options) => global.Launchd.registerHook('onError', callback, options),
    transform: (callback, options) => global.Launchd.registerHook('dataTransform', callback, options),

    // Convenience methods
    replaceUrl: (from, to, options) => global.Launchd.replaceUrl(from, to, options),
    replaceText: (from, to, options) => global.Launchd.replaceInResponse(from, to, options),
    enableLogging: (options) => global.Launchd.enableLogging(options),
    enablePersistence: (options) => global.Launchd.enablePersistence(options),

    // Storage access
    getRequests: (id) => global.Launchd.getStoredRequests(id),
    clearStorage: () => global.Launchd.clearStorage(),

    // Hook management
    remove: (hookName, id) => global.Launchd.removeHook(hookName, id),

    // Startup management
    startup: {
      register: (callback, options) => global.Launchd.registerStartupProcess(callback, options),
      remove: (id) => global.Launchd.removeStartupProcess(id),
      initiated: () => global.Launchd.startupInitiated
    },

    // Event loops
    loops: {
      create: (config) => global.Launchd.createEventLoop(config),
      stop: (id, reason) => global.Launchd.stopEventLoop(id, reason),
      get: (id) => global.Launchd.getEventLoop(id),
      list: () => global.Launchd.listEventLoops()
    },

    system: global.Launchd
  };

})(typeof window !== 'undefined' ? window : global);
