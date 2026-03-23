import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Sub-path fetch wrapper for reverse proxy routing (added by QC-08)
const _originalFetch = window.fetch;
window.fetch = (url, opts) => {
  if (typeof url === 'string' && url.startsWith('/api/')) {
    url = '/test-app-fetch-only' + url;
  }
  return _originalFetch(url, opts);
};

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
