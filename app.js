const navButtons = document.querySelectorAll('.nav-btn');
const sections = {
  notes: document.getElementById('notes-section'),
  calendar: document.getElementById('calendar-section'),
  flashcards: document.getElementById('flashcards-section'),
};

navButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    navButtons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');

    Object.values(sections).forEach((sec) => sec.classList.add('hidden'));
    const key = btn.id.replace('nav-', '');
    sections[key].classList.remove('hidden');
  });
});

let vault = { notes: [], events: [], decks: [] };

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 250000,
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
    try {
      await decryptVault(pw);
      currentPassword = pw;
    } catch (e) {
      alert('Wrong password. Reload the page to try again.');
      throw e;
    }
  } else {
    const pw = prompt('First time setup — create a password for your vault:');
    currentPassword = pw;
    await saveVault();
  }
}

function renderAll() {
  renderNotes();
  renderCalendar();
  renderFlashcards();
}

const ICONS = {
  edit: 'M180-180h44l472-471-44-44-472 471v44Zm-60 60v-128l575-574q8-8 19-12.5t23-4.5q11 0 22 4.5t20 12.5l44 44q9 9 13 20t4 22q0 11-4.5 22.5T823-694L248-120H120Zm659-617-41-41 41 41Zm-105 64-22-22 44 44-22-22Z',
  delete: 'M261-120q-24.75 0-42.37-17.63Q201-155.25 201-180v-570h-41v-60h188v-30h264v30h188v60h-41v570q0 24-18 42t-42 18H261Zm438-630H261v570h438v-570ZM367-266h60v-399h-60v399Zm166 0h60v-399h-60v399ZM261-750v570-570Z',
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

function addCardActions(cardEl, onEdit, onDelete) {
  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const editBtn = iconButton('edit', 'Edit', onEdit);
  const deleteBtn = iconButton('delete', 'Delete', onDelete);

  actions.append(editBtn, deleteBtn);
  cardEl.appendChild(actions);
}

function renderNotes() {
  const list = document.getElementById('notes-list');
  list.innerHTML = '';
  vault.notes.forEach((note) => {
    const div = document.createElement('div');
    div.className = 'card';
    const linkedEvent = vault.events.find((e) => e.id === note.linkedEventId);
    const linkedDeck = vault.decks.find((d) => d.id === note.linkedDeckId);
    div.innerHTML = `
      <strong>${note.title}</strong>
      <p>${note.content}</p>
      ${linkedEvent ? `<div>Linked event: ${linkedEvent.title}</div>` : ''}
      ${linkedDeck ? `<div>Linked deck: ${linkedDeck.name}</div>` : ''}
    `;
    addCardActions(
      div,
      () => editNote(note),
      () => confirmAndDelete('notes', note, note.title)
    );
    list.appendChild(div);
  });
}

function renderCalendar() {
  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = '';
  vault.events.forEach((ev) => {
    const div = document.createElement('div');
    div.className = 'card';
    const linkedNote = vault.notes.find((n) => n.id === ev.linkedNoteId);
    const linkedDeck = vault.decks.find((d) => d.id === ev.linkedDeckId);
    div.innerHTML = `
      <strong>${ev.title}</strong>
      <p>${ev.date}</p>
      ${linkedNote ? `<div>Linked note: ${linkedNote.title}</div>` : ''}
      ${linkedDeck ? `<div>Linked deck: ${linkedDeck.name}</div>` : ''}
    `;
    addCardActions(
      div,
      () => editEvent(ev),
      () => confirmAndDelete('events', ev, ev.title)
    );
    grid.appendChild(div);
  });
}

function renderFlashcards() {
  const list = document.getElementById('flashcards-list');
  list.innerHTML = '';
  vault.decks.forEach((deck) => {
    const div = document.createElement('div');
    div.className = 'card';
    const linkedEvent = vault.events.find((e) => e.id === deck.linkedEventId);
    const linkedNote = vault.notes.find((n) => n.id === deck.linkedNoteId);
    div.innerHTML = `
      <strong>${deck.name}</strong>
      <p>${deck.cards.length} card(s)</p>
      ${linkedEvent ? `<div>Linked event: ${linkedEvent.title}</div>` : ''}
      ${linkedNote ? `<div>Linked note: ${linkedNote.title}</div>` : ''}
    `;
    addCardActions(
      div,
      () => editDeck(deck),
      () => confirmAndDelete('decks', deck, deck.name)
    );
    list.appendChild(div);
  });
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
  note.linkedEventId = pickLink(vault.events, (e) => e.title, 'Link to an event?', note.linkedEventId);
  note.linkedDeckId = pickLink(vault.decks, (d) => d.name, 'Link to a flashcard deck?', note.linkedDeckId);
  await saveVault();
  renderAll();
}

async function editEvent(ev) {
  const title = prompt('Event title:', ev.title);
  if (title === null) return;
  const date = prompt('Event date (e.g. 2026-08-30):', ev.date);
  if (date === null) return;

  ev.title = title.trim() || ev.title;
  ev.date = date;
  ev.linkedNoteId = pickLink(vault.notes, (n) => n.title, 'Link to a note?', ev.linkedNoteId);
  ev.linkedDeckId = pickLink(vault.decks, (d) => d.name, 'Link to a flashcard deck?', ev.linkedDeckId);
  await saveVault();
  renderAll();
}

async function editDeck(deck) {
  const name = prompt('Deck name:', deck.name);
  if (name === null) return;

  deck.name = name.trim() || deck.name;
  deck.linkedNoteId = pickLink(vault.notes, (n) => n.title, 'Link to a note?', deck.linkedNoteId);
  deck.linkedEventId = pickLink(vault.events, (e) => e.title, 'Link to an event?', deck.linkedEventId);

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
  vault.notes.push({
    id: uid(), title, content,
    linkedEventId: linkedEvent ? linkedEvent.id : null,
    linkedDeckId: linkedDeck ? linkedDeck.id : null,
  });
  await saveVault();
  renderAll();
});

document.getElementById('add-event-btn').addEventListener('click', async () => {
  const title = prompt('Event title:');
  if (!title) return;
  const date = prompt('Event date (e.g. 2026-08-30):') || '';
  const linkedNote = pickFromList(vault.notes, (n) => n.title, 'Link to a note?');
  const linkedDeck = pickFromList(vault.decks, (d) => d.name, 'Link to a flashcard deck?');
  vault.events.push({
    id: uid(), title, date,
    linkedNoteId: linkedNote ? linkedNote.id : null,
    linkedDeckId: linkedDeck ? linkedDeck.id : null,
  });
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
  vault.decks.push({
    id: uid(), name, cards,
    linkedNoteId: linkedNote ? linkedNote.id : null,
    linkedEventId: linkedEvent ? linkedEvent.id : null,
  });
  await saveVault();
  renderAll();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

unlockOrCreateVault().then(renderAll);
