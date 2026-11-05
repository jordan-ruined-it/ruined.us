// Progressive enhancement: the pages already contain a static copy of the
// portfolio. If /api/playlist answers, swap in the live playlist with covers.
(function () {
  var grid = document.getElementById('grid');
  var artists = document.getElementById('artists');
  if (!grid && !artists) return;

  var TILE_COUNT = 13; // 1 featured + 12 squares

  fetch('/api/playlist')
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (data) {
      if (!data) return;
      if (grid && data.tracks && data.tracks.length) renderGrid(data.tracks.slice(0, TILE_COUNT));
      if (artists && data.artists && data.artists.length) artists.textContent = data.artists.join('  /  ');
    })
    .catch(function () { /* keep the static copy */ });

  function renderGrid(tracks) {
    var frag = document.createDocumentFragment();
    tracks.forEach(function (t, i) {
      var a = document.createElement('a');
      a.className = i === 0 ? 'tile tile--featured' : 'tile';
      a.href = t.url;
      a.target = '_blank';
      a.rel = 'noopener';

      if (t.image) {
        var img = document.createElement('img');
        img.src = t.image;
        img.alt = '';
        img.loading = i < 4 ? 'eager' : 'lazy';
        img.decoding = 'async';
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
  }
})();
