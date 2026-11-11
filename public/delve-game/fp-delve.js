/* Flaw Patrol's part of the game. Loaded before the game by index.html (see scripts/delve-sync.mjs).
 *
 * 1. Saves: the game's storage calls go to DELVE_STORE, which keeps every key in memory and sends
 *    them to the person's own account (PUT /api/delve) a moment after each change.
 * 2. Pick a dungeon: Random delve (the game as it is), Practice (3 gentle floors, banks no Shards)
 *    and one dungeon for each closed run the person tested by hand.
 * 3. Run dungeons: the seed is run + person, so the same run always makes the same map. The
 *    person's bugs from that run only NAME monsters (worst bug = B12 boss, other Showstopper and
 *    Critical bugs = earlier bosses, the next level down = Elites, the rest = regular monsters).
 *    Stats and Shards never change because of them. Beating B12 pays a first-clear bonus once.
 *    Practice banks nothing: no Shards, no Scrap, no deepest floor.
 * 4. Bug Log gets a "Your bugs" tab, kept in the person's own save.
 */
(function () {
  "use strict";
  var host = null;
  try { host = window.parent && window.parent !== window ? window.parent.__fpDelve : null; } catch (e) { host = null; }
  var data = (host && host.data) || { save: { keys: {} }, dungeons: [], cleared: [] };

  // ---------- 1. storage ----------
  var keys = {};
  var start = (data.save && data.save.keys) || {};
  for (var k in start) if (typeof start[k] === "string") keys[k] = start[k];
  var timer = 0, dirty = false;
  function flush(beacon) {
    if (!dirty || !host) return;
    dirty = false; clearTimeout(timer);
    try { host.save(keys, beacon); } catch (e) {}
  }
  function later() { dirty = true; clearTimeout(timer); timer = setTimeout(function () { flush(false); }, 800); }
  window.DELVE_STORE = host ? {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(keys, k) ? keys[k] : null; },
    setItem: function (k, v) { v = String(v); if (keys[k] === v) return; keys[k] = v; later(); },
    removeItem: function (k) { if (!(k in keys)) return; delete keys[k]; later(); }
  } : window.localStorage;
  addEventListener("pagehide", function () { flush(true); });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flush(true); });
  window.__fpDelveFlush = function () { flush(false); };

  // ---------- 2-4. hooks into the game ----------
  window.__fpDelveHook = function (g) {
    var PEND = null; // the dungeon picked for the next run: {kind:"practice"} or {kind:"run", d:dungeon}
    var esc = g.esc, el = g.el;
    var SEV = { SHOWSTOPPER: 0, CRITICAL: 1, PROBLEMATIC: 2, MINOR: 3, ENHANCEMENT: 4 };

    // styles for the new screens, in the game's own look
    var css = document.createElement("style");
    css.textContent =
      ".pk{display:grid;gap:8px;width:100%;max-width:420px}" +
      ".pk .row{display:grid;grid-template-columns:44px 1fr;gap:10px;align-items:center;text-align:left;background:var(--panel2);border:2px solid var(--line);border-radius:10px;padding:8px;color:var(--fg);font:inherit;cursor:pointer;width:100%}" +
      ".pk .row:focus-visible,.pk .row:hover{border-color:var(--glow)}" +
      ".pk .row img{width:44px;height:44px;object-fit:contain}" +
      ".pk .n{font-weight:700;font-size:15px;overflow-wrap:anywhere}" +
      ".pk .d{font-size:12px;color:var(--muted);overflow-wrap:anywhere}" +
      ".pk .tag{display:inline-block;font:8px var(--display);color:var(--gold);border:1px solid var(--gold);border-radius:4px;padding:2px 4px;margin-left:6px;vertical-align:2px}" +
      ".pk .tag.ok{color:var(--ok);border-color:var(--ok)}" +
      ".pk .sec{text-align:left;margin-top:8px}" +
      ".pk .none{font-size:12px;color:var(--muted);text-align:left}" +
      ".pkfoot{font-size:12px;color:var(--muted)}" +
      ".ltabs{display:flex;gap:6px}" +
      ".ltabs button{font:8px var(--display);padding:8px 10px;border:1px solid var(--line);border-radius:6px;color:var(--muted);background:var(--panel2);cursor:pointer}" +
      ".ltabs button[aria-selected=true]{color:#04201d;background:var(--glow);border-color:var(--glow)}" +
      ".lg .k{font:8px var(--display);color:var(--glow)}" +
      ".lg.elite{border-color:#7a6326}" +
      ".lg .t{font-size:12px;font-weight:700;line-height:1.3;overflow-wrap:anywhere}" +
      "#welcomeCode{font:600 14px var(--body);background:#0b1a20;color:var(--fg);border:1px solid var(--glow);border-radius:6px;padding:8px;width:100%;max-width:420px;min-height:80px;user-select:text;-webkit-user-select:text}";
    document.head.appendChild(css);

    function screen(id, inner) {
      var d = document.createElement("div");
      d.className = "screen tall"; d.id = id; d.hidden = true; d.innerHTML = inner;
      el("app").appendChild(d);
      g.SCREENS.push(id);
      return d;
    }

    // ---------- Pick a dungeon ----------
    screen("pickScreen",
      '<h2>PICK A DUNGEON</h2><div class="pk" id="pickList"></div>' +
      '<p class="pkfoot">Same run, same map, every time. Pass and fail count the same.</p>' +
      '<button class="btn" id="pickBack">Back</button>');
    function bugLine(d) {
      var n = d.bugs.length;
      if (!n) return "no bugs, classic monsters";
      return (n === 1 ? "1 of your bugs" : n + " of your bugs") + " · boss: " + esc(d.bugs[0].key);
    }
    function renderPick() {
      var cleared = data.cleared || [], h = '';
      h += '<button class="row" data-pick="random"><img src="' + g.S("knight") + '" alt=""><div><div class="n">Random delve</div><div class="d">The Delve you know, new map every time</div></div></button>';
      h += '<button class="row" data-pick="practice"><img src="' + g.S("m00") + '" alt=""><div><div class="n">Practice</div><div class="d">Short and gentle. Banks no Shards</div></div></button>';
      h += '<div class="sec">FROM YOUR CLOSED RUNS</div>';
      if (!data.dungeons.length) h += '<div class="none">Runs you tested by hand show up here once they\'re closed.</div>';
      data.dungeons.forEach(function (d, i) {
        var done = cleared.indexOf(d.id) >= 0;
        var boss = d.bugs.length ? g.BOSS[3][0] : "m03";
        h += '<button class="row" data-pick="run" data-i="' + i + '"><img src="' + g.S(boss) + '" alt=""><div><div class="n">' + esc(d.label) +
          (done ? '<span class="tag ok">CLEARED ✓</span>' : '') + '</div><div class="d">' +
          (d.cases === 1 ? "1 case" : d.cases + " cases") + " · " + bugLine(d) + '</div></div></button>';
      });
      el("pickList").innerHTML = h;
    }
    function openPick() { PEND = null; renderPick(); g.show("pickScreen"); }
    el("pickList").addEventListener("click", function (e) {
      var b = e.target.closest("[data-pick]"); if (!b) return;
      var k = b.dataset.pick;
      g.wantDaily = false;
      PEND = k === "practice" ? { kind: "practice" } : k === "run" ? { kind: "run", d: data.dungeons[+b.dataset.i] } : null;
      g.openLoad();
    });
    el("pickBack").onclick = function () { PEND = null; g.renderTitle(); g.show("title"); };
    // Delve (no paused run) and Delve again open the picker; a paused run still continues.
    var startOld = el("startBtn").onclick;
    el("startBtn").onclick = function () { if (g.load(g.KR(), null)) startOld.call(this); else { g.over = false; openPick(); } };
    el("againBtn").onclick = openPick;
    el("dailyBtn").addEventListener("click", function () { PEND = null; });
    el("loadBack").addEventListener("click", function () { PEND = null; });

    // Leave: back to the quest map you came from
    if (host && host.leave) {
      var lv = document.createElement("button");
      lv.className = "btn"; lv.id = "leaveBtn"; lv.textContent = "Back to Flaw Patrol";
      lv.onclick = function () { flush(false); host.leave(); };
      el("title").querySelector(".btns").appendChild(lv);
    }

    // ---------- the bug plan for a run dungeon (no randomness, so the same run always plays the same) ----------
    function shortTitle(t) { t = String(t || "").replace(/[<>&"]/g, "").replace(/\s+/g, " ").trim(); return t.length > 28 ? t.slice(0, 27).trim() + "…" : t || "A bug"; }
    function plan(d) {
      var bugs = d.bugs.slice().sort(function (a, b) { return (SEV[a.sev] - SEV[b.sev]) || (a.n - b.n); });
      var p = { boss: {}, elite: {}, mons: {} };
      if (!bugs.length) return p;
      p.boss[12] = bugs.shift();
      var bossFloors = [9, 6, 3];
      while (bossFloors.length && bugs.length && SEV[bugs[0].sev] <= 1) p.boss[bossFloors.shift()] = bugs.shift();
      var eliteFloor = 4;
      while (eliteFloor <= 12 && bugs.length && SEV[bugs[0].sev] <= 2) p.elite[eliteFloor++] = bugs.shift();
      bugs.forEach(function (b, i) { var f = 1 + (i % 12); (p.mons[f] = p.mons[f] || []).push(b); });
      return p;
    }
    function tag(m, b, kind) {
      m.bug = { id: b.id, key: b.key, t: shortTitle(b.title), sev: b.sev, kind: kind };
      m.name = kind === "elite" ? "★ " + m.bug.t : m.bug.t;
    }
    function nameFloor() {
      var G = g.G, d = G && G.dungeon; if (!d || !d.plan) return;
      var f = G.floor, p = d.plan;
      var boss = G.mons.filter(function (m) { return m.boss; })[0];
      if (boss && p.boss[f]) tag(boss, p.boss[f], "boss");
      var elite = G.mons.filter(function (m) { return m.elite; })[0];
      if (elite && p.elite[f]) tag(elite, p.elite[f], "elite");
      var rest = G.mons.filter(function (m) { return !m.boss && !m.elite && !m.bug; })
        .sort(function (a, b) { return (a.y - b.y) || (a.x - b.x); });
      (p.mons[f] || []).forEach(function (b, i) { if (rest[i]) tag(rest[i], b, "mon"); });
      var room = d.rooms && d.rooms.length ? d.rooms[(f - 1) % d.rooms.length] : "";
      if (room && f <= 12) g.say("Floor " + f + ": <b>" + esc(shortTitle(room)) + "</b>. " + (f === 1 ? "Find the stairs." : f % 3 === 0 ? "A boss guards the stairs." : "+" + g.stairSh() + " Shards for going deeper."));
      g.persist();
    }

    // ---------- new runs: Practice and run dungeons set up before floor 1 is built ----------
    var newRun0 = g.newRun;
    g.newRun = function () {
      var pick = PEND; PEND = null;
      if (!pick) return newRun0();
      var full = g.nextFloor;
      g.nextFloor = function () {
        g.nextFloor = full;
        var G = g.G; G.daily = null;
        if (pick.kind === "practice") { G.practice = true; }
        else {
          var d = pick.d;
          G.seed = g.hashStr("run:" + d.seed);
          G.dungeon = { id: d.id, label: d.label, rooms: d.rooms || [], plan: plan(d) };
        }
        full();
      };
      try { newRun0(); } finally { g.nextFloor = full; }
    };

    var nextFloor0 = g.nextFloor;
    g.nextFloor = function () {
      var G = g.G;
      // Practice ends after the B3 boss: a gentle finish with nothing banked
      if (G && G.practice && G.floor >= 3) { g.die(true); return; }
      nextFloor0();
      G = g.G;
      if (G && G.practice) {
        G.mons.forEach(function (m) { m.hp = m.max = Math.max(1, Math.ceil(m.max * 0.6)); m.atk = Math.max(1, m.atk - 1); });
        g.persist();
      }
      nameFloor();
    };

    // Practice banks nothing and doesn't count toward your deepest floor or falls
    var die0 = g.die;
    g.die = function (won) {
      var G = g.G;
      if (!G || !G.practice) return die0(won);
      var m = g.meta, best = m.best, falls = m.falls, runs = m.runs;
      G.shards = 0;
      die0(won);
      m.best = best; m.falls = falls; m.runs = runs; g.save(g.KM(), m);
    };

    // boss card: "BUG #482 · B12 BOSS"
    var bossCard0 = g.bossCard;
    g.bossCard = function (m) {
      bossCard0(m);
      if (m && m.bug) el("bossFloor").textContent = "BUG " + m.bug.key + " · B" + g.G.floor + " BOSS";
    };

    // squashing a bug-named monster adds it to Your bugs. A Practice boss gives no Scrap.
    var killMon0 = g.killMon;
    g.killMon = function (m) {
      var G = g.G, r;
      if (G && G.practice && m && m.boss) {
        var meta0 = g.meta, scrap = meta0.scrap || 0, toast0 = g.abToast;
        g.abToast = function (id, html) { if (!/Scrap/.test(String(html))) toast0(id, html); };
        try { r = killMon0(m); } finally { g.abToast = toast0; }
        g.meta.scrap = scrap; G.scrapRun = 0; g.save(g.KM(), g.meta); g.persist();
        return r;
      }
      r = killMon0(m);
      if (m && m.bug) {
        var meta = g.meta; meta.bugs = meta.bugs || {};
        var e = meta.bugs[m.bug.id] || { key: m.bug.key, t: m.bug.t, img: m.id, kind: m.bug.kind, n: 0 };
        e.n++; e.t = m.bug.t; e.kind = m.bug.kind === "boss" || e.kind === "boss" ? "boss" : m.bug.kind === "elite" || e.kind === "elite" ? "elite" : "mon";
        meta.bugs[m.bug.id] = e; g.save(g.KM(), meta);
      }
      return r;
    };

    // screens that change for Practice and run dungeons
    var show0 = g.show;
    g.show = function (id) {
      show0(id);
      var G = g.G;
      if (id === "winScreen" && G && G.dungeon) winRun(G);
      if (id === "deadScreen" && G && G.practice) {
        el("deadTitle").textContent = G.hp > 0 ? "PRACTICE DONE!" : "PRACTICE OVER";
        el("deadBank").textContent = "PRACTICE BANKS NO SHARDS";
      }
    };
    function winRun(G) {
      var p = el("winScreen").querySelector("p"), boss = G.dungeon.plan && G.dungeon.plan.boss[12];
      if (p && boss) p.innerHTML = "<b>" + esc(shortTitle(boss.title)) + "</b> is squashed. You won the <b>Victory Crown</b>! It stays on your delver forever. <b>+25 ◆ bonus.</b>";
      if (G.clearAsked || !host || !host.clear) return;
      G.clearAsked = true; g.persist();
      host.clear(G.dungeon.id).then(function (r) {
        if (!r || !r.bonus || g.G !== G) return;
        G.shards += r.bonus; g.persist();
        data.cleared = (data.cleared || []).concat([G.dungeon.id]);
        if (p) p.innerHTML += " <b style=\"color:var(--gold)\">First clear of " + esc(G.dungeon.label) + ": +" + r.bonus + " ◆</b>";
      }, function () { G.clearAsked = false; });
    }

    // ---------- Bug Log: Monsters | Your bugs ----------
    var tab = "mon";
    var tabs = document.createElement("div");
    tabs.className = "ltabs"; tabs.setAttribute("role", "tablist");
    tabs.innerHTML = '<button role="tab" data-t="mon">MONSTERS</button><button role="tab" data-t="bugs">YOUR BUGS</button>';
    var logScreen = el("logScreen");
    logScreen.insertBefore(tabs, logScreen.querySelector("h2").nextSibling);
    tabs.addEventListener("click", function (e) { var b = e.target.closest("[data-t]"); if (!b) return; tab = b.dataset.t; g.renderLog(); });
    var renderLog0 = g.renderLog;
    g.renderLog = function () {
      tabs.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-selected", String(b.dataset.t === tab)); });
      if (tab === "mon") return renderLog0();
      var list = Object.keys(g.meta.bugs || {}).map(function (id) { return g.meta.bugs[id]; })
        .sort(function (a, b) { return ({ boss: 0, elite: 1, mon: 2 }[a.kind] - { boss: 0, elite: 1, mon: 2 }[b.kind]) || (b.n - a.n); });
      el("logCount").textContent = list.length + " SQUASHED";
      el("logGrid").innerHTML = list.length ? list.map(function (b) {
        return '<div class="lg' + (b.kind === "boss" ? " boss" : b.kind === "elite" ? " elite" : "") + '"><img src="' + g.S(b.img) + '" alt=""><div class="k">' + esc(b.key) + '</div><div class="t">' + esc(b.t) + '</div><div class="c">' +
          (b.kind === "boss" ? "BOSS " : b.kind === "elite" ? "★ " : "") + "×" + b.n + "</div></div>";
      }).join("") : '<p style="grid-column:1/-1">Your bugs from a closed run turn into monsters in that run\'s dungeon. Squash them and they show up here. Only you can see this.</p>';
    };
    var logBtn = el("logBtn"), logOpen = logBtn.onclick;
    logBtn.onclick = function () { tab = "mon"; logOpen.call(this); };

    // ---------- first visit: bring your save over from the phone game ----------
    screen("welcomeScreen",
      '<h2>WELCOME TO THE DELVE</h2><p>Played The Delve on your phone? Copy your save code there (<b>Switch</b>, then <b>Copy save code</b>) and paste it here to bring your heroes, Shards and Armory along.</p>' +
      '<textarea class="code" id="welcomeCode" aria-label="Save code" placeholder="DELVE1:…"></textarea><p id="welcomeMsg"></p>' +
      '<div class="btns"><button class="btn p" id="welcomeUse">Use this save</button><button class="btn" id="welcomeFresh">Start fresh</button></div>');
    el("welcomeUse").onclick = function () {
      var c = el("welcomeCode").value.trim();
      try {
        var o = JSON.parse(decodeURIComponent(escape(atob(c.replace(/^DELVE1:/, ""))))); if (!o.meta || !o.meta.unlocked) throw 0;
        var s = g.slots, sl = s.list[0];
        sl.name = String(o.name || sl.name).slice(0, 16);
        g.save(g.KM(sl.id), o.meta); if (o.run) g.save(g.KR(sl.id), o.run); else g.drop(g.KR(sl.id));
        g.saveSlots(); welcomed(); g.switchSlot(sl.id);
      } catch (e) { el("welcomeMsg").innerHTML = "<b>That save code didn't work.</b> Check that you copied all of it."; }
    };
    el("welcomeFresh").onclick = function () { welcomed(); g.renderTitle(); g.show("title"); };
    function welcomed() { g.save("delve.fp.welcomed", 1); }

    // test hooks, like the game's own window.__delve
    window.__fpDelveTest = { kill: function (m) { return g.killMon(m); }, plan: plan, flush: function () { flush(false); } };

    // the first time ever, offer the save code before anything else
    var fresh = !g.load("delve.fp.welcomed", 0) && g.slots.list.length === 1 && !g.meta.runs && !g.meta.bank && !g.load(g.KR(), null);
    if (fresh) setTimeout(function () { if (!el("title").hidden) g.show("welcomeScreen"); }, 0);
    else if (!g.load("delve.fp.welcomed", 0)) welcomed();
  };
})();
