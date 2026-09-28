/* ==========================================================================
   SPLIT — Smart Expense Splitter
   Vanilla JS. No dependencies.

   Money is kept in paise (integers) for every calculation so that shares and
   settlements always add back up to the exact total. Rupees only appear at
   the edges: reading the amount input, and formatting for display.

   Sections: STATE · UTILITIES · STORAGE · PARTICIPANTS · EXPENSES ·
             CALCULATIONS · RENDERING · UI HELPERS · EVENT HANDLERS · INIT
   ========================================================================== */

(function () {
  'use strict';

  /* ====================================================== STATE */

  var STORAGE_KEY = 'split-expense-state';
  var THEME_KEY = 'split-theme';
  var MAX_AMOUNT = 100000000; /* ₹10,00,00,000 — a sane upper bound */

  var state = {
    participants: [], // { id, name }
    expenses: []      // { id, description, amount, payerId, participantIds, createdAt }
  };

  var editingExpenseId = null;   // id of the expense currently open in the form
  var highlightExpenseId = null; // id to animate on the next render
  var selectedIds = [];          // participant ids ticked in the expense form

  /* ====================================================== DOM REFERENCES */

  var $ = function (id) { return document.getElementById(id); };

  var dom = {
    themeToggle: $('theme-toggle'),
    themeLabel: $('theme-toggle-label'),

    statTotal: $('stat-total'),
    statPeople: $('stat-people'),
    statExpenses: $('stat-expenses'),

    participantForm: $('participant-form'),
    participantName: $('participant-name'),
    participantError: $('participant-error'),
    peopleRegion: $('people-region'),
    peopleCounter: $('people-counter'),

    expenseForm: $('expense-form'),
    expenseFieldset: $('expense-fieldset'),
    description: $('expense-description'),
    descriptionError: $('description-error'),
    amount: $('expense-amount'),
    amountError: $('amount-error'),
    payer: $('expense-payer'),
    payerError: $('payer-error'),
    checklist: $('participant-checklist'),
    participantsError: $('participants-error'),
    splitSummary: $('split-summary'),
    splitNote: $('split-note'),
    expenseSubmit: $('expense-submit'),
    expenseSubmitLabel: $('expense-submit-label'),
    expenseFormTitle: $('expense-form-title'),
    cancelEdit: $('cancel-edit'),
    selectAll: $('select-all'),
    selectNone: $('select-none'),

    expenseRegion: $('expense-region'),
    historyCounter: $('history-counter'),
    balancesRegion: $('balances-region'),
    settlementRegion: $('settlement-region'),
    settlementCounter: $('settlement-counter'),

    demoBtn: $('demo-btn'),
    resetBtn: $('reset-btn'),

    modal: $('confirm-modal'),
    modalTitle: $('confirm-title'),
    modalMessage: $('confirm-message'),
    modalCancel: $('confirm-cancel'),
    modalAccept: $('confirm-accept'),

    toast: $('toast')
  };

  /* ====================================================== UTILITIES */

  var currency = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  /** Format a rupee value: 1250 -> "₹1,250.00" */
  function formatCurrency(value) {
    var n = Number(value);
    if (!isFinite(n)) { n = 0; }
    return currency.format(n);
  }

  /** Format an integer paise value. */
  function formatPaise(paise) {
    return formatCurrency(paise / 100);
  }

  /** Rupees -> integer paise (kills float dust such as 0.1 + 0.2). */
  function toPaise(rupees) {
    return Math.round(Number(rupees) * 100);
  }

  function generateId(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      switch (char) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        default: return '&#39;';
      }
    });
  }
  var esc = escapeHTML;

  /** Collapse runs of whitespace and trim, so "  Arjun  " === "Arjun". */
  function normalizeText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function pluralize(count, singular, plural) {
    return count === 1 ? singular : plural;
  }

  /** Ledger-style counts: 1 -> "01". */
  function pad2(value) {
    return value < 10 ? '0' + value : String(value);
  }

  function findParticipant(id) {
    for (var i = 0; i < state.participants.length; i++) {
      if (state.participants[i].id === id) { return state.participants[i]; }
    }
    return null;
  }

  function participantName(id) {
    var person = findParticipant(id);
    return person ? person.name : 'Unknown';
  }

  /* ====================================================== STORAGE */

  /**
   * Rebuild a trusted state object out of whatever was in localStorage.
   * Anything malformed is dropped rather than trusted.
   */
  function sanitizeState(raw) {
    if (!raw || typeof raw !== 'object') { throw new Error('State is not an object'); }

    var participants = [];
    var seenIds = {};
    var seenNames = {};

    (Array.isArray(raw.participants) ? raw.participants : []).forEach(function (entry) {
      if (!entry || typeof entry !== 'object') { return; }
      var id = typeof entry.id === 'string' ? entry.id : '';
      var name = normalizeText(entry.name).slice(0, 40);
      if (!id || !name) { return; }
      if (seenIds[id] || seenNames[name.toLowerCase()]) { return; }
      seenIds[id] = true;
      seenNames[name.toLowerCase()] = true;
      participants.push({ id: id, name: name });
    });

    var expenses = [];
    (Array.isArray(raw.expenses) ? raw.expenses : []).forEach(function (entry) {
      if (!entry || typeof entry !== 'object') { return; }

      var id = typeof entry.id === 'string' ? entry.id : '';
      var description = normalizeText(entry.description).slice(0, 60);
      var amount = Number(entry.amount);
      var payerId = typeof entry.payerId === 'string' ? entry.payerId : '';

      var ids = Array.isArray(entry.participantIds) ? entry.participantIds : [];
      var unique = [];
      ids.forEach(function (pid) {
        if (typeof pid === 'string' && seenIds[pid] && unique.indexOf(pid) === -1) {
          unique.push(pid);
        }
      });

      if (!id || !description) { return; }
      if (!isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) { return; }
      if (!seenIds[payerId]) { return; }
      if (!unique.length) { return; }

      var createdAt = Number(entry.createdAt);
      expenses.push({
        id: id,
        description: description,
        amount: Math.round(amount * 100) / 100,
        payerId: payerId,
        participantIds: unique,
        createdAt: isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now()
      });
    });

    return { participants: participants, expenses: expenses };
  }

  /** Returns true on a clean load, false when stored data had to be discarded. */
  function loadState() {
    var raw;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      return true; // storage unavailable (private mode) — run in memory
    }
    if (!raw) { return true; }

    try {
      var clean = sanitizeState(JSON.parse(raw));
      state.participants = clean.participants;
      state.expenses = clean.expenses;
      return true;
    } catch (err) {
      state.participants = [];
      state.expenses = [];
      try { window.localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
      return false;
    }
  }

  function saveState() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      showToast('Could not save to this browser. Your data will be lost on refresh.', 'error');
    }
  }

  /* ====================================================== PARTICIPANTS */

  function addParticipant(rawName) {
    var name = normalizeText(rawName);

    if (!name) {
      return { ok: false, message: 'Name is required.' };
    }
    if (name.length > 40) {
      return { ok: false, message: 'Keep names under 40 characters.' };
    }
    var duplicate = state.participants.filter(function (person) {
      return person.name.toLowerCase() === name.toLowerCase();
    })[0];
    if (duplicate) {
      return { ok: false, message: duplicate.name + ' is already in this group.' };
    }

    var person = { id: generateId('p'), name: name };
    state.participants.push(person);
    selectedIds.push(person.id); // newly added people join the next split by default

    saveState();
    render();
    return { ok: true, person: person };
  }

  function removeParticipant(id) {
    var person = findParticipant(id);
    if (!person) { return; }

    var isUsed = state.expenses.some(function (expense) {
      return expense.payerId === id || expense.participantIds.indexOf(id) !== -1;
    });

    if (isUsed) {
      showToast('This person is part of an existing expense. Delete those expenses first.', 'error');
      return;
    }

    confirmAction({
      title: 'Remove ' + person.name + '?',
      message: 'They are not part of any expense, so nothing else will change.',
      confirmLabel: 'Remove'
    }).then(function (confirmed) {
      if (!confirmed) { return; }

      state.participants = state.participants.filter(function (entry) {
        return entry.id !== id;
      });
      selectedIds = selectedIds.filter(function (pid) { return pid !== id; });

      if (editingExpenseId) { exitEditMode(); }

      saveState();
      render();
      showToast(person.name + ' was removed.');
    });
  }

  /* ====================================================== EXPENSES */

  /** Shared validation for add + update. Returns { ok, errors, value }. */
  function validateExpenseInput(input) {
    var errors = {};

    var description = normalizeText(input.description);
    if (!description) {
      errors.description = 'Description is required.';
    } else if (description.length > 60) {
      errors.description = 'Keep the description under 60 characters.';
    }

    var amount = Number(input.amount);
    if (input.amount === '' || input.amount == null) {
      errors.amount = 'Amount is required.';
    } else if (!isFinite(amount)) {
      errors.amount = 'Enter a valid number.';
    } else if (amount <= 0) {
      errors.amount = 'Amount must be greater than \u20b90.';
    } else if (amount > MAX_AMOUNT) {
      errors.amount = 'That amount is too large.';
    }

    var payerId = input.payerId;
    if (!payerId) {
      errors.payer = 'Select who paid.';
    } else if (!findParticipant(payerId)) {
      errors.payer = 'That person is no longer in the group.';
    }

    var ids = (input.participantIds || []).filter(function (id) {
      return !!findParticipant(id);
    });
    if (!ids.length) {
      errors.participants = 'Select at least one person.';
    }

    var hasErrors = Object.keys(errors).length > 0;
    if (hasErrors) { return { ok: false, errors: errors }; }

    return {
      ok: true,
      errors: {},
      value: {
        description: description,
        amount: Math.round(amount * 100) / 100,
        payerId: payerId,
        participantIds: ids
      }
    };
  }

  function addExpense(value) {
    var expense = {
      id: generateId('e'),
      description: value.description,
      amount: value.amount,
      payerId: value.payerId,
      participantIds: value.participantIds.slice(),
      createdAt: Date.now()
    };
    state.expenses.push(expense);
    highlightExpenseId = expense.id;
    saveState();
    return expense;
  }

  function updateExpense(id, value) {
    var expense = null;
    for (var i = 0; i < state.expenses.length; i++) {
      if (state.expenses[i].id === id) { expense = state.expenses[i]; break; }
    }
    if (!expense) { return null; }

    expense.description = value.description;
    expense.amount = value.amount;
    expense.payerId = value.payerId;
    expense.participantIds = value.participantIds.slice();

    highlightExpenseId = expense.id;
    saveState();
    return expense;
  }

  function deleteExpense(id) {
    var expense = state.expenses.filter(function (entry) { return entry.id === id; })[0];
    if (!expense) { return; }

    confirmAction({
      title: 'Delete this expense?',
      message: '"' + expense.description + '" (' + formatCurrency(expense.amount) +
               ') will be removed and every balance recalculated.',
      confirmLabel: 'Delete'
    }).then(function (confirmed) {
      if (!confirmed) { return; }

      state.expenses = state.expenses.filter(function (entry) { return entry.id !== id; });
      if (editingExpenseId === id) { exitEditMode(); }

      saveState();
      render();
      showToast('Expense deleted.');
    });
  }

  /* ====================================================== CALCULATIONS */

  /**
   * Split one expense equally, in paise, so the parts always sum to the total.
   * A leftover paisa (₹10 across 3 people) goes to the earliest participants.
   */
  function shareBreakdown(expense) {
    var total = toPaise(expense.amount);
    var count = expense.participantIds.length;
    var base = Math.floor(total / count);
    var remainder = total - base * count;

    var shares = {};
    expense.participantIds.forEach(function (id, index) {
      shares[id] = base + (index < remainder ? 1 : 0);
    });

    return { shares: shares, base: base, remainder: remainder, total: total, count: count };
  }

  function calculateTotals() {
    var totalPaise = state.expenses.reduce(function (sum, expense) {
      return sum + toPaise(expense.amount);
    }, 0);

    return {
      totalPaise: totalPaise,
      peopleCount: state.participants.length,
      expenseCount: state.expenses.length
    };
  }

  /** One row per participant: { id, name, paid, share, net } — all in paise. */
  function calculateBalances() {
    var rows = state.participants.map(function (person) {
      return { id: person.id, name: person.name, paid: 0, share: 0, net: 0 };
    });

    var byId = {};
    rows.forEach(function (row) { byId[row.id] = row; });

    state.expenses.forEach(function (expense) {
      if (byId[expense.payerId]) {
        byId[expense.payerId].paid += toPaise(expense.amount);
      }
      var breakdown = shareBreakdown(expense);
      Object.keys(breakdown.shares).forEach(function (id) {
        if (byId[id]) { byId[id].share += breakdown.shares[id]; }
      });
    });

    rows.forEach(function (row) { row.net = row.paid - row.share; });
    return rows;
  }

  /**
   * Greedy debtor/creditor matching: repeatedly settle the largest debt against
   * the largest credit. Working in integers means it terminates exactly, and it
   * needs at most (people - 1) transfers.
   */
  function calculateSettlements(balances) {
    var creditors = balances
      .filter(function (row) { return row.net > 0; })
      .map(function (row) { return { name: row.name, amount: row.net }; })
      .sort(function (a, b) { return b.amount - a.amount; });

    var debtors = balances
      .filter(function (row) { return row.net < 0; })
      .map(function (row) { return { name: row.name, amount: -row.net }; })
      .sort(function (a, b) { return b.amount - a.amount; });

    var transactions = [];
    var d = 0;
    var c = 0;

    while (d < debtors.length && c < creditors.length) {
      var amount = Math.min(debtors[d].amount, creditors[c].amount);

      if (amount > 0) {
        transactions.push({ from: debtors[d].name, to: creditors[c].name, amount: amount });
      }

      debtors[d].amount -= amount;
      creditors[c].amount -= amount;

      if (debtors[d].amount === 0) { d++; }
      if (creditors[c].amount === 0) { c++; }
    }

    return transactions;
  }

  /* ====================================================== RENDERING */

  function render() {
    renderSummary();
    renderParticipants();
    renderExpenseForm();
    renderExpenses();

    var balances = calculateBalances();
    renderBalances(balances);
    renderSettlements(calculateSettlements(balances));
  }

  function renderSummary() {
    var totals = calculateTotals();
    dom.statTotal.textContent = formatPaise(totals.totalPaise);
    dom.statPeople.textContent = pad2(totals.peopleCount);
    dom.statExpenses.textContent = pad2(totals.expenseCount);
    dom.peopleCounter.textContent = pad2(totals.peopleCount);
    dom.historyCounter.textContent = pad2(totals.expenseCount);
  }

  function emptyState(title, text) {
    return '<div class="empty"><p class="empty__title">' + esc(title) +
           '</p><p class="empty__text">' + esc(text) + '</p></div>';
  }

  function renderParticipants() {
    if (!state.participants.length) {
      dom.peopleRegion.innerHTML = emptyState(
        'Start your group',
        'Add everyone who is sharing expenses.'
      );
      return;
    }

    var byId = {};
    calculateBalances().forEach(function (row) { byId[row.id] = row; });

    var html = state.participants.map(function (person, index) {
      var net = byId[person.id] ? byId[person.id].net : 0;
      var netClass = net > 0 ? ' prow__net--pos' : (net < 0 ? ' prow__net--neg' : '');
      var netText = net > 0 ? '+' + formatPaise(net)
                  : net < 0 ? '\u2212' + formatPaise(-net)
                  : formatPaise(0);

      return '' +
        '<li class="prow">' +
          '<span class="prow__idx" aria-hidden="true">' + pad2(index + 1) + '</span>' +
          '<span class="prow__name">' + esc(person.name) + '</span>' +
          '<span class="prow__net' + netClass + '">' + netText + '</span>' +
          '<button class="xbtn" type="button" data-action="remove-person" ' +
            'data-id="' + esc(person.id) + '" aria-label="Remove ' + esc(person.name) + '">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
              '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" ' +
              'stroke-width="2.4" stroke-linecap="round"/>' +
            '</svg>' +
          '</button>' +
        '</li>';
    }).join('');

    dom.peopleRegion.innerHTML = '<ul class="rows">' + html + '</ul>';
  }

  /** Rebuilds the payer dropdown and the split picker from current people. */
  function renderExpenseForm() {
    var hasPeople = state.participants.length > 0;

    dom.expenseFieldset.disabled = !hasPeople;

    // Keep only ids that still exist.
    selectedIds = selectedIds.filter(function (id) { return !!findParticipant(id); });

    // --- payer dropdown (preserve the current choice)
    var currentPayer = dom.payer.value;
    dom.payer.innerHTML = '<option value="">Select a person</option>' +
      state.participants.map(function (person) {
        return '<option value="' + esc(person.id) + '">' + esc(person.name) + '</option>';
      }).join('');
    if (currentPayer && findParticipant(currentPayer)) {
      dom.payer.value = currentPayer;
    }

    if (!hasPeople) {
      dom.checklist.innerHTML = '<p class="picker__empty">Add someone above first.</p>';
      dom.splitSummary.textContent = '';
      dom.splitNote.hidden = true;
      return;
    }

    // --- split picker; the payer carries a marker so the two fields read as one idea
    var payerId = dom.payer.value;
    dom.checklist.innerHTML = state.participants.map(function (person) {
      var on = selectedIds.indexOf(person.id) !== -1;
      return '' +
        '<label class="pick' + (on ? ' is-on' : '') + '">' +
          '<input type="checkbox" value="' + esc(person.id) + '"' + (on ? ' checked' : '') + ' />' +
          '<span class="pick__name">' + esc(person.name) + '</span>' +
          (person.id === payerId ? '<span class="pick__tag">Paid</span>' : '') +
        '</label>';
    }).join('');

    renderSplitMeta();
  }

  /**
   * The running "2 people selected · ₹425.00 each" line, plus the note that
   * makes a payer-excluded split an intentional choice rather than a surprise.
   */
  function renderSplitMeta() {
    var count = selectedIds.length;
    var amount = Number(dom.amount.value);
    var payerId = dom.payer.value;

    if (!count) {
      dom.splitSummary.textContent = 'No one selected yet.';
    } else if (!isFinite(amount) || amount <= 0) {
      dom.splitSummary.textContent = count + ' ' + pluralize(count, 'person', 'people') + ' selected';
    } else {
      var total = toPaise(amount);
      var base = Math.floor(total / count);
      var each = (total - base * count)
        ? formatPaise(base) + '\u2013' + formatPaise(base + 1)
        : formatPaise(base);
      dom.splitSummary.textContent = count + ' ' + pluralize(count, 'person', 'people') +
        ' selected \u00b7 ' + each + ' each';
    }

    var payerExcluded = !!payerId && count > 0 && selectedIds.indexOf(payerId) === -1;
    dom.splitNote.hidden = !payerExcluded;
    if (payerExcluded) {
      dom.splitNote.textContent = 'Payer isn\u2019t included in the split \u2014 ' +
        'they\u2019re covering this expense for the selected people.';
    }
  }

  function renderExpenses() {
    if (!state.expenses.length) {
      dom.expenseRegion.innerHTML = emptyState(
        'No expenses yet',
        'Add your first expense to start splitting.'
      );
      return;
    }

    var ordered = state.expenses.slice().sort(function (a, b) {
      return b.createdAt - a.createdAt;
    });

    var html = ordered.map(function (expense) {
      var breakdown = shareBreakdown(expense);
      var each = breakdown.remainder
        ? formatPaise(breakdown.base) + '\u2013' + formatPaise(breakdown.base + 1)
        : formatPaise(breakdown.base);

      var names = expense.participantIds.map(function (id) {
        return participantName(id);
      }).join(', ');
      var payerShares = expense.participantIds.indexOf(expense.payerId) !== -1;

      var classes = 'entry';
      if (expense.id === highlightExpenseId) { classes += ' is-new'; }
      if (expense.id === editingExpenseId) { classes += ' is-editing'; }

      return '' +
        '<li class="' + classes + '" data-id="' + esc(expense.id) + '">' +
          '<div class="entry__main">' +
            '<h3 class="entry__title">' + esc(expense.description) + '</h3>' +
            '<p class="entry__meta">Paid by <strong>' + esc(participantName(expense.payerId)) +
              '</strong> \u00b7 ' + breakdown.count + ' ' +
              pluralize(breakdown.count, 'person', 'people') +
              ' \u00b7 ' + each + ' each</p>' +
            '<p class="entry__who">Split between ' + esc(names) +
              (payerShares ? '' : ' \u2014 payer not included') + '</p>' +
          '</div>' +
          '<div class="entry__aside">' +
            '<p class="entry__amount">' + formatCurrency(expense.amount) + '</p>' +
            '<p class="entry__actions">' +
              '<button class="tbtn" type="button" data-action="edit" data-id="' + esc(expense.id) + '" ' +
                'aria-label="Edit expense ' + esc(expense.description) + '">Edit</button>' +
              '<button class="tbtn tbtn--warn" type="button" data-action="delete" data-id="' + esc(expense.id) + '" ' +
                'aria-label="Delete expense ' + esc(expense.description) + '">Delete</button>' +
            '</p>' +
          '</div>' +
        '</li>';
    }).join('');

    dom.expenseRegion.innerHTML = '<ul class="rows">' + html + '</ul>';

    if (highlightExpenseId) {
      window.setTimeout(function () { highlightExpenseId = null; }, 500);
    }
  }

  function renderBalances(balances) {
    if (!balances.length) {
      dom.balancesRegion.innerHTML = emptyState(
        'Nothing to balance yet',
        'Add people and expenses to see who owes what.'
      );
      return;
    }

    var ordered = balances.slice().sort(function (a, b) { return b.net - a.net; });

    var html = ordered.map(function (row) {
      var label = 'Settled';
      var amountClass = '';
      var amountText = formatPaise(0);

      if (row.net > 0) {
        label = 'Gets back';
        amountClass = ' brow__amt--pos';
        amountText = '+' + formatPaise(row.net);
      } else if (row.net < 0) {
        label = 'Owes';
        amountClass = ' brow__amt--neg';
        amountText = '\u2212' + formatPaise(-row.net);
      }

      return '' +
        '<li class="brow">' +
          '<span class="brow__who">' +
            '<span class="brow__name">' + esc(row.name) + '</span>' +
            '<span class="brow__sub">Paid ' + formatPaise(row.paid) +
              ' \u00b7 Share ' + formatPaise(row.share) + '</span>' +
          '</span>' +
          '<span class="brow__val">' +
            '<span class="brow__state">' + label + '</span>' +
            '<span class="brow__amt' + amountClass + '">' + amountText + '</span>' +
          '</span>' +
        '</li>';
    }).join('');

    dom.balancesRegion.innerHTML = '<ul class="rows">' + html + '</ul>';
  }

  function renderSettlements(transactions) {
    dom.settlementCounter.textContent = transactions.length
      ? transactions.length + ' ' + pluralize(transactions.length, 'transfer', 'transfers')
      : '';

    if (!transactions.length) {
      dom.settlementRegion.innerHTML = state.expenses.length
        ? emptyState('Everyone is settled.', 'No transfers needed \u2014 every balance is zero.')
        : emptyState('Nothing to settle yet', 'Record an expense and the plan will appear here.');
      return;
    }

    var html = transactions.map(function (tx) {
      return '' +
        '<li class="srow">' +
          '<span class="srow__name">' + esc(tx.from) + '</span>' +
          '<span class="srow__arrow" aria-hidden="true">\u2192</span>' +
          '<span class="sr-only">pays</span>' +
          '<span class="srow__name">' + esc(tx.to) + '</span>' +
          '<span class="srow__amt">' + formatPaise(tx.amount) + '</span>' +
        '</li>';
    }).join('');

    dom.settlementRegion.innerHTML = '<ul class="rows">' + html + '</ul>';
  }

  /* ====================================================== UI HELPERS */

  function setFieldError(input, errorNode, message) {
    errorNode.textContent = message || '';
    if (input) {
      if (message) {
        input.setAttribute('aria-invalid', 'true');
      } else {
        input.removeAttribute('aria-invalid');
      }
    }
  }

  function clearExpenseErrors() {
    setFieldError(dom.description, dom.descriptionError, '');
    setFieldError(dom.amount, dom.amountError, '');
    setFieldError(dom.payer, dom.payerError, '');
    setFieldError(null, dom.participantsError, '');
  }

  function showToast(message, tone) {
    var toast = document.createElement('p');
    toast.className = 'toast' + (tone ? ' toast--' + tone : '');
    toast.textContent = message;
    dom.toast.appendChild(toast);

    window.setTimeout(function () {
      toast.classList.add('is-leaving');
      window.setTimeout(function () {
        if (toast.parentNode) { toast.parentNode.removeChild(toast); }
      }, 220);
    }, 3600);
  }

  var modalResolve = null;
  var modalLastFocus = null;

  function confirmAction(options) {
    return new Promise(function (resolve) {
      if (modalResolve) { modalResolve(false); } // never strand an earlier prompt
      modalResolve = resolve;
      modalLastFocus = document.activeElement;

      dom.modalTitle.textContent = options.title;
      dom.modalMessage.textContent = options.message;
      dom.modalAccept.textContent = options.confirmLabel || 'Confirm';

      dom.modal.hidden = false;
      dom.modalAccept.focus();
      document.addEventListener('keydown', onModalKeydown, true);
    });
  }

  function closeModal(result) {
    if (dom.modal.hidden) { return; }
    dom.modal.hidden = true;
    document.removeEventListener('keydown', onModalKeydown, true);

    if (modalLastFocus && typeof modalLastFocus.focus === 'function' &&
        document.contains(modalLastFocus)) {
      modalLastFocus.focus();
    }

    var resolve = modalResolve;
    modalResolve = null;
    if (resolve) { resolve(result); }
  }

  function onModalKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal(false);
      return;
    }
    if (event.key !== 'Tab') { return; }

    // Simple two-button focus trap.
    var focusables = [dom.modalCancel, dom.modalAccept];
    var index = focusables.indexOf(document.activeElement);
    event.preventDefault();
    var next = event.shiftKey ? index - 1 : index + 1;
    if (next < 0) { next = focusables.length - 1; }
    if (next >= focusables.length) { next = 0; }
    focusables[next].focus();
  }

  /* ---------- expense form modes ---------- */

  function enterEditMode(id) {
    var expense = state.expenses.filter(function (entry) { return entry.id === id; })[0];
    if (!expense) { return; }

    editingExpenseId = id;
    dom.description.value = expense.description;
    dom.amount.value = String(expense.amount);
    dom.payer.value = expense.payerId;
    selectedIds = expense.participantIds.slice();

    dom.expenseFormTitle.textContent = 'Edit expense';
    dom.expenseSubmitLabel.textContent = 'Save changes';
    dom.cancelEdit.hidden = false;

    clearExpenseErrors();
    render();

    dom.description.focus();
    dom.description.scrollIntoView({
      block: 'center',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth'
    });
  }

  function exitEditMode() {
    editingExpenseId = null;
    dom.expenseFormTitle.textContent = 'New expense';
    dom.expenseSubmitLabel.textContent = 'Add expense';
    dom.cancelEdit.hidden = true;
    resetExpenseForm();
  }

  function resetExpenseForm() {
    dom.description.value = '';
    dom.amount.value = '';
    dom.payer.value = '';
    selectedIds = state.participants.map(function (person) { return person.id; });
    clearExpenseErrors();
    render();
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* ---------- theme ---------- */

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var isDark = theme === 'dark';
    dom.themeToggle.setAttribute('aria-pressed', isDark ? 'true' : 'false');
    dom.themeLabel.textContent = isDark ? 'Light' : 'Dark';
    dom.themeToggle.setAttribute('aria-label',
      isDark ? 'Switch to light theme' : 'Switch to dark theme');
  }

  function initTheme() {
    var stored = null;
    try { stored = window.localStorage.getItem(THEME_KEY); } catch (err) { /* ignore */ }

    if (stored !== 'dark' && stored !== 'light') {
      stored = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark' : 'light';
    }
    applyTheme(stored);
  }

  /* ====================================================== EVENT HANDLERS */

  dom.themeToggle.addEventListener('click', function () {
    var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { window.localStorage.setItem(THEME_KEY, next); } catch (err) { /* ignore */ }
  });

  /* ---------- participants ---------- */

  dom.participantForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var result = addParticipant(dom.participantName.value);

    if (!result.ok) {
      setFieldError(dom.participantName, dom.participantError, result.message);
      dom.participantName.focus();
      return;
    }

    setFieldError(dom.participantName, dom.participantError, '');
    dom.participantName.value = '';
    dom.participantName.focus();
    showToast(result.person.name + ' joined the group.', 'success');
  });

  dom.participantName.addEventListener('input', function () {
    if (dom.participantError.textContent) {
      setFieldError(dom.participantName, dom.participantError, '');
    }
  });

  dom.peopleRegion.addEventListener('click', function (event) {
    var button = event.target.closest('[data-action="remove-person"]');
    if (!button) { return; }
    removeParticipant(button.getAttribute('data-id'));
  });

  /* ---------- expense form ---------- */

  dom.checklist.addEventListener('change', function (event) {
    var input = event.target;
    if (!input || input.type !== 'checkbox') { return; }

    var id = input.value;
    var row = input.closest('.pick');

    if (input.checked) {
      if (selectedIds.indexOf(id) === -1) { selectedIds.push(id); }
      if (row) { row.classList.add('is-on'); }
    } else {
      selectedIds = selectedIds.filter(function (pid) { return pid !== id; });
      if (row) { row.classList.remove('is-on'); }
    }

    setFieldError(null, dom.participantsError, '');
    renderSplitMeta();
  });

  dom.selectAll.addEventListener('click', function () {
    selectedIds = state.participants.map(function (person) { return person.id; });
    renderExpenseForm();
    setFieldError(null, dom.participantsError, '');
  });

  dom.selectNone.addEventListener('click', function () {
    selectedIds = [];
    renderExpenseForm();
  });

  dom.amount.addEventListener('input', function () {
    setFieldError(dom.amount, dom.amountError, '');
    renderSplitMeta();
  });

  dom.description.addEventListener('input', function () {
    setFieldError(dom.description, dom.descriptionError, '');
  });

  /**
   * Picking a payer quietly adds them to the split, because in almost every
   * real expense the person who paid also shares the cost. Other selections are
   * preserved, and the user stays free to untick the payer afterwards — that
   * case is then spelled out by renderSplitMeta() instead of silently changing
   * the maths.
   */
  dom.payer.addEventListener('change', function () {
    setFieldError(dom.payer, dom.payerError, '');

    var id = dom.payer.value;
    if (id && selectedIds.indexOf(id) === -1) {
      selectedIds.push(id);
      setFieldError(null, dom.participantsError, '');
    }

    renderExpenseForm();
  });

  dom.expenseForm.addEventListener('submit', function (event) {
    event.preventDefault();

    if (!state.participants.length) {
      showToast('Add at least one person before recording an expense.', 'error');
      return;
    }

    var result = validateExpenseInput({
      description: dom.description.value,
      amount: dom.amount.value,
      payerId: dom.payer.value,
      participantIds: selectedIds.slice()
    });

    if (!result.ok) {
      setFieldError(dom.description, dom.descriptionError, result.errors.description);
      setFieldError(dom.amount, dom.amountError, result.errors.amount);
      setFieldError(dom.payer, dom.payerError, result.errors.payer);
      setFieldError(null, dom.participantsError, result.errors.participants);

      var firstInvalid = document.querySelector('#expense-form [aria-invalid="true"]');
      if (firstInvalid) { firstInvalid.focus(); }
      return;
    }

    if (editingExpenseId) {
      var updated = updateExpense(editingExpenseId, result.value);
      exitEditMode();
      showToast(updated ? 'Expense updated.' : 'That expense no longer exists.',
                updated ? 'success' : 'error');
    } else {
      addExpense(result.value);
      resetExpenseForm();
      showToast('Expense added.', 'success');
    }

    dom.description.focus();
  });

  dom.cancelEdit.addEventListener('click', function () {
    exitEditMode();
    showToast('Edit cancelled.');
  });

  /* ---------- expense list ---------- */

  dom.expenseRegion.addEventListener('click', function (event) {
    var button = event.target.closest('[data-action]');
    if (!button) { return; }

    var id = button.getAttribute('data-id');
    var action = button.getAttribute('data-action');

    if (action === 'edit') { enterEditMode(id); }
    if (action === 'delete') { deleteExpense(id); }
  });

  /* ---------- modal ---------- */

  dom.modalAccept.addEventListener('click', function () { closeModal(true); });
  dom.modalCancel.addEventListener('click', function () { closeModal(false); });
  dom.modal.addEventListener('click', function (event) {
    if (event.target.hasAttribute('data-close')) { closeModal(false); }
  });

  /* ---------- workspace actions ---------- */

  dom.resetBtn.addEventListener('click', function () {
    if (!state.participants.length && !state.expenses.length) {
      showToast('The workspace is already empty.');
      return;
    }

    confirmAction({
      title: 'Reset this workspace?',
      message: 'Every person and expense will be deleted from this browser. This cannot be undone.',
      confirmLabel: 'Reset everything'
    }).then(function (confirmed) {
      if (!confirmed) { return; }

      state.participants = [];
      state.expenses = [];
      selectedIds = [];
      editingExpenseId = null;
      exitEditMode();

      try { window.localStorage.removeItem(STORAGE_KEY); } catch (err) { /* ignore */ }
      render();
      showToast('Workspace reset.');
    });
  });

  dom.demoBtn.addEventListener('click', function () {
    var run = function () {
      loadDemoData();
      showToast('Demo data loaded — reset the workspace to start clean.', 'success');
    };

    if (!state.participants.length && !state.expenses.length) {
      run();
      return;
    }

    confirmAction({
      title: 'Replace with demo data?',
      message: 'Your current people and expenses will be replaced by a sample group.',
      confirmLabel: 'Load demo'
    }).then(function (confirmed) { if (confirmed) { run(); } });
  });

  function loadDemoData() {
    var names = ['Demo · Aarav', 'Demo · Diya', 'Demo · Kabir', 'Demo · Meera'];
    var people = names.map(function (name) {
      return { id: generateId('p'), name: name };
    });

    var now = Date.now();
    state.participants = people;
    state.expenses = [
      {
        id: generateId('e'),
        description: 'Dinner at the beach shack',
        amount: 2400,
        payerId: people[0].id,
        participantIds: people.map(function (p) { return p.id; }),
        createdAt: now - 3000
      },
      {
        id: generateId('e'),
        description: 'Airport cab',
        amount: 900,
        payerId: people[1].id,
        participantIds: [people[0].id, people[1].id],
        createdAt: now - 2000
      },
      {
        id: generateId('e'),
        description: 'Groceries',
        amount: 1450.5,
        payerId: people[2].id,
        participantIds: people.map(function (p) { return p.id; }),
        createdAt: now - 1000
      }
    ];

    editingExpenseId = null;
    exitEditMode();
    saveState();
    render();
  }

  /* ====================================================== INIT */

  var loadedCleanly = loadState();
  initTheme();
  selectedIds = state.participants.map(function (person) { return person.id; });
  render();

  if (!loadedCleanly) {
    showToast('Saved data was unreadable, so the workspace was reset.', 'error');
  }
})();
