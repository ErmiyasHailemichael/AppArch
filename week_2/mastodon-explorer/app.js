/* DOM wiring for the Mastodon Architecture Explorer. */
(function () {
  'use strict';

  var D = window.MASTODON_DATA;
  var L = window.ArchLogic;
  if (!D || !L) return;

  var BADGE = { ok: 'Done', delayed: 'Delayed', blocked: 'Blocked', skipped: 'Not run' };

  function el(tag, opts, kids) {
    var node = document.createElement(tag);
    opts = opts || {};
    if (opts.className) node.className = opts.className;
    if (opts.text !== undefined) node.textContent = opts.text;
    if (opts.attrs) {
      Object.keys(opts.attrs).forEach(function (k) { node.setAttribute(k, opts.attrs[k]); });
    }
    (kids || []).forEach(function (kid) { node.appendChild(kid); });
    return node;
  }

  function byId(id) { return document.getElementById(id); }

  function findComponent(id) {
    return D.COMPONENTS.filter(function (c) { return c.id === id; })[0];
  }

  /* ---------- Component map ---------- */
  var mapEl = byId('map');
  var detailEl = byId('detail');

  function renderMap() {
    D.LAYERS.forEach(function (layer) {
      var nodes = el('div', { className: 'nodes' });
      D.COMPONENTS.filter(function (c) { return c.layer === layer.id; }).forEach(function (c) {
        var btn = el('button', { className: 'node', attrs: { type: 'button', 'data-id': c.id, 'aria-pressed': 'false' } }, [
          el('span', { className: 'name', text: c.name }),
          el('span', { className: 'tech', text: c.tech })
        ]);
        if (c.optional) btn.appendChild(el('span', { className: 'tag', text: 'Optional' }));
        btn.addEventListener('click', function () { selectComponent(c.id, false); });
        nodes.appendChild(btn);
      });
      mapEl.appendChild(el('div', { className: 'layer' }, [el('h3', { text: layer.label }), nodes]));
    });
  }

  function selectComponent(id, moveFocus) {
    var c = findComponent(id);
    if (!c) return;

    Array.prototype.forEach.call(mapEl.querySelectorAll('.node'), function (btn) {
      btn.setAttribute('aria-pressed', btn.getAttribute('data-id') === id ? 'true' : 'false');
    });

    detailEl.textContent = '';
    detailEl.appendChild(el('h3', { text: c.name + (c.optional ? ' (optional)' : '') }));
    detailEl.appendChild(el('p', { text: c.role }));

    var list = el('ul');
    c.facts.forEach(function (f) { list.appendChild(el('li', { text: f })); });
    detailEl.appendChild(list);

    var src = el('p', { className: 'sources' }, [document.createTextNode('Sources: ')]);
    c.sources.forEach(function (s, i) {
      if (i > 0) src.appendChild(document.createTextNode(' · '));
      src.appendChild(el('a', { text: s.label, attrs: { href: s.url, target: '_blank', rel: 'noopener noreferrer' } }));
    });
    detailEl.appendChild(src);

    if (moveFocus) {
      detailEl.focus();
      detailEl.scrollIntoView({ block: 'nearest' });
    }
  }

  /* ---------- Trace form ---------- */
  var form = byId('trace-form');
  var textEl = byId('post-text');
  var serversEl = byId('servers');
  var failureEl = byId('failure');
  var publicEl = byId('public');
  var countEl = byId('count');
  var textHelp = byId('text-help');
  var textError = byId('text-error');
  var serversError = byId('servers-error');
  var resultEl = byId('result');

  function fillFailureOptions() {
    Object.keys(L.FAILURES).forEach(function (key) {
      failureEl.appendChild(el('option', { text: L.FAILURES[key], attrs: { value: key } }));
    });
  }

  function updateCount() {
    var n = L.countChars(textEl.value.trim());
    countEl.textContent = String(n);
    textHelp.classList.toggle('over', n > L.POST_LIMIT);
  }

  function setError(input, errorEl, message) {
    errorEl.textContent = message || '';
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  function renderResult(value) {
    var steps = L.buildTrace(value, failureEl.value, publicEl.checked);

    byId('preview').textContent = value.text;
    var list = byId('steps');
    list.textContent = '';

    steps.forEach(function (s) {
      var head = el('div', { className: 'step-head' }, [
        el('h4', { className: 'step-title', text: s.title }),
        el('span', { className: 'badge ' + s.status, text: BADGE[s.status] }),
        el('span', { className: 'when', text: s.async ? 'Background' : 'While the user waits' })
      ]);
      var li = el('li', { className: 'step' }, [head, el('p', { text: s.detail })]);
      var comp = findComponent(s.component);
      if (comp) {
        var open = el('button', { className: 'linkbtn', text: 'Show ' + comp.name + ' in the map', attrs: { type: 'button' } });
        open.addEventListener('click', function () {
          selectComponent(comp.id, true);
        });
        li.appendChild(open);
      }
      list.appendChild(li);
    });

    byId('summary').textContent = L.summarize(failureEl.value);
    resultEl.hidden = false;
    byId('result-h').focus();
  }

  function onSubmit(event) {
    event.preventDefault();
    var check = L.validateInput(textEl.value, serversEl.value);
    setError(textEl, textError, check.errors.text);
    setError(serversEl, serversError, check.errors.servers);

    if (!check.ok) {
      resultEl.hidden = true;
      (check.errors.text ? textEl : serversEl).focus();
      return;
    }
    renderResult(check.value);
  }

  function onReset() {
    form.reset();
    serversEl.value = '12';
    publicEl.checked = true;
    setError(textEl, textError, '');
    setError(serversEl, serversError, '');
    resultEl.hidden = true;
    updateCount();
    textEl.focus();
  }

  /* ---------- Fact-check log ---------- */
  function renderLog() {
    var list = byId('log');
    D.VERIFICATION_LOG.forEach(function (item) {
      var dl = el('dl', null, [
        el('dt', { text: 'First AI assumption' }), el('dd', { text: item.assumption }),
        el('dt', { text: 'What the sources say' }), el('dd', { text: item.finding }),
        el('dt', { text: 'Outcome' }), el('dd', { className: 'outcome', text: item.outcome })
      ]);
      var link = el('a', { text: item.source.label, attrs: { href: item.source.url, target: '_blank', rel: 'noopener noreferrer' } });
      var src = el('dd', null, [link]);
      dl.appendChild(el('dt', { text: 'Source' }));
      dl.appendChild(src);
      list.appendChild(el('li', null, [dl]));
    });
  }

  /* ---------- Start ---------- */
  renderMap();
  selectComponent('web', false);
  fillFailureOptions();
  renderLog();
  updateCount();

  textEl.addEventListener('input', updateCount);
  form.addEventListener('submit', onSubmit);
  byId('reset').addEventListener('click', onReset);
})();
