const navButtons = document.querySelectorAll('.nav-btn');

const sections = [
  { key: 'notes', el: document.getElementById('notes-section') },
  { key: 'calendar', el: document.getElementById('calendar-section') },
  { key: 'flashcards', el: document.getElementById('flashcards-section') },
];

function showSection(key) {
  navButtons.forEach(function (button) {
    button.classList.remove('active');
  });

  const button = document.getElementById('nav-' + key);
  if (button) {
    button.classList.add('active');
  }

  sections.forEach(function (section) {
    if (section.key === key) {
      section.el.classList.remove('hidden');
    } else {
      section.el.classList.add('hidden');
    }
  });
}

navButtons.forEach(function (button) {
  button.addEventListener('click', function () {
    showSection(button.id.replace('nav-', ''));
  });
});

let vault = { notes: [], events: [], decks: [] };

function uid() {
  const letters = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    const position = Math.floor(Math.random() * letters.length);
    id = id + letters[position];
  }
  return id;
}

function listOf(collection) {
  if (collection === 'notes') {
    return vault.notes;
  }
  if (collection === 'events') {
    return vault.events;
  }
  return vault.decks;
}

function findIn(collection, id) {
  if (!id) {
    return null;
  }
  const list = listOf(collection);
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) {
      return list[i];
    }
  }
  return null;
}

function labelOf(item) {
  if (item.title !== undefined) {
    return item.title;
  }
  return item.name;
}

async function deriveKey(password, salt) {
  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);

  const keyMaterial = await crypto.subtle.importKey(
    'raw', passwordBytes, 'PBKDF2', false, ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 600000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let text = '';
  for (let i = 0; i < bytes.length; i++) {
    text = text + String.fromCharCode(bytes[i]);
  }
  return btoa(text);
}

function fromBase64(text) {
  const characters = atob(text);
  const bytes = new Uint8Array(characters.length);
  for (let i = 0; i < characters.length; i++) {
    bytes[i] = characters.charCodeAt(i);
  }
  return bytes;
}

async function encryptVault(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);

  const encoder = new TextEncoder();
  const plainBytes = encoder.encode(JSON.stringify(vault));

  const secret = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, plainBytes);

  localStorage.setItem('vault_data', toBase64(secret));
  localStorage.setItem('vault_salt', toBase64(salt));
  localStorage.setItem('vault_iv', toBase64(iv));
}

async function decryptVault(password) {
  const salt = fromBase64(localStorage.getItem('vault_salt'));
  const iv = fromBase64(localStorage.getItem('vault_iv'));
  const secret = fromBase64(localStorage.getItem('vault_data'));

  const key = await deriveKey(password, salt);
  const plainBytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, secret);

  const decoder = new TextDecoder();
  vault = JSON.parse(decoder.decode(plainBytes));
}

let currentPassword = null;

async function saveVault() {
  await encryptVault(currentPassword);
}

async function unlockOrCreateVault() {
  const hasVault = localStorage.getItem('vault_data') !== null;

  if (!hasVault) {
    let password = null;
    while (password === null) {
      password = await askNewPassword();
    }
    currentPassword = password;
    await saveVault();
    return;
  }

  while (true) {
    const password = await askPassword();
    if (password === null) {
      continue;
    }
    try {
      await decryptVault(password);
      currentPassword = password;
      return;
    } catch (error) {
    }
  }
}

function getLink(item, otherType) {
  if (otherType === 'notes') {
    return item.linkedNoteId;
  }
  if (otherType === 'events') {
    return item.linkedEventId;
  }
  return item.linkedDeckId;
}

function putLink(item, otherType, value) {
  if (otherType === 'notes') {
    item.linkedNoteId = value;
  } else if (otherType === 'events') {
    item.linkedEventId = value;
  } else {
    item.linkedDeckId = value;
  }
}

function unlink(item, type, otherType) {
  const otherId = getLink(item, otherType);
  if (!otherId) {
    return;
  }
  putLink(item, otherType, null);

  const other = findIn(otherType, otherId);
  if (other && getLink(other, type) === item.id) {
    putLink(other, type, null);
  }
}

function setLink(item, type, otherType, otherId) {
  unlink(item, type, otherType);
  if (!otherId) {
    return;
  }
  const other = findIn(otherType, otherId);
  if (!other) {
    return;
  }
  unlink(other, otherType, type);
  putLink(item, otherType, other.id);
  putLink(other, type, item.id);
}

function forEachItem(job) {
  vault.notes.forEach(job);
  vault.events.forEach(job);
  vault.decks.forEach(job);
}

function clearLinksTo(id) {
  forEachItem(function (item) {
    if (item.linkedNoteId === id) {
      item.linkedNoteId = null;
    }
    if (item.linkedEventId === id) {
      item.linkedEventId = null;
    }
    if (item.linkedDeckId === id) {
      item.linkedDeckId = null;
    }
  });
}

function deleteItem(collection, id) {
  const list = listOf(collection);
  let position = -1;
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) {
      position = i;
    }
  }
  if (position !== -1) {
    list.splice(position, 1);
  }
  clearLinksTo(id);
}

const dialog = {
  backdrop: document.getElementById('dialog-backdrop'),
  form: document.getElementById('dialog'),
  title: document.getElementById('dialog-title'),
  fields: document.getElementById('dialog-fields'),
  submit: document.getElementById('dialog-submit'),
  cancel: document.getElementById('dialog-cancel'),
};

let cancelDialog = null;

function applyTypingRules(element) {
  element.setAttribute('spellcheck', 'false');
  element.setAttribute('autocapitalize', 'off');
  element.setAttribute('autocorrect', 'off');
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
    if (spec.options) {
      spec.options.forEach(function (option) {
        const optionElement = document.createElement('option');
        optionElement.value = option.value;
        optionElement.textContent = option.label;
        input.appendChild(optionElement);
      });
    }
  } else {
    input = document.createElement('input');
    if (spec.type) {
      input.type = spec.type;
    } else {
      input.type = 'text';
    }
  }

  input.id = 'f-' + spec.name;
  input.name = spec.name;
  if (spec.value === undefined || spec.value === null) {
    input.value = '';
  } else {
    input.value = spec.value;
  }

  if (spec.type !== 'select') {
    applyTypingRules(input);
  }
  if (spec.autocomplete) {
    input.setAttribute('autocomplete', spec.autocomplete);
  }
  if (spec.required) {
    input.setAttribute('required', '');
  }
  if (spec.placeholder) {
    input.setAttribute('placeholder', spec.placeholder);
  }
  if (spec.type === 'password') {
    input.setAttribute('enterkeyhint', 'go');
  }

  wrap.appendChild(input);
  return {
    wrap: wrap,
    input: input,
    read: function () {
      return input.value;
    },
  };
}

function makeCardsField(spec) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const label = document.createElement('label');
  label.textContent = spec.label;
  wrap.appendChild(label);

  const rows = document.createElement('div');
  wrap.appendChild(rows);

  let data = [];
  if (spec.value) {
    spec.value.forEach(function (card) {
      data.push({ front: card.front, back: card.back });
    });
  }

  const pairs = [];

  function readRows() {
    const result = [];
    pairs.forEach(function (pair) {
      result.push({ front: pair.front.value, back: pair.back.value });
    });
    return result;
  }

  function draw() {
    rows.innerHTML = '';
    pairs.length = 0;
    data.forEach(function (card, index) {
      const row = document.createElement('div');
      row.className = 'card-row';

      const front = document.createElement('input');
      front.type = 'text';
      front.value = card.front;
      front.setAttribute('placeholder', 'Question');
      applyTypingRules(front);

      const back = document.createElement('input');
      back.type = 'text';
      back.value = card.back;
      back.setAttribute('placeholder', 'Answer');
      applyTypingRules(back);

      row.appendChild(front);
      row.appendChild(back);
      row.appendChild(iconButton('close', 'Remove', function () {
        data = readRows();
        data.splice(index, 1);
        draw();
      }, 'remove-card'));

      pairs.push({ front: front, back: back });
      rows.appendChild(row);
    });
  }

  draw();
  wrap.appendChild(iconButton('add', 'Add a card', function () {
    data = readRows();
    data.push({ front: '', back: '' });
    draw();
  }, 'add-card'));

  return {
    wrap: wrap,
    read: function () {
      const kept = [];
      readRows().forEach(function (card) {
        if (card.front.trim() !== '') {
          kept.push(card);
        }
      });
      return kept;
    },
  };
}

function openForm(config) {
  return new Promise(function (resolve) {
    dialog.title.textContent = config.title;
    if (config.submitLabel) {
      dialog.submit.textContent = config.submitLabel;
    } else {
      dialog.submit.textContent = 'Save';
    }

    dialog.fields.innerHTML = '';

    const readers = [];
    let firstInput = null;
    config.fields.forEach(function (spec) {
      let built;
      if (spec.type === 'cards') {
        built = makeCardsField(spec);
      } else {
        built = makeField(spec);
      }
      dialog.fields.appendChild(built.wrap);
      readers.push({ name: spec.name, read: built.read });
      if (!firstInput && built.input) {
        firstInput = built.input;
      }
    });

    function finish(result) {
      dialog.backdrop.classList.remove('open');
      cancelDialog = null;
      dialog.form.onsubmit = null;
      resolve(result);
    }

    cancelDialog = function () {
      finish(null);
    };

    dialog.form.onsubmit = function (event) {
      event.preventDefault();

      const values = {};
      readers.forEach(function (reader) {
        values[reader.name] = reader.read();
      });

      if (config.check && !config.check(values)) {
        return;
      }
      finish(values);
    };

    dialog.backdrop.classList.add('open');
    if (firstInput) {
      firstInput.focus();
    }
  });
}

dialog.cancel.addEventListener('click', function () {
  if (cancelDialog) {
    cancelDialog();
  }
});

document.addEventListener('keydown', function (event) {
  if (event && event.key === 'Escape' && cancelDialog) {
    cancelDialog();
  }
});

async function askPassword() {
  const values = await openForm({
    title: 'Unlock your vault',
    submitLabel: 'Unlock',
    fields: [
      { name: 'pw', label: 'Password', type: 'password',
        autocomplete: 'current-password', required: true },
    ],
  });
  if (!values) {
    return null;
  }
  return values.pw;
}

async function askNewPassword() {
  const values = await openForm({
    title: 'Create your vault password',
    submitLabel: 'Create vault',
    fields: [
      { name: 'pw', label: 'Password', type: 'password',
        autocomplete: 'new-password', required: true },
    ],
  });
  if (!values) {
    return null;
  }
  return values.pw;
}

function linkOptions(collection) {
  const options = [{ value: '', label: '(none)' }];
  listOf(collection).forEach(function (item) {
    options.push({ value: item.id, label: labelOf(item) });
  });
  return options;
}

const ICONS = {
  edit: 'M180-180h44l472-471-44-44-472 471v44Zm-60 60v-128l575-574q8-8 19-12.5t23-4.5q11 0 22 4.5t20 12.5l44 44q9 9 13 20t4 22q0 11-4.5 22.5T823-694L248-120H120Zm659-617-41-41 41 41Zm-105 64-22-22 44 44-22-22Z',
  delete: 'M261-120q-24.75 0-42.37-17.63Q201-155.25 201-180v-570h-41v-60h188v-30h264v30h188v60h-41v570q0 24-18 42t-42 18H261Zm438-630H261v570h438v-570ZM367-266h60v-399h-60v399Zm166 0h60v-399h-60v399ZM261-750v570-570Z',
  school: 'M479-120 189-279v-240L40-600l439-240 441 240v317h-60v-282l-91 46v240L479-120Zm0-308 315-172-315-169-313 169 313 172Zm0 240 230-127v-168L479-360 249-485v170l230 127Zm1-240Zm-1 74Zm0 0Z',
  add: 'M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z',
  close: 'm256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z',
};

const cardEls = {};

function iconButton(iconName, label, onClick, className) {
  const button = document.createElement('button');
  button.innerHTML =
    '<svg class="icon" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true" focusable="false">' +
    '<path d="' + ICONS[iconName] + '"/></svg>';
  button.title = label;
  button.setAttribute('aria-label', label);
  if (className) {
    button.className = className;
  }
  button.addEventListener('click', onClick);
  return button;
}

function textButton(label, onClick, className) {
  const button = document.createElement('button');
  button.textContent = label;
  if (className) {
    button.className = className;
  }
  button.addEventListener('click', onClick);
  return button;
}

function textLine(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) {
    element.className = className;
  }
  return element;
}

function cardShell(item) {
  const div = document.createElement('div');
  div.className = 'card';
  div.setAttribute('data-id', item.id);
  cardEls[item.id] = div;
  return div;
}

function addCardActions(cardElement, buttons) {
  const actions = document.createElement('div');
  actions.className = 'card-actions';
  buttons.forEach(function (button) {
    actions.appendChild(button);
  });
  cardElement.appendChild(actions);
}

function sectionForType(type) {
  if (type === 'notes') {
    return 'notes';
  }
  if (type === 'events') {
    return 'calendar';
  }
  return 'flashcards';
}

function linkRow(prefix, target, targetType) {
  return textButton(prefix + labelOf(target), function () {
    goToItem(targetType, target.id);
  }, 'link-row');
}

function goToItem(type, id) {
  if (reviewState) {
    reviewState = null;
    renderFlashcards();
  }
  showSection(sectionForType(type));
  const card = cardEls[id];
  if (!card) {
    return;
  }
  card.scrollIntoView({ block: 'center' });
  card.classList.add('flash');
  setTimeout(function () {
    card.classList.remove('flash');
  }, 1200);
}

function renderNotes() {
  const list = document.getElementById('notes-list');
  list.innerHTML = '';
  vault.notes.forEach(function (note) {
    const div = cardShell(note);
    div.appendChild(textLine('strong', note.title));
    div.appendChild(textLine('p', note.content));

    const linkedEvent = findIn('events', note.linkedEventId);
    const linkedDeck = findIn('decks', note.linkedDeckId);
    if (linkedEvent) {
      div.appendChild(linkRow('Linked event: ', linkedEvent, 'events'));
    }
    if (linkedDeck) {
      div.appendChild(linkRow('Linked deck: ', linkedDeck, 'decks'));
    }

    addCardActions(div, [
      iconButton('edit', 'Edit', function () {
        editNote(note);
      }),
      iconButton('delete', 'Delete', function () {
        confirmAndDelete('notes', note, note.title);
      }),
    ]);
    list.appendChild(div);
  });
}

function byDate(a, b) {
  if (a.date < b.date) {
    return -1;
  }
  if (a.date > b.date) {
    return 1;
  }
  return 0;
}

function renderCalendar() {
  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = '';

  const inDateOrder = [];
  vault.events.forEach(function (event) {
    inDateOrder.push(event);
  });
  inDateOrder.sort(byDate);

  inDateOrder.forEach(function (event) {
    const div = cardShell(event);
    div.appendChild(textLine('strong', event.title));
    div.appendChild(textLine('p', event.date));

    const linkedNote = findIn('notes', event.linkedNoteId);
    const linkedDeck = findIn('decks', event.linkedDeckId);
    if (linkedNote) {
      div.appendChild(linkRow('Linked note: ', linkedNote, 'notes'));
    }
    if (linkedDeck) {
      div.appendChild(linkRow('Linked deck: ', linkedDeck, 'decks'));
    }

    addCardActions(div, [
      iconButton('edit', 'Edit', function () {
        editEvent(event);
      }),
      iconButton('delete', 'Delete', function () {
        confirmAndDelete('events', event, event.title);
      }),
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

  vault.decks.forEach(function (deck) {
    const div = cardShell(deck);
    div.appendChild(textLine('strong', deck.name));
    div.appendChild(textLine('p', deck.cards.length + ' card(s)'));

    const linkedEvent = findIn('events', deck.linkedEventId);
    const linkedNote = findIn('notes', deck.linkedNoteId);
    if (linkedEvent) {
      div.appendChild(linkRow('Linked event: ', linkedEvent, 'events'));
    }
    if (linkedNote) {
      div.appendChild(linkRow('Linked note: ', linkedNote, 'notes'));
    }

    const actions = [];
    if (deck.cards.length > 0) {
      actions.push(iconButton('school', 'Study', function () {
        startReview(deck);
      }));
    }
    actions.push(iconButton('edit', 'Edit', function () {
      editDeck(deck);
    }));
    actions.push(iconButton('delete', 'Delete', function () {
      confirmAndDelete('decks', deck, deck.name);
    }));
    addCardActions(div, actions);
    list.appendChild(div);
  });
}

function renderAll() {
  renderNotes();
  renderCalendar();
  renderFlashcards();
}

let reviewState = null;

function startReview(deck) {
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
  panel.appendChild(textLine('p',
    'Card ' + (reviewState.index + 1) + ' of ' + deck.cards.length, 'review-count'));
  panel.appendChild(textLine('div', card.front, 'review-face'));

  if (reviewState.revealed) {
    panel.appendChild(textLine('div', card.back, 'review-face review-back'));
  }

  const controls = document.createElement('div');
  controls.className = 'review-controls';
  const isLast = reviewState.index === deck.cards.length - 1;

  if (!reviewState.revealed) {
    controls.appendChild(textButton('Show answer', function () {
      reviewState.revealed = true;
      renderFlashcards();
    }, 'primary'));
  } else {
    let nextLabel = 'Next card';
    if (isLast) {
      nextLabel = 'Finish';
    }
    controls.appendChild(textButton(nextLabel, function () {
      if (isLast) {
        reviewState = null;
      } else {
        reviewState.index = reviewState.index + 1;
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
  if (value.length !== 10) {
    return false;
  }

  const parts = value.split('-');
  if (parts.length !== 3) {
    return false;
  }

  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!year || !month || !day) {
    return false;
  }

  const when = new Date(Date.UTC(year, month - 1, day));
  return when.getUTCFullYear() === year
    && when.getUTCMonth() === month - 1
    && when.getUTCDate() === day;
}

function noteForm(note) {
  let boxTitle = 'New note';
  let title = '';
  let content = '';
  let eventId = '';
  let deckId = '';
  if (note) {
    boxTitle = 'Edit note';
    title = note.title;
    content = note.content;
    if (note.linkedEventId) {
      eventId = note.linkedEventId;
    }
    if (note.linkedDeckId) {
      deckId = note.linkedDeckId;
    }
  }
  return openForm({
    title: boxTitle,
    fields: [
      { name: 'title', label: 'Title', type: 'text', value: title, required: true },
      { name: 'content', label: 'Content', type: 'textarea', value: content },
      { name: 'event', label: 'Linked event', type: 'select',
        value: eventId, options: linkOptions('events') },
      { name: 'deck', label: 'Linked deck', type: 'select',
        value: deckId, options: linkOptions('decks') },
    ],
    check: function (values) {
      return values.title.trim() !== '';
    },
  });
}

function eventForm(event) {
  let boxTitle = 'New event';
  let title = '';
  let date = '';
  let noteId = '';
  let deckId = '';
  if (event) {
    boxTitle = 'Edit event';
    title = event.title;
    date = event.date;
    if (event.linkedNoteId) {
      noteId = event.linkedNoteId;
    }
    if (event.linkedDeckId) {
      deckId = event.linkedDeckId;
    }
  }
  return openForm({
    title: boxTitle,
    fields: [
      { name: 'title', label: 'Title', type: 'text', value: title, required: true },
      { name: 'date', label: 'Date', type: 'date', value: date, required: true },
      { name: 'note', label: 'Linked note', type: 'select',
        value: noteId, options: linkOptions('notes') },
      { name: 'deck', label: 'Linked deck', type: 'select',
        value: deckId, options: linkOptions('decks') },
    ],
    check: function (values) {
      return values.title.trim() !== '' && isValidDate(values.date);
    },
  });
}

function deckForm(deck) {
  let boxTitle = 'New deck';
  let name = '';
  let cards = [{ front: '', back: '' }];
  let noteId = '';
  let eventId = '';
  if (deck) {
    boxTitle = 'Edit deck';
    name = deck.name;
    cards = deck.cards;
    if (deck.linkedNoteId) {
      noteId = deck.linkedNoteId;
    }
    if (deck.linkedEventId) {
      eventId = deck.linkedEventId;
    }
  }
  return openForm({
    title: boxTitle,
    fields: [
      { name: 'name', label: 'Deck name', type: 'text', value: name, required: true },
      { name: 'cards', label: 'Cards', type: 'cards', value: cards },
      { name: 'note', label: 'Linked note', type: 'select',
        value: noteId, options: linkOptions('notes') },
      { name: 'event', label: 'Linked event', type: 'select',
        value: eventId, options: linkOptions('events') },
    ],
    check: function (values) {
      return values.name.trim() !== '';
    },
  });
}

async function confirmAndDelete(collection, item, label) {
  if (!confirm('Delete "' + label + '"?')) {
    return;
  }
  if (reviewState && reviewState.deckId === item.id) {
    reviewState = null;
  }
  deleteItem(collection, item.id);
  await saveVault();
  renderAll();
}

async function editNote(note) {
  const values = await noteForm(note);
  if (!values) {
    return;
  }
  note.title = values.title.trim();
  note.content = values.content;
  setLink(note, 'notes', 'events', values.event);
  setLink(note, 'notes', 'decks', values.deck);
  await saveVault();
  renderAll();
}

async function editEvent(event) {
  const values = await eventForm(event);
  if (!values) {
    return;
  }
  event.title = values.title.trim();
  event.date = values.date;
  setLink(event, 'events', 'notes', values.note);
  setLink(event, 'events', 'decks', values.deck);
  await saveVault();
  renderAll();
}

async function editDeck(deck) {
  const values = await deckForm(deck);
  if (!values) {
    return;
  }
  deck.name = values.name.trim();
  deck.cards = values.cards;
  setLink(deck, 'decks', 'notes', values.note);
  setLink(deck, 'decks', 'events', values.event);
  if (reviewState && reviewState.deckId === deck.id) {
    reviewState = null;
  }
  await saveVault();
  renderAll();
}

document.getElementById('add-note-btn').addEventListener('click', async function () {
  const values = await noteForm(null);
  if (!values) {
    return;
  }
  const note = {
    id: uid(),
    title: values.title.trim(),
    content: values.content,
    linkedEventId: null,
    linkedDeckId: null,
  };
  vault.notes.push(note);
  setLink(note, 'notes', 'events', values.event);
  setLink(note, 'notes', 'decks', values.deck);
  await saveVault();
  renderAll();
});

document.getElementById('add-event-btn').addEventListener('click', async function () {
  const values = await eventForm(null);
  if (!values) {
    return;
  }
  const event = {
    id: uid(),
    title: values.title.trim(),
    date: values.date,
    linkedNoteId: null,
    linkedDeckId: null,
  };
  vault.events.push(event);
  setLink(event, 'events', 'notes', values.note);
  setLink(event, 'events', 'decks', values.deck);
  await saveVault();
  renderAll();
});

document.getElementById('add-deck-btn').addEventListener('click', async function () {
  const values = await deckForm(null);
  if (!values) {
    return;
  }
  const deck = {
    id: uid(),
    name: values.name.trim(),
    cards: values.cards,
    linkedNoteId: null,
    linkedEventId: null,
  };
  vault.decks.push(deck);
  setLink(deck, 'decks', 'notes', values.note);
  setLink(deck, 'decks', 'events', values.event);
  await saveVault();
  renderAll();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

unlockOrCreateVault().then(renderAll);
