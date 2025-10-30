/**
 * Usage Examples for Launchd Hook System
 * Place the main system code first, then use these examples
 */

// 1. BASIC USAGE - Enable logging for all requests
launchctl.enableLogging({ detailed: true });

// 2. URL REPLACEMENT - Replace specific URLs
launchctl.replaceUrl(
  'https://api.old.com/data',
  'https://api.new.com/data'
);

// Pattern-based URL replacement
launchctl.replaceUrl(
  /^https:\/\/old-cdn\.com\/(.+)$/,
  'https://new-cdn.com/$1'
);

// Dynamic URL replacement with function
launchctl.replaceUrl(
  /^https:\/\/api\.example\.com\/v(\d+)\/(.+)$/,
  (url, match) => `https://api.example.com/v${parseInt(match[1]) + 1}/${match[2]}`
);

// 3. STRING REPLACEMENT IN RESPONSES
launchctl.replaceText('oldValue', 'newValue');
launchctl.replaceText(/error/gi, 'success');

// 4. CUSTOM BEFORE/AFTER HOOKS

// Modify request before sending
launchctl.before((data) => {
  // Add authentication header
  data.options.headers = {
    ...data.options.headers,
    'Authorization': 'Bearer your-token-here'
  };
  
  // Add custom user agent
  data.options.headers['User-Agent'] = 'MyApp/1.0';
  
  console.log('🚀 Request starting:', data.requestData.url);
  return data;
});

// Process response after receiving
launchctl.after((data) => {
  console.log('✅ Request completed:', {
    url: data.request.url,
    status: data.response.status,
    duration: new Date(data.response.timestamp) - new Date(data.request.timestamp)
  });
  
  // Log errors
  if (!data.response.ok) {
    console.error('❌ Request failed:', data.request.url, data.response.status);
  }
});

// 5. ERROR HANDLING
launchctl.onError((data) => {
  console.error('💥 Request error:', {
    url: data.request.url,
    error: data.error.message,
    timestamp: data.timestamp
  });
  
  // Could send error to monitoring service
  // sendToErrorTracking(data);
});

// 6. DATA TRANSFORMATION
launchctl.transform((data) => {
  // Transform JSON responses
  if (data.bodyType === 'json' && data.body) {
    // Add metadata to all JSON responses
    return {
      ...data,
      body: {
        ...data.body,
        _metadata: {
          fetchedAt: new Date().toISOString(),
          url: data.requestData.url,
          intercepted: true
        }
      }
    };
  }
  
  // Transform text responses
  if (data.bodyType === 'text') {
    return {
      ...data,
      body: data.body.replace(/\bAPI\b/g, 'Service')
    };
  }
  
  return data;
});

// 7. ADVANCED EXAMPLES

// Cache responses for specific URLs
const responseCache = new Map();
launchctl.before((data) => {
  const cacheKey = `${data.requestData.method}:${data.requestData.url}`;
  if (responseCache.has(cacheKey)) {
    console.log('📦 Returning cached response for:', data.requestData.url);
    // You would need to implement cache return logic here
  }
});

launchctl.after((data) => {
  if (data.response.ok && data.request.method === 'GET') {
    const cacheKey = `${data.request.method}:${data.request.url}`;
    responseCache.set(cacheKey, {
      response: data.response,
      timestamp: Date.now()
    });
  }
});

// Rate limiting
const rateLimiter = new Map();
launchctl.before((data) => {
  const domain = new URL(data.requestData.url).hostname;
  const now = Date.now();
  const limit = 10; // requests per second
  
  if (!rateLimiter.has(domain)) {
    rateLimiter.set(domain, []);
  }
  
  const requests = rateLimiter.get(domain);
  // Remove old requests (older than 1 second)
  const recent = requests.filter(time => now - time < 1000);
  
  if (recent.length >= limit) {
    console.warn('⚠️ Rate limit exceeded for:', domain);
    // Could throw error or delay request
  }
  
  recent.push(now);
  rateLimiter.set(domain, recent);
});

// Request/Response size monitoring
launchctl.after((data) => {
  const responseSize = JSON.stringify(data.response.body).length;
  if (responseSize > 100000) { // 100KB
    console.warn('📏 Large response detected:', {
      url: data.request.url,
      size: `${(responseSize / 1024).toFixed(2)}KB`
    });
  }
});

// 8. ENVIRONMENT-SPECIFIC CONFIGURATIONS

// Development environment - verbose logging
if (typeof location !== 'undefined' && location.hostname === 'localhost') {
  launchctl.enableLogging({ detailed: true });

  // Mock API responses in development
  launchctl.replaceUrl(
    /^https:\/\/api\.production\.com\/(.+)$/,
    'https://api.development.com/$1'
  );
}

// Production environment - error tracking only
if (typeof location !== 'undefined' && location.hostname === 'myapp.com') {
  launchctl.onError((data) => {
    // Send to error tracking service
    fetch('/api/errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: data.request.url,
        error: data.error.message,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
        timestamp: data.timestamp
      })
    });
  });
}

// 9. TESTING SCENARIOS

// Simulate network delays for testing
launchctl.before(async (data) => {
  if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('simulateSlowNetwork')) {
    const delay = parseInt(sessionStorage.getItem('networkDelay') || '1000');
    console.log(`⏱️ Simulating ${delay}ms network delay`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  return data;
});

// 10. STARTUP PROCESSES

launchctl.startup.register(({ trigger }) => {
  console.log('🛠️ Launchd startup sequence triggered by:', trigger);
});

launchctl.startup.register(({ trigger }) => {
  console.log('📦 Preparing caches before network activity, trigger:', trigger);
}, { priority: 10 });

// 11. EVENT LOOP SCHEDULER

const housekeepingLoop = launchctl.loops.create({
  id: 'housekeeping',
  interval: ({ iterations }) => Math.min(5000, 1000 + iterations * 250),
  task: async ({ state, stop }) => {
    console.log('🌀 Housekeeping iteration:', state.iterations);

    const pendingHost = typeof globalThis !== 'undefined' ? globalThis : {};
    const outstanding = Array.isArray(pendingHost.pendingTasks)
      ? pendingHost.pendingTasks.length
      : 0;
    if (!outstanding) {
      stop('completed');
    }
  },
  condition: ({ iterations }) => iterations < 20
});

// Dynamically adjust loop behaviour later in the lifecycle
setTimeout(() => {
  const controller = launchctl.loops.get('housekeeping');
  if (controller) {
    controller.update({ maxIterations: 50 });
  }
}, 10000);

// Simulate API failures for testing
launchctl.before((data) => {
  if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('simulateApiFailure')) {
    const shouldFail = Math.random() < 0.3; // 30% failure rate
    if (shouldFail) {
      console.log('💥 Simulating API failure for:', data.requestData.url);
      throw new Error('Simulated network failure');
    }
  }
  return data;
});

// 10. UTILITY FUNCTIONS

// Enable/disable all hooks
function enableAllHooks() {
  launchctl.enableLogging();
  launchctl.enablePersistence();
  console.log('✅ All fetch hooks enabled');
}

function disableAllHooks() {
  // Remove all hooks (you'd need to track hook IDs)
  launchctl.clearStorage();
  console.log('❌ All fetch hooks disabled');
}

// Export request data
function exportRequestData() {
  const data = launchctl.getRequests();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fetch-requests-${new Date().toISOString()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// 11. TESTING THE SYSTEM
async function testFetchHooks() {
  console.log('🧪 Testing fetch hooks...');

  try {
    // This should trigger all the hooks
    const response = await fetch('https://jsonplaceholder.typicode.com/posts/1');
    const data = await response.json();

    console.log('📊 Test completed. Check console for hook outputs.');
    console.log('💾 Stored requests:', Object.keys(launchctl.getRequests()).length);

    return data;
  } catch (error) {
    console.error('🚨 Test failed:', error);
  }
}

// Run test
// testFetchHooks();
