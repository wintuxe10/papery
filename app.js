const navButtons = document.querySelectorAll('.nav-btn');
const sections = {
  notes: document.getElementById('notes-section'),
  calendar: document.getElementById('calendar-section'),
  flashcards: document.getElementById('flashcards-section'),
};

function showSection(key) {
  navButtons.forEach((b) => b.classList.remove('active'));
  const btn = document.getElementById('nav-' + key);
  if (btn) btn.classList.add('active');

  Object.values(sections).forEach((sec) => sec.classList.add('hidden'));
  sections[key].classList.remove('hidden');
}

navButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    showSection(btn.id.replace('nav-', ''));
  });
});

let vault = { notes: [], events: [], decks: [] };

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function findIn(collection, id) {
  if (!id) return null;
  return vault[collection].find((item) => item.id === id) || null;
}

function labelOf(item) {
  return item.title !== undefined ? item.title : item.name;
}

const MIN_PASSWORD = 8;

async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 600000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptVault(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const enc = new TextEncoder();
  const data = enc.encode(JSON.stringify(vault));
  const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);

  const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

  localStorage.setItem('vault_data', toB64(cipherBuffer));
  localStorage.setItem('vault_salt', toB64(salt));
  localStorage.setItem('vault_iv', toB64(iv));
}

async function decryptVault(password) {
  const fromB64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
  const salt = fromB64(localStorage.getItem('vault_salt'));
  const iv = fromB64(localStorage.getItem('vault_iv'));
  const cipherBytes = fromB64(localStorage.getItem('vault_data'));
  const key = await deriveKey(password, salt);
  const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipherBytes);
  const dec = new TextDecoder();
  vault = JSON.parse(dec.decode(plainBuffer));
}

let currentPassword = null;

async function saveVault() {
  await encryptVault(currentPassword);
}

async function unlockOrCreateVault() {
  const hasVault = localStorage.getItem('vault_data') !== null;

  if (!hasVault) {
    const pw = await askNewPassword();
    if (pw === null) throw new Error('setup cancelled');
    currentPassword = pw;
    await saveVault();
    return;
  }

  let problem = '';
  while (true) {
    const pw = await askPassword(problem);
    if (pw === null) throw new Error('unlock cancelled');
    try {
      await decryptVault(pw);
      currentPassword = pw;
      return;
    } catch (e) {
      problem = 'Wrong password. Try again.';
    }
  }
}

const LINK_FIELD = {
  notes: 'linkedNoteId',
  events: 'linkedEventId',
  decks: 'linkedDeckId',
};

function unlink(item, type, otherType) {
  const field = LINK_FIELD[otherType];
  const otherId = item[field];
  if (!otherId) return;
  item[field] = null;
  const other = findIn(otherType, otherId);
  if (other && other[LINK_FIELD[type]] === item.id) other[LINK_FIELD[type]] = null;
}

function setLink(item, type, otherType, otherId) {
  unlink(item, type, otherType);
  if (!otherId) return;
  const other = findIn(otherType, otherId);
  if (!other) return;
  unlink(other, otherType, type);
  item[LINK_FIELD[otherType]] = other.id;
  other[LINK_FIELD[type]] = item.id;
}

const dialog = {
  backdrop: document.getElementById('dialog-backdrop'),
  form: document.getElementById('dialog'),
  title: document.getElementById('dialog-title'),
  fields: document.getElementById('dialog-fields'),
  error: document.getElementById('dialog-error'),
  submit: document.getElementById('dialog-submit'),
  cancel: document.getElementById('dialog-cancel'),
};

let cancelDialog = null;

function applyTypingRules(el) {
  el.setAttribute('spellcheck', 'false');
  el.setAttribute('autocapitalize', 'off');
  el.setAttribute('autocorrect', 'off');
}

function makeField(spec) {
  const wrap = document.createElement('div');
  wrap.className = 'field';

  const label = document.createElement('label');
  label.textContent = spec.label;
  label.setAttribute('for', 'f-' + spec.name);
  wrap.appendChild(label);

  let input;
  if (spec.type === 'textarea') {
    input = document.createElement('textarea');
    input.rows = 4;
  } else if (spec.type === 'select') {
    input = document.createElement('select');
    (spec.options || []).forEach((o) => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      input.appendChild(opt);
    });
  } else {
    input = document.createElement('input');
    input.type = spec.type || 'text';
  }

  input.id = 'f-' + spec.name;
  input.name = spec.name;
  input.value = spec.value === undefined || spec.value === null ? '' : spec.value;

  if (spec.type !== 'select') applyTypingRules(input);
  if (spec.autocomplete) input.setAttribute('autocomplete', spec.autocomplete);
  if (spec.minlength) input.setAttribute('minlength', String(spec.minlength));
  if (spec.placeholder) input.setAttribute('placeholder', spec.placeholder);
  if (spec.type === 'password') input.setAttribute('enterkeyhint', 'go');

  wrap.appendChild(input);

  if (spec.type === 'password') {
    wrap.appendChild(textButton('Show password', () => {
      input.type = input.type === 'password' ? 'text' : 'password';
    }, 'reveal'));
  }

  return { wrap, read: () => input.value, input: input };
}

function makeCardsField(spec) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const label = document.createElement('label');
  label.textContent = spec.label;
  wrap.appendChild(label);

  const rows = document.createElement('div');
  wrap.appendChild(rows);

  let data = (spec.value || []).slice();
  const pairs = [];

  function readRows() {
    return pairs.map((p) => ({ front: p.front.value, back: p.back.value }));
  }

  function draw() {
    rows.innerHTML = '';
    pairs.length = 0;
    data.forEach((card, i) => {
      const row = document.createElement('div');
      row.className = 'card-row';
      const front = document.createElement('input');
      front.type = 'text';
      front.value = card.front || '';
      front.setAttribute('placeholder', 'Question');
      const back = document.createElement('input');
      back.type = 'text';
      back.value = card.back || '';
      back.setAttribute('placeholder', 'Answer');
      applyTypingRules(front);
      applyTypingRules(back);
      row.appendChild(front);
      row.appendChild(back);
      row.appendChild(textButton('Remove', () => {
        data = readRows();
        data.splice(i, 1);
        draw();
      }, 'remove-card'));
      pairs.push({ front: front, back: back });
      rows.appendChild(row);
    });
  }

  draw();
  wrap.appendChild(textButton('Add a card', () => {
    data = readRows();
    data.push({ front: '', back: '' });
    draw();
  }, 'add-card'));

  return {
    wrap: wrap,
    read: () => readRows().filter((c) => c.front.trim() !== ''),
  };
}

function openForm(config) {
  return new Promise((resolve) => {
    dialog.title.textContent = config.title;
    dialog.submit.textContent = config.submitLabel || 'Save';
    showError(config.error || '');

    dialog.fields.innerHTML = '';
    const readers = {};
    let firstInput = null;
    config.fields.forEach((spec) => {
      const built = spec.type === 'cards' ? makeCardsField(spec) : makeField(spec);
      dialog.fields.appendChild(built.wrap);
      readers[spec.name] = built.read;
      if (!firstInput && built.input) firstInput = built.input;
    });

    function finish(result) {
      dialog.backdrop.classList.remove('open');
      cancelDialog = null;
      dialog.form.onsubmit = null;
      resolve(result);
    }
    cancelDialog = () => finish(null);

    dialog.form.onsubmit = (event) => {
      if (event && event.preventDefault) event.preventDefault();
      const values = {};
      Object.keys(readers).forEach((name) => { values[name] = readers[name](); });
      const problem = config.validate ? config.validate(values) : null;
      if (problem) {
        showError(problem);
        return;
      }
      finish(values);
    };

    dialog.backdrop.classList.add('open');
    if (firstInput && firstInput.focus) firstInput.focus();
  });
}

function showError(message) {
  dialog.error.textContent = message;
  if (message) dialog.error.classList.remove('hidden');
  else dialog.error.classList.add('hidden');
}

dialog.cancel.addEventListener('click', () => {
  if (cancelDialog) cancelDialog();
});

if (document.addEventListener) {
  document.addEventListener('keydown', (event) => {
    if (event && event.key === 'Escape' && cancelDialog) cancelDialog();
  });
}

function askPassword(problem) {
  return openForm({
    title: 'Unlock your vault',
    submitLabel: 'Unlock',
    error: problem,
    fields: [{ name: 'pw', label: 'Password', type: 'password', autocomplete: 'current-password' }],
  }).then((v) => (v ? v.pw : null));
}

function askNewPassword() {
  return openForm({
    title: 'Create your vault password',
    submitLabel: 'Create vault',
    fields: [
      { name: 'pw', label: 'Password', type: 'password', autocomplete: 'new-password', minlength: MIN_PASSWORD },
      { name: 'again', label: 'Type it again', type: 'password', autocomplete: 'new-password' },
    ],
    validate: (v) => {
      if (v.pw.length < MIN_PASSWORD) return 'Use at least ' + MIN_PASSWORD + ' characters.';
      if (v.pw !== v.again) return 'Those two passwords did not match.';
      return null;
    },
  }).then((v) => (v ? v.pw : null));
}

function linkOptions(collection) {
  const options = [{ value: '', label: '(none)' }];
  vault[collection].forEach((item) => options.push({ value: item.id, label: labelOf(item) }));
  return options;
}

const SECTION_OF = { notes: 'notes', events: 'calendar', decks: 'flashcards' };

const cardEls = {};

function renderAll() {
  renderNotes();
  renderCalendar();
  renderFlashcards();
}

const ICONS = {
  edit: 'M180-180h44l472-471-44-44-472 471v44Zm-60 60v-128l575-574q8-8 19-12.5t23-4.5q11 0 22 4.5t20 12.5l44 44q9 9 13 20t4 22q0 11-4.5 22.5T823-694L248-120H120Zm659-617-41-41 41 41Zm-105 64-22-22 44 44-22-22Z',
  delete: 'M261-120q-24.75 0-42.37-17.63Q201-155.25 201-180v-570h-41v-60h188v-30h264v30h188v60h-41v570q0 24-18 42t-42 18H261Zm438-630H261v570h438v-570ZM367-266h60v-399h-60v399Zm166 0h60v-399h-60v399ZM261-750v570-570Z',
  school: 'M479-120 189-279v-240L40-600l439-240 441 240v317h-60v-282l-91 46v240L479-120Zm0-308 315-172-315-169-313 169 313 172Zm0 240 230-127v-168L479-360 249-485v170l230 127Zm1-240Zm-1 74Zm0 0Z',
};

function iconButton(iconName, label, onClick) {
  const btn = document.createElement('button');
  btn.innerHTML =
    '<svg class="icon" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true" focusable="false">' +
    '<path d="' + ICONS[iconName] + '"/></svg>';
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.addEventListener('click', onClick);
  return btn;
}

function textButton(label, onClick, className) {
  const btn = document.createElement('button');
  btn.textContent = label;
  if (className) btn.className = className;
  btn.addEventListener('click', onClick);
  return btn;
}

function textLine(tag, text, className) {
  const el = document.createElement(tag);
  el.textContent = text;
  if (className) el.className = className;
  return el;
}

function cardShell(item) {
  const div = document.createElement('div');
  div.className = 'card';
  div.setAttribute('data-id', item.id);
  cardEls[item.id] = div;
  return div;
}

function addCardActions(cardEl, buttons) {
  const actions = document.createElement('div');
  actions.className = 'card-actions';
  buttons.forEach((b) => actions.appendChild(b));
  cardEl.appendChild(actions);
}

function linkRow(prefix, target, targetType) {
  const row = textButton(prefix + labelOf(target), () => goToItem(targetType, target.id), 'link-row');
  row.type = 'button';
  return row;
}

function goToItem(type, id) {
  if (reviewState) {
    reviewState = null;
    renderFlashcards();
  }
  showSection(SECTION_OF[type]);
  const card = cardEls[id];
  if (!card) return;
  if (card.scrollIntoView) card.scrollIntoView({ block: 'center' });
  card.classList.add('flash');
  setTimeout(() => card.classList.remove('flash'), 1200);
}

function renderNotes() {
  const list = document.getElementById('notes-list');
  list.innerHTML = '';
  vault.notes.forEach((note) => {
    const div = cardShell(note);
    div.appendChild(textLine('strong', note.title));
    div.appendChild(textLine('p', note.content));
    const linkedEvent = findIn('events', note.linkedEventId);
    const linkedDeck = findIn('decks', note.linkedDeckId);
    if (linkedEvent) div.appendChild(linkRow('Linked event: ', linkedEvent, 'events'));
    if (linkedDeck) div.appendChild(linkRow('Linked deck: ', linkedDeck, 'decks'));
    addCardActions(div, [
      iconButton('edit', 'Edit', () => editNote(note)),
      iconButton('delete', 'Delete', () => confirmAndDelete('notes', note, note.title)),
    ]);
    list.appendChild(div);
  });
}

function renderCalendar() {
  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = '';
  const inDateOrder = vault.events.slice().sort((a, b) => a.date.localeCompare(b.date));
  inDateOrder.forEach((ev) => {
    const div = cardShell(ev);
    div.appendChild(textLine('strong', ev.title));
    div.appendChild(textLine('p', ev.date));
    const linkedNote = findIn('notes', ev.linkedNoteId);
    const linkedDeck = findIn('decks', ev.linkedDeckId);
    if (linkedNote) div.appendChild(linkRow('Linked note: ', linkedNote, 'notes'));
    if (linkedDeck) div.appendChild(linkRow('Linked deck: ', linkedDeck, 'decks'));
    addCardActions(div, [
      iconButton('edit', 'Edit', () => editEvent(ev)),
      iconButton('delete', 'Delete', () => confirmAndDelete('events', ev, ev.title)),
    ]);
    grid.appendChild(div);
  });
}

function renderFlashcards() {
  const list = document.getElementById('flashcards-list');
  list.innerHTML = '';
  if (reviewState) {
    renderReview(list);
    return;
  }
  vault.decks.forEach((deck) => {
    const div = cardShell(deck);
    div.appendChild(textLine('strong', deck.name));
    div.appendChild(textLine('p', deck.cards.length + ' card(s)'));
    const linkedEvent = findIn('events', deck.linkedEventId);
    const linkedNote = findIn('notes', deck.linkedNoteId);
    if (linkedEvent) div.appendChild(linkRow('Linked event: ', linkedEvent, 'events'));
    if (linkedNote) div.appendChild(linkRow('Linked note: ', linkedNote, 'notes'));
    addCardActions(div, [
      iconButton('school', 'Study', () => startReview(deck)),
      iconButton('edit', 'Edit', () => editDeck(deck)),
      iconButton('delete', 'Delete', () => confirmAndDelete('decks', deck, deck.name)),
    ]);
    list.appendChild(div);
  });
}

let reviewState = null;

function startReview(deck) {
  if (deck.cards.length === 0) {
    alert('This deck has no cards yet. Use Edit to add some.');
    return;
  }
  reviewState = { deckId: deck.id, index: 0, revealed: false };
  showSection('flashcards');
  renderFlashcards();
}

function endReview() {
  reviewState = null;
  renderFlashcards();
}

function renderReview(list) {
  const deck = findIn('decks', reviewState.deckId);
  if (!deck || deck.cards.length === 0) {
    reviewState = null;
    renderFlashcards();
    return;
  }
  const card = deck.cards[reviewState.index];

  const panel = document.createElement('div');
  panel.className = 'card review';
  panel.appendChild(textLine('strong', deck.name));
  panel.appendChild(textLine('p', 'Card ' + (reviewState.index + 1) + ' of ' + deck.cards.length, 'review-count'));
  panel.appendChild(textLine('div', card.front, 'review-face'));
  if (reviewState.revealed) {
    panel.appendChild(textLine('div', card.back, 'review-face review-back'));
  }

  const controls = document.createElement('div');
  controls.className = 'review-controls';
  const isLast = reviewState.index === deck.cards.length - 1;
  if (!reviewState.revealed) {
    controls.appendChild(textButton('Show answer', () => {
      reviewState.revealed = true;
      renderFlashcards();
    }, 'primary'));
  } else {
    controls.appendChild(textButton(isLast ? 'Finish' : 'Next card', () => {
      if (isLast) {
        reviewState = null;
      } else {
        reviewState.index += 1;
        reviewState.revealed = false;
      }
      renderFlashcards();
    }, 'primary'));
  }
  controls.appendChild(textButton('Done', endReview));
  panel.appendChild(controls);
  list.appendChild(panel);
}

function isValidDate(text) {
  const value = String(text).trim();
  if (value.length !== 10) return false;
  const parts = value.split('-');
  if (parts.length !== 3) return false;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!year || !month || !day) return false;
  const when = new Date(Date.UTC(year, month - 1, day));
  return when.getUTCFullYear() === year
    && when.getUTCMonth() === month - 1
    && when.getUTCDate() === day;
}

function noteForm(note) {
  return openForm({
    title: note ? 'Edit note' : 'New note',
    fields: [
      { name: 'title', label: 'Title', type: 'text', value: note ? note.title : '' },
      { name: 'content', label: 'Content', type: 'textarea', value: note ? note.content : '' },
      { name: 'event', label: 'Linked event', type: 'select',
        value: note ? note.linkedEventId || '' : '', options: linkOptions('events') },
      { name: 'deck', label: 'Linked deck', type: 'select',
        value: note ? note.linkedDeckId || '' : '', options: linkOptions('decks') },
    ],
    validate: (v) => (v.title.trim() ? null : 'Please give this note a title.'),
  });
}

function eventForm(ev) {
  return openForm({
    title: ev ? 'Edit event' : 'New event',
    fields: [
      { name: 'title', label: 'Title', type: 'text', value: ev ? ev.title : '' },
      { name: 'date', label: 'Date', type: 'date', value: ev ? ev.date : '' },
      { name: 'note', label: 'Linked note', type: 'select',
        value: ev ? ev.linkedNoteId || '' : '', options: linkOptions('notes') },
      { name: 'deck', label: 'Linked deck', type: 'select',
        value: ev ? ev.linkedDeckId || '' : '', options: linkOptions('decks') },
    ],
    validate: (v) => {
      if (!v.title.trim()) return 'Please give this event a title.';
      if (!isValidDate(v.date)) return 'Please choose a date.';
      return null;
    },
  });
}

function deckForm(deck) {
  return openForm({
    title: deck ? 'Edit deck' : 'New deck',
    fields: [
      { name: 'name', label: 'Deck name', type: 'text', value: deck ? deck.name : '' },
      { name: 'cards', label: 'Cards', type: 'cards',
        value: deck ? deck.cards : [{ front: '', back: '' }] },
      { name: 'note', label: 'Linked note', type: 'select',
        value: deck ? deck.linkedNoteId || '' : '', options: linkOptions('notes') },
      { name: 'event', label: 'Linked event', type: 'select',
        value: deck ? deck.linkedEventId || '' : '', options: linkOptions('events') },
    ],
    validate: (v) => (v.name.trim() ? null : 'Please give this deck a name.'),
  });
}

function deleteItem(collection, id) {
  vault[collection] = vault[collection].filter((item) => item.id !== id);

  Object.values(vault).forEach((list) => {
    list.forEach((item) => {
      Object.keys(item).forEach((key) => {
        if (key.endsWith('Id') && item[key] === id) item[key] = null;
      });
    });
  });
}

async function confirmAndDelete(collection, item, label) {
  if (!confirm(`Delete "${label}"? This cannot be undone.`)) return;
  if (reviewState && reviewState.deckId === item.id) reviewState = null;
  deleteItem(collection, item.id);
  await saveVault();
  renderAll();
}

async function editNote(note) {
  const values = await noteForm(note);
  if (!values) return;
  note.title = values.title.trim();
  note.content = values.content;
  setLink(note, 'notes', 'events', values.event || null);
  setLink(note, 'notes', 'decks', values.deck || null);
  await saveVault();
  renderAll();
}

async function editEvent(ev) {
  const values = await eventForm(ev);
  if (!values) return;
  ev.title = values.title.trim();
  ev.date = values.date;
  setLink(ev, 'events', 'notes', values.note || null);
  setLink(ev, 'events', 'decks', values.deck || null);
  await saveVault();
  renderAll();
}

async function editDeck(deck) {
  const values = await deckForm(deck);
  if (!values) return;
  deck.name = values.name.trim();
  deck.cards = values.cards;
  setLink(deck, 'decks', 'notes', values.note || null);
  setLink(deck, 'decks', 'events', values.event || null);
  if (reviewState && reviewState.deckId === deck.id) reviewState = null;
  await saveVault();
  renderAll();
}

document.getElementById('add-note-btn').addEventListener('click', async () => {
  const values = await noteForm(null);
  if (!values) return;
  const note = { id: uid(), title: values.title.trim(), content: values.content,
                 linkedEventId: null, linkedDeckId: null };
  vault.notes.push(note);
  setLink(note, 'notes', 'events', values.event || null);
  setLink(note, 'notes', 'decks', values.deck || null);
  await saveVault();
  renderAll();
});

document.getElementById('add-event-btn').addEventListener('click', async () => {
  const values = await eventForm(null);
  if (!values) return;
  const ev = { id: uid(), title: values.title.trim(), date: values.date,
               linkedNoteId: null, linkedDeckId: null };
  vault.events.push(ev);
  setLink(ev, 'events', 'notes', values.note || null);
  setLink(ev, 'events', 'decks', values.deck || null);
  await saveVault();
  renderAll();
});

document.getElementById('add-deck-btn').addEventListener('click', async () => {
  const values = await deckForm(null);
  if (!values) return;
  const deck = { id: uid(), name: values.name.trim(), cards: values.cards,
                 linkedNoteId: null, linkedEventId: null };
  vault.decks.push(deck);
  setLink(deck, 'decks', 'notes', values.note || null);
  setLink(deck, 'decks', 'events', values.event || null);
  await saveVault();
  renderAll();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

unlockOrCreateVault().then(renderAll).catch(() => {
  alert('The vault stays locked. Reload the page to try again.');
});
