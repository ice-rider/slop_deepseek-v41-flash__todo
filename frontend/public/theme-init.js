/**
 * Theme bootstrap.
 *
 * Loaded as a blocking script in <head> so the persisted palette is applied
 * before the first paint (no light flash on a dark preference). Kept in its own
 * file so the Content-Security-Policy can stay `script-src 'self'` with no
 * inline-script exception.
 */
;(function () {
  try {
    var raw = localStorage.getItem('flowboard.ui')
    var theme = raw ? JSON.parse(raw).state.theme : null
    if (!theme || theme === 'system') {
      theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
    }
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.dataset.theme = theme
  } catch (error) {
    document.documentElement.classList.add('dark')
  }
})()
