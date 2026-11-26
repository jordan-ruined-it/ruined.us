// The work grid starts as pulsing placeholder squares and fills in from the
// live Spotify playlist (/api/playlist). Each tile keeps pulsing until its
// cover has loaded, then fades in. If the API can't be reached, the grid
// falls back to the copy below so the page never stays empty.
(function () {
  var grid = document.getElementById('grid');
  var artists = document.getElementById('artists');
  if (!grid && !artists) return;

  var TILE_COUNT = 13; // 1 featured + 12 squares

  var FALLBACK = [
    ['Leyla Diamondi', 'Baggage', '6yUZzWzDzswwrntHbBtcwa'],
    ['J. Worra', 'Who Told You To Stop?', '0466CuA7OpSt4n4jnnvwI1'],
    ['deadmau5', 'Science - Julian Gray Remix', '1kg5X3KvnoJsYEqbVKaIWU'],
    ['Quackson', 'Chains', '3BN8ZvwgmKKr6GWAzYmzxK'],
    ['Black Tiger Sex Machine', 'Matrix', '1wYgYBJvA13mMVHpYesTAt'],
    ['Anyma', 'Entropy (feat. fknsyd)', '2kzAsTCD7e8UiPap8BmDZl'],
    ['Rezz', 'SICK FUCK', '77A94wc7fOY0vuMffWELYJ'],
    ['Sam WOLFE', 'Control Delete', '5vnDCSPfq2BXo9gAGO7RM9'],
    ['BROSA', 'So Much Ice', '3FjGmI3YyXVs3JrJyu0mC9'],
    ['ARMNHMR', 'You Broke My Heart', '4Gm2RznRAbEj9VmgRXF2fG'],
    ['Maria Domark', 'i just wanna fly', '57j0wlW9njvUd4Q4VXCmFx'],
    ['Kyle Cooke', 'Summer Should Be Fun', '0kP8ZEO3PJYz8H2Hyc9bI5'],
    ["Colleen D'agostino", 'Secret', '6ItTC3ftYpFtYEThtr27Mx']
  ].map(function (t) {
    return { artist: t[0], title: t[1], url: 'https://open.spotify.com/track/' + t[2], image: null };
  });

  fetch('/api/playlist')
    .then(function (res) { return res.ok ? res.json() : null; })
    .catch(function () { return null; })
    .then(function (data) {
      if (grid) {
        var tracks = data && data.tracks && data.tracks.length ? data.tracks : FALLBACK;
        renderGrid(tracks.slice(0, TILE_COUNT));
      }
      if (artists && data && data.artists && data.artists.length) {
        artists.textContent = data.artists.join('  /  ');
      }
    });

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
