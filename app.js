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
  if (hasVault) {
    const pw = prompt('Enter your password to unlock:');
    if (pw === null) {
      alert('Cancelled. Reload the page when you are ready to unlock.');
      throw new Error('unlock cancelled');
    }
    try {
      await decryptVault(pw);
      currentPassword = pw;
    } catch (e) {
      alert('Wrong password. Reload the page to try again.');
      throw e;
    }
  } else {
    while (true) {
      const pw = prompt('First time setup — create a password for your vault (at least ' + MIN_PASSWORD + ' characters):');
      if (pw === null) {
        alert('Setup cancelled. No vault was created. Reload the page to start again.');
        throw new Error('setup cancelled');
      }
      if (pw.length < MIN_PASSWORD) {
        alert('That password is too short. Use at least ' + MIN_PASSWORD + ' characters.');
        continue;
      }
      const again = prompt('Type the same password again to confirm:');
      if (again === null) {
        alert('Setup cancelled. No vault was created. Reload the page to start again.');
        throw new Error('setup cancelled');
      }
      if (again !== pw) {
        alert('Those two passwords did not match. Please try again.');
        continue;
      }
      currentPassword = pw;
      await saveVault();
      break;
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

function pickFromList(items, labelFn, promptText) {
  if (items.length === 0) return null;
  const listText = items.map((it, i) => `${i + 1}. ${labelFn(it)}`).join('\n');
  const answer = prompt(`${promptText}\n${listText}\n(Enter a number, or leave blank to skip)`);
  const index = parseInt(answer, 10) - 1;
  if (isNaN(index) || !items[index]) return null;
  return items[index];
}

function pickLink(items, labelFn, promptText, currentId) {
  if (items.length === 0) return currentId;
  const current = items.find((it) => it.id === currentId);
  const listText = items.map((it, i) => `${i + 1}. ${labelFn(it)}`).join('\n');
  const answer = prompt(
    `${promptText}\nCurrently: ${current ? labelFn(current) : 'none'}\n${listText}` +
    `\n(Enter a number, 0 to unlink, or leave blank to keep it as is)`
  );
  if (answer === null || answer.trim() === '') return currentId;
  const index = parseInt(answer, 10) - 1;
  if (index === -1) return null;
  if (isNaN(index) || !items[index]) return currentId;
  return items[index].id;
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

function askDate(current) {
  let suggestion = current === undefined ? '' : current;
  while (true) {
    const answer = prompt('Event date (YYYY-MM-DD, e.g. 2026-08-30):', suggestion);
    if (answer === null) return null;
    if (isValidDate(answer)) return answer.trim();
    alert('"' + answer + '" is not a real date. Please write it as YYYY-MM-DD, e.g. 2026-08-30.');
    suggestion = answer;
  }
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
  const title = prompt('Note title:', note.title);
  if (title === null) return;
  const content = prompt('Note content:', note.content);
  if (content === null) return;

  note.title = title.trim() || note.title;
  note.content = content;
  setLink(note, 'notes', 'events', pickLink(vault.events, (e) => e.title, 'Link to an event?', note.linkedEventId));
  setLink(note, 'notes', 'decks', pickLink(vault.decks, (d) => d.name, 'Link to a flashcard deck?', note.linkedDeckId));
  await saveVault();
  renderAll();
}

async function editEvent(ev) {
  const title = prompt('Event title:', ev.title);
  if (title === null) return;
  const date = askDate(ev.date);
  if (date === null) return;

  ev.title = title.trim() || ev.title;
  ev.date = date;
  setLink(ev, 'events', 'notes', pickLink(vault.notes, (n) => n.title, 'Link to a note?', ev.linkedNoteId));
  setLink(ev, 'events', 'decks', pickLink(vault.decks, (d) => d.name, 'Link to a flashcard deck?', ev.linkedDeckId));
  await saveVault();
  renderAll();
}

async function editDeck(deck) {
  const name = prompt('Deck name:', deck.name);
  if (name === null) return;

  deck.name = name.trim() || deck.name;
  setLink(deck, 'decks', 'notes', pickLink(vault.notes, (n) => n.title, 'Link to a note?', deck.linkedNoteId));
  setLink(deck, 'decks', 'events', pickLink(vault.events, (e) => e.title, 'Link to an event?', deck.linkedEventId));

  const replace = confirm(
    `Replace the ${deck.cards.length} card(s) in this deck?\n` +
    `OK = enter them again from scratch, Cancel = keep them as they are.`
  );
  if (replace) {
    const cards = [];
    while (true) {
      const front = prompt('Card front (question) — leave blank to stop adding cards:');
      if (!front) break;
      const back = prompt('Card back (answer):') || '';
      cards.push({ front, back });
    }
    deck.cards = cards;
    if (reviewState && reviewState.deckId === deck.id) reviewState = null;
  }
  await saveVault();
  renderAll();
}

document.getElementById('add-note-btn').addEventListener('click', async () => {
  const title = prompt('Note title:');
  if (!title) return;
  const content = prompt('Note content:') || '';
  const linkedEvent = pickFromList(vault.events, (e) => e.title, 'Link to an event?');
  const linkedDeck = pickFromList(vault.decks, (d) => d.name, 'Link to a flashcard deck?');
  const note = { id: uid(), title, content, linkedEventId: null, linkedDeckId: null };
  vault.notes.push(note);
  setLink(note, 'notes', 'events', linkedEvent ? linkedEvent.id : null);
  setLink(note, 'notes', 'decks', linkedDeck ? linkedDeck.id : null);
  await saveVault();
  renderAll();
});

document.getElementById('add-event-btn').addEventListener('click', async () => {
  const title = prompt('Event title:');
  if (!title) return;
  const date = askDate();
  if (date === null) return;
  const linkedNote = pickFromList(vault.notes, (n) => n.title, 'Link to a note?');
  const linkedDeck = pickFromList(vault.decks, (d) => d.name, 'Link to a flashcard deck?');
  const ev = { id: uid(), title, date, linkedNoteId: null, linkedDeckId: null };
  vault.events.push(ev);
  setLink(ev, 'events', 'notes', linkedNote ? linkedNote.id : null);
  setLink(ev, 'events', 'decks', linkedDeck ? linkedDeck.id : null);
  await saveVault();
  renderAll();
});

document.getElementById('add-deck-btn').addEventListener('click', async () => {
  const name = prompt('Deck name:');
  if (!name) return;
  const cards = [];
  while (true) {
    const front = prompt('Card front (question) — leave blank to stop adding cards:');
    if (!front) break;
    const back = prompt('Card back (answer):') || '';
    cards.push({ front, back });
  }
  const linkedNote = pickFromList(vault.notes, (n) => n.title, 'Link to a note?');
  const linkedEvent = pickFromList(vault.events, (e) => e.title, 'Link to an event?');
  const deck = { id: uid(), name, cards, linkedNoteId: null, linkedEventId: null };
  vault.decks.push(deck);
  setLink(deck, 'decks', 'notes', linkedNote ? linkedNote.id : null);
  setLink(deck, 'decks', 'events', linkedEvent ? linkedEvent.id : null);
  await saveVault();
  renderAll();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

unlockOrCreateVault().then(renderAll).catch(() => {});
