/* Boot: load platform info and the current session (if any), then start the hash router. */
(function () {
  'use strict';
  const { state, api, render } = App;
  async function boot() {
    const [p] = await Promise.all([api.get('/api/public/platform').catch(() => null), App.loadMe()]);
    state.platform = p;
    window.addEventListener('hashchange', render);
    render();
  }
  boot();
})();
