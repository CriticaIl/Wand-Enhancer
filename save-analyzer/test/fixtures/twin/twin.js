// Twin games (SaveForge regression fixture, 2.3): two different games built with the SAME
// engine — same global names, same variable paths, different values and different save keys —
// like two RPG Maker or Construct games on one host (itch.io serves every HTML game from one origin).
//   window.TWIN = {id: 'a'|'b', spa: true}
//   a: "Moon Harbor", gold 1111, saves to localStorage "moonharbor_save"
//   b: "Ember Forge", gold 2222, saves to localStorage "emberforge_save"
// twinSave() writes the current game's save; twinSwitch(id) is a single-page-app navigation
// (pushState + a brand-new game object), as game portals do.
(function () {
  var GAMES = {
    a: { title: 'Moon Harbor', gold: 1111, key: 'moonharbor_save', color: '#2b6cb0' },
    b: { title: 'Ember Forge', gold: 2222, key: 'emberforge_save', color: '#c05621' },
  };
  var cfg = window.TWIN || { id: 'a' };
  var timer = 0;
  function boot(id) {
    var c = GAMES[id];
    document.title = c.title;
    var raw = null;
    try {
      raw = localStorage.getItem(c.key);
    } catch (e) {}
    var game = raw ? JSON.parse(raw) : { player: { gold: c.gold, hp: 50, maxHp: 50, level: 3, xp: 120 }, world: { day: 1, ticks: 0 } };
    game.title = c.title;
    window.game = game;
    window.twinId = id;
    document.getElementById('title').textContent = c.title;
    document.body.style.background = c.color;
    clearInterval(timer);
    // a running game: some state changes every frame-ish
    timer = setInterval(function () {
      game.world.ticks++;
      render();
    }, 250);
    render();
  }
  function render() {
    var g = window.game;
    document.getElementById('gold').textContent = g.player.gold;
    document.getElementById('hp').textContent = g.player.hp;
    var cv = document.getElementById('cv');
    var x = cv.getContext && cv.getContext('2d');
    if (x) {
      x.fillStyle = '#000';
      x.fillRect(0, 0, cv.width, cv.height);
      x.fillStyle = '#fff';
      x.fillRect((g.world.ticks * 7) % cv.width, 40, 12, 12);
    }
  }
  window.twinSave = function () {
    localStorage.setItem(GAMES[window.twinId].key, JSON.stringify({ player: window.game.player, world: window.game.world }));
  };
  window.twinSwitch = function (id, path) {
    history.pushState({ twin: id }, '', path || location.pathname.replace(/[^/]*$/, '') + 'play-' + id);
    boot(id);
  };
  document.getElementById('save').onclick = window.twinSave;
  document.getElementById('earn').onclick = function () {
    window.game.player.gold += 10;
    render();
  };
  boot(cfg.id);
})();
