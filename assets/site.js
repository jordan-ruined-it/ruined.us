// The work grid starts as loading squares and fills in from the live Spotify
// playlist (/api/playlist). Each tile keeps its loading shimmer until its cover
// has loaded, then fades in. There is no hard-coded track list: if the API
// can't answer, the loading squares stay up and it retries in the background.
(function () {
  var grid = document.getElementById('grid');
  var artists = document.getElementById('artists');
  if (!grid && !artists) return;

  var TILE_COUNT = 13; // 1 featured + 12 squares


  // home page only needs the first 13 tracks (one quick Spotify call);
  // the info page needs the whole playlist for its artist list
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
        if (grid && ok) renderGrid(data.tracks.slice(0, TILE_COUNT));
        if (artists && data && data.artists && data.artists.length) {
          artists.textContent = data.artists.join('  /  ');
        }
        // no answer: the loading squares stay up and we quietly try again (3s, 6s, 12s… up to a minute apart)
        if (!ok && attempt < 8) {
          attempt++;
          setTimeout(load, Math.min(60000, 1500 * Math.pow(2, attempt)));
        }
      });
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
