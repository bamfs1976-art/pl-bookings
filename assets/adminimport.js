/* The import view — a CSV in, a pl_data.js player block out.
 *
 * WHAT PROBLEM THIS SOLVES. Refreshing the desk's player data is a Python
 * script against a source that needs a logged-in session, run on a machine
 * that has one. That is fine when it runs; when it does not — a feed changes
 * shape, a club's squad is wrong, a promoted side has numbers nobody harvested
 * — the only route in is to hand-edit a generated file, which is exactly how a
 * dataset acquires a row nobody can reproduce.
 *
 * So: paste or pick a CSV, and this parses it in the browser (PapaParse, MIT),
 * checks the columns, derives the per-90 rates and the risk score with the
 * same arithmetic the Python emitter uses, and prints the `PL_PLAYERS` block
 * to copy into data/pl_data.js. Nothing is uploaded and nothing is written —
 * it is a calculator that speaks the file's own format.
 *
 * IT IS BEHIND A URL FLAG, NOT BEHIND SECURITY. `?admin=1` keeps a view that
 * would confuse a reader out of a reader's way. It is a static page: there is
 * no server, no session and nothing to protect — every byte here ships to
 * everybody either way, and pretending otherwise would be worse than saying
 * so. The flag is tidiness. The honesty is that the output has to be reviewed
 * and committed by a human before it is anything.
 *
 * THE MINUTES FLOOR IS REPORTED, NOT ENFORCED. Rows under 450 minutes are
 * flagged and counted, and they are emitted with ls:true — the same treatment
 * the pipeline gives them. Dropping them here would put the decision in the
 * wrong place: the file records what is known, and the app decides how to show
 * it.
 *
 * DEPENDENCIES: PapaParse (MIT), vendored into index.html.
 */
(function (root) {
  'use strict';

  var FLOOR = 450;

  /* The columns the emitter needs, and what each is called in the wild. The
     harvests this replaces spell the same field three ways, and a header the
     parser does not recognise is silently a column of nulls — which reads, in
     the shipped file, exactly like a player who never fouled. */
  var COLUMNS = [
    { key: 'club', required: true, aliases: ['club', 'team', 'c', 'short', 'club_short'] },
    { key: 'name', required: true, aliases: ['name', 'player', 'n', 'player_name'] },
    { key: 'position', required: true, aliases: ['position', 'pos', 'p'] },
    { key: 'minutes', required: true, aliases: ['minutes', 'mins', 'min', 'minutes_played'] },
    { key: 'yellows', required: true, aliases: ['yellows', 'yc', 'yellow_cards', 'cards'] },
    { key: 'reds', required: false, aliases: ['reds', 'rc', 'red_cards'] },
    { key: 'fouls', required: true, aliases: ['fouls', 'fouls_committed', 'fc', 'f'] },
    { key: 'fouls_won', required: false, aliases: ['fouls_won', 'fouls_drawn', 'fw', 'won'] },
    { key: 'basis', required: false, aliases: ['basis', 'b', 'source_basis'] }
  ];

  var POSITIONS = ['GK', 'DF', 'MF', 'FW'];
  var BASES = ['PL', 'EFL', 'NEW'];

  function normHeader(h) {
    return String(h == null ? '' : h).trim().toLowerCase().replace(/[\s.-]+/g, '_');
  }

  function mapHeaders(fields) {
    var seen = (fields || []).map(normHeader);
    var map = Object.create(null), missing = [], unknown = [];
    COLUMNS.forEach(function (c) {
      var hit = null;
      for (var i = 0; i < c.aliases.length; i++) {
        var at = seen.indexOf(c.aliases[i]);
        if (at > -1) { hit = fields[at]; break; }
      }
      if (hit) map[c.key] = hit;
      else if (c.required) missing.push(c.key);
    });
    var claimed = Object.keys(map).map(function (k) { return normHeader(map[k]); });
    seen.forEach(function (h, i) {
      if (h && claimed.indexOf(h) === -1) unknown.push(fields[i]);
    });
    return { map: map, missing: missing, unknown: unknown };
  }

  function num(x) {
    if (x == null || x === '') return null;
    var v = Number(String(x).replace(/,/g, '').trim());
    return isFinite(v) ? v : null;
  }

  /* Rounding to the emitter's precision, so a row that goes through here and a
     row that goes through data/build_pl_data.py are the same text. */
  function r3(x) { return x == null ? null : Math.round(x * 1000) / 1000; }
  function r2(x) { return x == null ? null : Math.round(x * 100) / 100; }

  /* JSON.stringify, which is what the Python emitter's jsval does for strings
     — including the escaping. A club called O'Brien FC must not end the
     literal. */
  function jsval(x) {
    if (x == null) return 'null';
    if (typeof x === 'boolean') return x ? 'true' : 'false';
    if (typeof x === 'string') return JSON.stringify(x);
    return String(x);
  }

  /* One parsed CSV row -> one shipped player, plus everything wrong with it.
     Problems are collected rather than thrown: a run that stops at the first
     bad row tells you about one of them. */
  function buildRow(raw, map, index, knownClubs) {
    var get = function (k) {
      var col = map[k];
      return col == null ? null : raw[col];
    };
    var problems = [];
    var name = String(get('name') || '').trim();
    var club = String(get('club') || '').trim().toUpperCase();
    var pos = String(get('position') || '').trim().toUpperCase();
    var mins = num(get('minutes'));
    var yc = num(get('yellows'));
    var rc = num(get('reds'));
    var fouls = num(get('fouls'));
    var fw = num(get('fouls_won'));
    var basis = String(get('basis') || 'PL').trim().toUpperCase() || 'PL';

    if (!name) problems.push({ level: 'error', msg: 'no player name' });
    if (!club) problems.push({ level: 'error', msg: 'no club' });
    else if (knownClubs && knownClubs.length && knownClubs.indexOf(club) === -1) {
      problems.push({ level: 'error', msg: 'club "' + club + '" is not one of the ' + knownClubs.length + ' in the dataset' });
    }
    if (POSITIONS.indexOf(pos) === -1) {
      problems.push({ level: 'error', msg: 'position "' + pos + '" is not GK, DF, MF or FW' });
    }
    if (mins == null || mins < 0) problems.push({ level: 'error', msg: 'minutes missing or negative' });
    if (yc == null || yc < 0) problems.push({ level: 'error', msg: 'yellows missing or negative' });
    if (BASES.indexOf(basis) === -1) {
      problems.push({ level: 'error', msg: 'basis "' + basis + '" is not PL, EFL or NEW' });
    }
    /* A blank fouls cell is NOT nought. Read as nought it fits the player as
       the most disciplined in the division, which is the single most damaging
       thing a bad import can do here, and it is invisible in the output. */
    if (fouls == null) {
      problems.push({ level: 'warn', msg: 'no fouls figure — emitted as null, not 0' });
    }
    if (mins != null && mins < FLOOR) {
      problems.push({
        level: 'floor',
        msg: mins + ' minutes is under the ' + FLOOR + '-minute floor — emitted with ls:true '
          + 'and shown greyed in the app'
      });
    }

    var per90 = mins != null && mins > 0 ? mins / 90 : null;
    var y = (per90 && yc != null) ? r3(yc / per90) : null;
    var f = (per90 && fouls != null) ? r2(fouls / per90) : null;
    var fwr = (per90 && fw != null) ? r3(fw / per90) : null;
    /* The standing formula, unchanged: yellows per 90 doubled, plus fouls per
       90. It is the desk's ranking and it does not get quietly redefined by an
       import path.

       Computed from the ROUNDED rates — the ones that go in the file — rather
       than from the unrounded division. data/build_pl_data.py takes its fouls
       per 90 straight from a source that already supplies one, so the question
       does not arise there; here they are derived from a count, and a row whose
       r cannot be reproduced from the y and f printed beside it is a row nobody
       reviewing the paste can check. */
    var risk = (y == null) ? null : r3(y * 2 + (f == null ? 0 : f));
    if (y != null && f == null) {
      problems.push({ level: 'warn', msg: 'risk score computed from the yellow half only (no fouls)' });
    }

    return {
      line: index + 2,          // +1 for the header, +1 for 1-based
      ok: !problems.some(function (p) { return p.level === 'error'; }),
      problems: problems,
      player: {
        c: club, n: name, p: pos,
        min: mins == null ? 0 : Math.round(mins),
        yc: yc == null ? null : Math.round(yc),
        rc: rc == null ? null : Math.round(rc),
        y: y, f: f, fw: fwr, r: risk,
        ls: mins == null ? true : mins < FLOOR,
        b: basis
      }
    };
  }

  function playerLiteral(p) {
    return '{' + [
      'c:' + jsval(p.c), 'n:' + jsval(p.n), 'p:' + jsval(p.p),
      'min:' + p.min, 'yc:' + jsval(p.yc), 'rc:' + jsval(p.rc),
      'y:' + jsval(p.y), 'f:' + jsval(p.f), 'fw:' + jsval(p.fw),
      'r:' + jsval(p.r), 'ls:' + jsval(p.ls), 'b:' + jsval(p.b)
    ].join(',') + '}';
  }

  /* The emitted block. Byte-compatible with what data/build_pl_data.py writes,
     because the point is to paste it into the file that script owns — a block
     that merely looks similar produces a diff nobody can review. */
  function emit(rows, meta) {
    var good = rows.filter(function (r) { return r.ok; });
    var m = meta || {};
    var header = [
      '// PL_PLAYERS block produced by the in-app import view (assets/adminimport.js)',
      '// from ' + (m.filename ? JSON.stringify(m.filename) : 'a pasted CSV') + '.',
      '//',
      '// ' + good.length + ' player rows, ' + good.filter(function (r) { return r.player.ls; }).length
        + ' under the ' + FLOOR + '-minute floor (ls:true).',
      '// Rates are per 90; risk = yellows/90 x 2 + fouls/90. A missing fouls',
      '// figure is emitted as null, never as 0.',
      '//',
      '// REVIEW THIS BEFORE COMMITTING. It has not been through the harvest\'s',
      '// own coverage guards (data/test_coverage.py) — those run against the',
      '// pipeline, not against a paste.',
      'const PL_PLAYERS = ['
    ];
    var body = good.map(function (r) { return '  ' + playerLiteral(r.player) + ','; });
    return header.concat(body, ['];']).join('\n');
  }

  function summarise(rows) {
    var errors = [], warnings = [], floors = [];
    rows.forEach(function (r) {
      r.problems.forEach(function (p) {
        /* A rejected row is not going in the file at all, so its warnings and
           its minutes are moot — reporting them buries the four errors that
           actually explain why it was rejected under advice about a row nobody
           is going to ship. Errors still show, all of them. */
        if (p.level !== 'error' && !r.ok) return;
        var entry = { line: r.line, name: r.player.n || '(unnamed)', msg: p.msg };
        if (p.level === 'error') errors.push(entry);
        else if (p.level === 'floor') floors.push(entry);
        else warnings.push(entry);
      });
    });
    return {
      total: rows.length,
      accepted: rows.filter(function (r) { return r.ok; }).length,
      rejected: rows.filter(function (r) { return !r.ok; }).length,
      belowFloor: floors.length,
      floor: FLOOR,
      errors: errors,
      warnings: warnings,
      floors: floors
    };
  }

  /* The whole run: text or File in, a result object out. Never throws — a
     malformed CSV is an ordinary outcome here, not an exception. */
  function parse(input, opts, done) {
    var o = opts || {};
    var Papa = o.Papa || root.Papa;
    if (!Papa) { done({ ok: false, fatal: 'PapaParse is not loaded.' }); return; }

    var config = {
      header: true,
      skipEmptyLines: 'greedy',
      /* No worker: the page's Content-Security-Policy has no worker-src, so a
         blob worker would be blocked. A season of players is a few hundred
         rows and parses in a frame. */
      worker: false,
      transformHeader: function (h) { return String(h == null ? '' : h).trim(); },
      complete: function (res) {
        var head = mapHeaders(res.meta && res.meta.fields);
        if (head.missing.length) {
          done({
            ok: false,
            fatal: 'The CSV is missing required column(s): ' + head.missing.join(', ')
              + '. Recognised headers are ' + COLUMNS.map(function (c) { return c.aliases[0]; }).join(', ')
              + ' (aliases accepted).',
            headers: res.meta && res.meta.fields,
            unknown: head.unknown
          });
          return;
        }
        var rows = (res.data || []).map(function (raw, i) {
          return buildRow(raw, head.map, i, o.clubs);
        });
        var summary = summarise(rows);
        done({
          ok: true,
          headers: res.meta && res.meta.fields,
          mapped: head.map,
          unknown: head.unknown,
          /* PapaParse's own structural complaints (ragged rows, bad quotes),
             kept separate from ours so it is clear which layer objected. */
          parseErrors: (res.errors || []).map(function (e) {
            return { line: (e.row == null ? '?' : e.row + 2), msg: e.message };
          }),
          rows: rows,
          summary: summary,
          output: emit(rows, { filename: o.filename })
        });
      },
      error: function (err) {
        done({ ok: false, fatal: 'PapaParse could not read that: ' + (err && err.message || err) });
      }
    };

    if (typeof input === 'string') Papa.parse(input, config);
    else Papa.parse(input, config);
  }

  var PLAdminImport = {
    parse: parse,
    mapHeaders: mapHeaders,
    buildRow: buildRow,
    playerLiteral: playerLiteral,
    emit: emit,
    summarise: summarise,
    COLUMNS: COLUMNS,
    FLOOR: FLOOR
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PLAdminImport;
  root.PLAdminImport = PLAdminImport;
})(typeof window !== 'undefined' ? window : globalThis);
