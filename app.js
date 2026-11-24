const navButtons = document.querySelectorAll('.nav-btn');
const navBar = document.querySelector('nav');
const pageHeader = document.querySelector('header');
const pageMain = document.querySelector('main');

const sections = [
  { key: 'notes', el: document.getElementById('notes-section') },
  { key: 'calendar', el: document.getElementById('calendar-section') },
  { key: 'flashcards', el: document.getElementById('flashcards-section') },
];

const calmMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const EASE_OUT = 'cubic-bezier(0.2, 0, 0, 1)';
const EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)';
const EASE_MOVE = 'cubic-bezier(0.4, 0, 0.2, 1)';

function motionFrames(frames) {
  if (!calmMotion.matches) {
    return frames;
  }
  const fadesOnly = [];
  frames.forEach(function (frame) {
    if (frame.opacity !== undefined) {
      fadesOnly.push({ opacity: frame.opacity });
    }
  });
  if (fadesOnly.length === 0) {
    return null;
  }
  return fadesOnly;
}

function play(element, frames, duration, easing) {
  if (!element || !element.animate) {
    return null;
  }
  const used = motionFrames(frames);
  if (!used) {
    return null;
  }
  return element.animate(used, { duration: duration, easing: easing });
}

function playOut(element, frames, duration, easing) {
  if (!element || !element.animate) {
    return null;
  }
  const used = motionFrames(frames);
  if (!used) {
    return null;
  }
  return element.animate(used, { duration: duration, easing: easing, fill: 'forwards' });
}

async function whenDone(animation) {
  if (!animation) {
    return;
  }
  try {
    await animation.finished;
  } catch (error) {
  }
}

document.addEventListener('touchstart', function () {
}, { passive: true });

let currentSection = 'notes';

function showSection(key) {
  const changed = key !== currentSection;
  currentSection = key;

  navButtons.forEach(function (button) {
    button.classList.remove('active');
  });

  const button = document.getElementById('nav-' + key);
  if (button) {
    button.classList.add('active');
  }

  sections.forEach(function (section, index) {
    if (section.key === key) {
      section.el.classList.remove('hidden');
      navBar.style.setProperty('--tab', index);
      if (changed) {
        play(section.el, [
          { opacity: 0, transform: 'translateY(4px)' },
          { opacity: 1, transform: 'none' },
        ], 180, EASE_OUT);
      }
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

async function saveAndShow() {
  renderAll();
  await saveVault();
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

  await openForm({
    title: 'Unlock your vault',
    submitLabel: 'Unlock',
    busyLabel: 'Unlocking…',
    errorText: 'Wrong password.',
    lock: true,
    fields: [
      { name: 'pw', label: 'Password', type: 'password',
        autocomplete: 'current-password', required: true },
    ],
    verify: async function (values) {
      try {
        await decryptVault(values.pw);
        currentPassword = values.pw;
        return true;
      } catch (error) {
        return false;
      }
    },
  });
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
  error: document.getElementById('dialog-error'),
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
    play(rows.lastChild, [
      { opacity: 0, transform: 'translateY(-4px)' },
      { opacity: 1, transform: 'none' },
    ], 160, EASE_OUT);
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

let dialogExits = [];
let focusBack = null;
let focusPending = false;

function stopDialogExit() {
  dialogExits.forEach(function (animation) {
    if (animation) {
      animation.cancel();
    }
  });
  dialogExits = [];
  dialog.backdrop.classList.remove('closing');
}

function showDialog(isLock) {
  const wasOpen = dialog.backdrop.classList.contains('open');
  stopDialogExit();
  dialog.backdrop.classList.add('open');
  pageHeader.inert = true;
  pageMain.inert = true;
  if (isLock || wasOpen) {
    return;
  }
  play(dialog.backdrop, [{ opacity: 0 }, { opacity: 1 }], 200, EASE_OUT);
  play(dialog.form, [
    { opacity: 0, transform: 'translateY(8px) scale(0.985)' },
    { opacity: 1, transform: 'none' },
  ], 240, EASE_OUT);
}

async function hideDialog() {
  pageHeader.inert = false;
  pageMain.inert = false;

  dialog.backdrop.classList.add('closing');
  let exits;
  if (dialog.backdrop.classList.contains('lock')) {
    exits = [
      playOut(dialog.backdrop, [{ opacity: 1 }, { opacity: 0 }], 200, EASE_OUT),
    ];
  } else {
    exits = [
      playOut(dialog.backdrop, [{ opacity: 1 }, { opacity: 0 }], 140, EASE_IN),
      playOut(dialog.form, [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: 'translateY(4px)' },
      ], 140, EASE_IN),
    ];
  }
  dialogExits = exits;
  await whenDone(exits[0]);
  if (dialogExits !== exits) {
    return;
  }
  dialog.backdrop.classList.remove('open');
  stopDialogExit();
}

function giveFocusBack() {
  if (!focusPending || !focusBack) {
    return;
  }
  if (focusBack.isConnected) {
    focusBack.focus({ preventScroll: true });
    return;
  }
  const oldCard = focusBack.closest('.card');
  if (!oldCard) {
    return;
  }
  const newCard = cardEls[oldCard.getAttribute('data-id')];
  if (!newCard || !newCard.isConnected) {
    return;
  }
  const buttons = newCard.querySelectorAll('button');
  for (let i = 0; i < buttons.length; i++) {
    if (buttons[i].title === focusBack.title) {
      buttons[i].focus({ preventScroll: true });
      return;
    }
  }
}

function openForm(config) {
  return new Promise(function (resolve) {
    dialog.title.textContent = config.title;
    let submitLabel = 'Save';
    if (config.submitLabel) {
      submitLabel = config.submitLabel;
    }
    dialog.submit.textContent = submitLabel;
    dialog.submit.disabled = false;
    if (config.danger) {
      dialog.submit.className = 'danger';
    } else {
      dialog.submit.className = 'primary';
    }
    if (config.lock) {
      dialog.backdrop.classList.add('lock');
    } else {
      dialog.backdrop.classList.remove('lock');
    }
    dialog.error.textContent = '';

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
      cancelDialog = null;
      dialog.form.onsubmit = null;
      hideDialog();
      focusPending = true;
      giveFocusBack();
      resolve(result);
    }

    if (config.lock) {
      cancelDialog = null;
    } else {
      cancelDialog = function () {
        finish(null);
      };
    }

    let busy = false;
    dialog.form.onsubmit = async function (event) {
      event.preventDefault();
      if (busy) {
        return;
      }

      const values = {};
      readers.forEach(function (reader) {
        values[reader.name] = reader.read();
      });

      if (config.check && !config.check(values)) {
        return;
      }

      if (config.verify) {
        busy = true;
        dialog.submit.disabled = true;
        dialog.submit.textContent = config.busyLabel;
        dialog.error.textContent = '';
        const passed = await config.verify(values);
        busy = false;
        dialog.submit.disabled = false;
        dialog.submit.textContent = submitLabel;
        if (!passed) {
          dialog.error.textContent = config.errorText;
          play(dialog.form, [
            { transform: 'translateX(0)' },
            { transform: 'translateX(-4px)' },
            { transform: 'translateX(4px)' },
            { transform: 'translateX(-2px)' },
            { transform: 'translateX(0)' },
          ], 280, 'ease-in-out');
          if (firstInput) {
            firstInput.focus();
            firstInput.select();
          }
          return;
        }
      }
      finish(values);
    };

    if (!config.lock) {
      focusBack = document.activeElement;
      focusPending = false;
    }

    showDialog(config.lock);
    if (firstInput) {
      firstInput.focus();
    } else {
      dialog.cancel.focus();
    }
  });
}

dialog.form.addEventListener('submit', function (event) {
  event.preventDefault();
});

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

async function askNewPassword() {
  const values = await openForm({
    title: 'Create your vault password',
    submitLabel: 'Create vault',
    lock: true,
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
  notes: 'M319-250h322v-60H319v60Zm0-170h322v-60H319v60ZM220-80q-24 0-42-18t-18-42v-680q0-24 18-42t42-18h361l219 219v521q0 24-18 42t-42 18H220Zm331-554v-186H220v680h520v-494H551ZM220-820v186-186 680-680Z',
  events: 'M180-80q-24 0-42-18t-18-42v-620q0-24 18-42t42-18h65v-60h65v60h340v-60h65v60h65q24 0 42 18t18 42v620q0 24-18 42t-42 18H180Zm0-60h600v-430H180v430Zm0-490h600v-130H180v130Zm0 0v-130 130Zm300 230q-17 0-28.5-11.5T440-440q0-17 11.5-28.5T480-480q17 0 28.5 11.5T520-440q0 17-11.5 28.5T480-400Zm-188.5-11.5Q280-423 280-440t11.5-28.5Q303-480 320-480t28.5 11.5Q360-457 360-440t-11.5 28.5Q337-400 320-400t-28.5-11.5ZM640-400q-17 0-28.5-11.5T600-440q0-17 11.5-28.5T640-480q17 0 28.5 11.5T680-440q0 17-11.5 28.5T640-400ZM480-240q-17 0-28.5-11.5T440-280q0-17 11.5-28.5T480-320q17 0 28.5 11.5T520-280q0 17-11.5 28.5T480-240Zm-188.5-11.5Q280-263 280-280t11.5-28.5Q303-320 320-320t28.5 11.5Q360-297 360-280t-11.5 28.5Q337-240 320-240t-28.5-11.5ZM640-240q-17 0-28.5-11.5T600-280q0-17 11.5-28.5T640-320q17 0 28.5 11.5T680-280q0 17-11.5 28.5T640-240Z',
  decks: 'm165-170-58-420q-3-24 12-43.5t39-22.5l68 478 477-57h65q0 23-14.5 39T716-177l-484 59q-24 3-43.55-12.07Q168.91-145.14 165-170Zm115-126q-24 0-42-18t-18-42v-424q0-24 18-42t42-18h540q24 0 42 18t18 42v424q0 24-18 42t-42 18H280Zm0-60h540v-424H280v424Zm0 0v-424 424Zm-54 178Zm164-430h320v-60H390v60Zm0 140h199v-60H390v60Z',
};

const cardEls = {};

function iconMarkup(iconName) {
  return '<svg class="icon" viewBox="0 -960 960 960" fill="currentColor">' +
    '<path d="' + ICONS[iconName] + '"/></svg>';
}

function iconButton(iconName, label, onClick, className) {
  const button = document.createElement('button');
  button.type = 'button';
  button.innerHTML = iconMarkup(iconName);
  button.title = label;
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
  const button = document.createElement('button');
  button.className = 'link-row';
  button.innerHTML = iconMarkup(targetType);
  button.appendChild(textLine('span', prefix, 'link-prefix'));
  button.appendChild(textLine('span', labelOf(target), 'link-target'));
  button.addEventListener('click', function () {
    goToItem(targetType, target.id);
  });
  return button;
}

let flashTimer = null;

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
  let scrolling = 'auto';
  if (!calmMotion.matches) {
    scrolling = 'smooth';
  }
  card.scrollIntoView({ block: 'center', behavior: scrolling });
  card.classList.remove('flash');
  card.getBoundingClientRect();
  card.classList.add('flash');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(function () {
    card.classList.remove('flash');
  }, 1200);
}

function renderNotes() {
  const list = document.getElementById('notes-list');
  list.innerHTML = '';
  vault.notes.forEach(function (note) {
    const div = cardShell(note);
    div.appendChild(textLine('strong', note.title));
    if (note.content !== '') {
      div.appendChild(textLine('p', note.content, 'note-text'));
    }

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

function dateParts(text) {
  const parts = String(text).split('-');
  const when = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  let weekday = when.toLocaleDateString('en-US', { weekday: 'long' });
  if (when.getFullYear() !== new Date().getFullYear()) {
    weekday = weekday + ' · ' + when.getFullYear();
  }
  return {
    day: String(when.getDate()),
    month: when.toLocaleDateString('en-US', { month: 'short' }),
    weekday: weekday,
  };
}

function dateBlock(parts) {
  const block = document.createElement('div');
  block.className = 'date-block';
  block.appendChild(textLine('span', parts.month, 'date-month'));
  block.appendChild(textLine('span', parts.day, 'date-day'));
  return block;
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
    if (isValidDate(event.date)) {
      const parts = dateParts(event.date);
      div.classList.add('dated');
      div.appendChild(dateBlock(parts));
      div.appendChild(textLine('strong', event.title));
      div.appendChild(textLine('p', parts.weekday, 'meta'));
    } else {
      div.appendChild(textLine('strong', event.title));
      div.appendChild(textLine('p', event.date, 'meta'));
    }

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

function cardCount(count) {
  if (count === 1) {
    return '1 card';
  }
  return count + ' cards';
}

function renderFlashcards() {
  const list = document.getElementById('flashcards-list');
  list.innerHTML = '';

  const motion = reviewMotion;
  reviewMotion = null;

  if (reviewState) {
    renderReview(list, motion);
    return;
  }

  vault.decks.forEach(function (deck) {
    const div = cardShell(deck);
    div.appendChild(textLine('strong', deck.name));
    div.appendChild(textLine('p', cardCount(deck.cards.length), 'meta'));

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

  if (motion === 'end') {
    play(list, [{ opacity: 0 }, { opacity: 1 }], 180, EASE_OUT);
  }
}

let seenIds = null;

function cardTops() {
  const tops = {};
  document.querySelectorAll('.card[data-id]').forEach(function (card) {
    if (card.offsetParent !== null) {
      tops[card.getAttribute('data-id')] = card.getBoundingClientRect().top;
    }
  });
  return tops;
}

function moveCards(before) {
  document.querySelectorAll('.card[data-id]').forEach(function (card) {
    if (card.offsetParent === null) {
      return;
    }
    const id = card.getAttribute('data-id');
    const oldTop = before[id];
    if (oldTop === undefined) {
      if (!seenIds[id]) {
        play(card, [
          { opacity: 0, transform: 'translateY(6px)' },
          { opacity: 1, transform: 'none' },
        ], 180, EASE_OUT);
      }
      return;
    }
    const shift = oldTop - card.getBoundingClientRect().top;
    if (Math.abs(shift) > 1) {
      play(card, [
        { transform: 'translateY(' + shift + 'px)' },
        { transform: 'none' },
      ], 240, EASE_MOVE);
    }
  });
}

function rememberIds() {
  seenIds = {};
  forEachItem(function (item) {
    seenIds[item.id] = true;
  });
}

function renderAll() {
  let before = null;
  if (seenIds) {
    before = cardTops();
  }

  renderNotes();
  renderCalendar();
  renderFlashcards();

  if (before) {
    moveCards(before);
  }
  rememberIds();

  giveFocusBack();
  focusPending = false;
}

let reviewState = null;
let reviewMotion = null;

function startReview(deck) {
  reviewState = { deckId: deck.id, index: 0, revealed: false };
  reviewMotion = 'start';
  showSection('flashcards');
  renderFlashcards();
}

function endReview() {
  reviewState = null;
  reviewMotion = 'end';
  renderFlashcards();
}

function renderReview(list, motion) {
  const deck = findIn('decks', reviewState.deckId);
  if (!deck || deck.cards.length === 0) {
    reviewState = null;
    renderFlashcards();
    return;
  }
  const card = deck.cards[reviewState.index];
  const total = deck.cards.length;

  const panel = document.createElement('div');
  panel.className = 'card review';

  const head = document.createElement('div');
  head.className = 'review-head';
  head.appendChild(textLine('strong', deck.name));
  head.appendChild(textLine('span',
    'Card ' + (reviewState.index + 1) + ' of ' + total, 'review-count'));
  panel.appendChild(head);

  let answered = reviewState.index;
  if (reviewState.revealed) {
    answered = answered + 1;
  }
  const bar = document.createElement('div');
  bar.className = 'review-progress';
  const fill = document.createElement('span');
  fill.style.transform = 'scaleX(' + (answered / total) + ')';
  bar.appendChild(fill);
  panel.appendChild(bar);

  const front = textLine('div', card.front, 'review-face');
  panel.appendChild(front);

  let back = null;
  if (reviewState.revealed) {
    back = textLine('div', card.back, 'review-face review-back');
    panel.appendChild(back);
  }

  const controls = document.createElement('div');
  controls.className = 'review-controls';
  const isLast = reviewState.index === deck.cards.length - 1;

  if (!reviewState.revealed) {
    controls.appendChild(textButton('Show answer', function () {
      reviewState.revealed = true;
      reviewMotion = 'reveal';
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
        reviewMotion = 'end';
      } else {
        reviewState.index = reviewState.index + 1;
        reviewState.revealed = false;
        reviewMotion = 'next';
      }
      renderFlashcards();
    }, 'primary'));
  }

  controls.appendChild(textButton('Done', endReview));
  panel.appendChild(controls);
  list.appendChild(panel);

  if (motion === 'start') {
    play(panel, [
      { opacity: 0, transform: 'translateY(6px)' },
      { opacity: 1, transform: 'none' },
    ], 180, EASE_OUT);
  }
  if (motion === 'reveal') {
    play(back, [
      { opacity: 0, transform: 'translateY(-4px)' },
      { opacity: 1, transform: 'none' },
    ], 180, EASE_OUT);
    play(fill, [
      { transform: 'scaleX(' + ((answered - 1) / total) + ')' },
      { transform: 'scaleX(' + (answered / total) + ')' },
    ], 240, EASE_MOVE);
  }
  if (motion === 'next') {
    play(front, [
      { opacity: 0, transform: 'translateX(12px)' },
      { opacity: 1, transform: 'none' },
    ], 200, EASE_OUT);
  }
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

async function askToDelete(label) {
  const values = await openForm({
    title: 'Delete "' + label + '"?',
    submitLabel: 'Delete',
    danger: true,
    fields: [],
  });
  return values !== null;
}

async function confirmAndDelete(collection, item, label) {
  const sure = await askToDelete(label);
  if (!sure) {
    return;
  }
  if (reviewState && reviewState.deckId === item.id) {
    reviewState = null;
  }
  await whenDone(playOut(cardEls[item.id], [
    { opacity: 1, transform: 'none' },
    { opacity: 0, transform: 'scale(0.98)' },
  ], 140, EASE_IN));
  deleteItem(collection, item.id);
  await saveAndShow();
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
  await saveAndShow();
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
  await saveAndShow();
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
  await saveAndShow();
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
  await saveAndShow();
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
  await saveAndShow();
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
  await saveAndShow();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

unlockOrCreateVault().then(renderAll);
