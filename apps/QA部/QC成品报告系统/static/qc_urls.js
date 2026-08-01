(function (root, factory) {
  const helpers = factory();
  if (typeof module === 'object' && module.exports) module.exports = helpers;
  else root.QCUrls = helpers;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const apiUrl = (action, apiPrefix) => {
    const url = new URL(action);
    const normalizedApiPrefix = apiPrefix.replace(/\/$/, '');
    const scriptRoot = normalizedApiPrefix.endsWith('/api')
      ? normalizedApiPrefix.slice(0, -4)
      : '';
    if (!url.pathname.startsWith(`${normalizedApiPrefix}/`)) {
      const applicationPath = scriptRoot && url.pathname.startsWith(`${scriptRoot}/`)
        ? url.pathname.slice(scriptRoot.length)
        : url.pathname;
      url.pathname = `${normalizedApiPrefix}${applicationPath}`;
    }
    return url.toString();
  };

  const isLoginRedirect = (responseUrl, loginUrl) => (
    new URL(responseUrl).pathname === new URL(loginUrl, responseUrl).pathname
  );

  const analysisStatusUrl = (statusBase, runId) => `${statusBase}${runId}`;

  return {apiUrl, isLoginRedirect, analysisStatusUrl};
});
