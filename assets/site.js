// The work grid shows the last playlist this browser saw (saved in localStorage)
// immediately, then asks /api/playlist for the latest and redraws only if it
// changed. First-time visitors see loading squares until the playlist arrives.
// Each tile keeps its loading shimmer until its cover has loaded, then fades in.
(function () {
  var grid = document.getElementById('grid');
  var artists = document.getElementById('artists');
  if (!grid && !artists) return;

  var TILE_COUNT = 13; // 1 featured + 12 squares
  var STORE_KEY = 'ruined.playlist.v1';

  // 1. show the last playlist this browser saw, straight away (covers usually come from the browser's cache)
  var saved = read();
  var shown = '';
  if (grid && saved && saved.tracks && saved.tracks.length) { renderGrid(saved.tracks.slice(0, TILE_COUNT)); shown = sig(saved.tracks); }
  if (artists && saved && saved.artists && saved.artists.length) artists.textContent = saved.artists.join('  /  ');

  // 2. ask the site for the latest; only redraw if something actually changed
  var url = grid ? '/api/playlist?scope=grid' : '/api/playlist';
  var attempt = 0;
  load();

  function load() {
    var ctrl = 'AbortController' in window ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 12000);
    fetch(url, ctrl ? { signal: ctrl.signal } : {})
      .then(function (res) { return res.ok ? res.json() : null; })
      .catch(function () { return null; })
      .then(function (data) {
        clearTimeout(timer);
        var ok = data && data.tracks && data.tracks.length;
        if (ok) {
          if (grid && sig(data.tracks) !== shown) { renderGrid(data.tracks.slice(0, TILE_COUNT)); shown = sig(data.tracks); }
          if (artists && data.artists && data.artists.length) artists.textContent = data.artists.join('  /  ');
          write(data);
        } else if (!shown && attempt < 5) {
          // nothing on screen yet: keep the loading squares and try again (3s, 6s, 12s, 24s, 48s)
          attempt++;
          setTimeout(load, 1500 * Math.pow(2, attempt));
        }
      });
  }

  function sig(tracks) {
    return tracks.slice(0, TILE_COUNT).map(function (t) { return t.url + '|' + t.image; }).join(',');
  }
  function read() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { return null; }
  }
  function write(data) {
    try {
      var prev = read() || {};
      localStorage.setItem(STORE_KEY, JSON.stringify({
        tracks: data.tracks.slice(0, TILE_COUNT),
        artists: data.artists || prev.artists || null,
        updatedAt: data.updatedAt || null
      }));
    } catch (e) { /* storage full or blocked: fine, we just won't have a head start next time */ }
  }

  function renderGrid(tracks) {
    var frag = document.createDocumentFragment();
    tracks.forEach(function (t, i) {
      var a = document.createElement('a');
      a.className = (i === 0 ? 'tile tile--featured' : 'tile') + ' tile--in';
      a.style.setProperty('--i', i);
      a.href = t.url;
      a.target = '_blank';
      a.rel = 'noopener';

      if (t.image) {
        a.classList.add('is-pending');
        var img = document.createElement('img');
        img.alt = '';
        img.decoding = 'async';
        img.loading = i < 4 ? 'eager' : 'lazy';
        var done = function () { img.classList.add('is-loaded'); a.classList.remove('is-pending'); };
        img.addEventListener('load', done);
        img.addEventListener('error', function () { img.remove(); a.classList.remove('is-pending'); });
        img.src = t.image;
        if (img.complete && img.naturalWidth) done();
        a.appendChild(img);
      }

      var label = document.createElement('span');
      label.className = 'label';
      label.appendChild(document.createTextNode(t.artist));
      var small = document.createElement('small');
      small.textContent = t.title;
      label.appendChild(small);
      a.appendChild(label);

      frag.appendChild(a);
    });
    grid.replaceChildren(frag);
    grid.removeAttribute('aria-busy');
    grid.setAttribute('aria-label', 'Selected work');
  }
})();
