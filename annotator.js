/* =============================================================
   COREF/entity annotator for GitHub Pages

   Annotator-facing import:
     - User selects or pastes ONE entity/coref TSV.

   Required imported/exported columns:
     COREF
     text
     start_token
     end_token
     lumens_entity_type

   Optional imported column:
     lumens_review_flags

   Ignored imported columns:
     cat, byte_*, char_*, tagger_*, supersense_*, etc.

   Token source:
     - The JS automatically derives the token TSV path from the imported
       entity/coref TSV file name.
     - Example:
         mythology.tsv -> tokens/mythology.tokens.tsv

   Token IDs:
     - Imported/exported start_token and end_token are 0-based.
     - Internal DOM token IDs are 1-based, for compatibility with the
       original spannotator interaction model.

   Required HTML IDs/classes:
     #selectable
     #editor
     #summary-panel
     #anno-context
     #active_entity
     #import_dialog
     #import_coref_file
     #import_coref_textarea optional fallback
     #export_dialog textarea
     #color_mode
     #btn_group
     #btn_ungroup

   Requires:
     jQuery
     jQuery UI
     Font Awesome 4.7
   ============================================================= */


/* =============================================================
   Basic helpers
   ============================================================= */

const range = (start, stop, step = 1) =>
  Array.from({ length: Math.max(0, stop - start) }, (_, i) => start + i * step);

function arrayRemove(arr, val) {
  return arr.filter(e => e !== val);
}

function escHTML(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cleanCell(s) {
  return String(s ?? '').replace(/[\r\n]+/g, ' ').trim();
}

function isEmptyValue(s) {
  const v = String(s ?? '').trim().toLowerCase();
  return v === '' || v === '_' || v === 'none' || v === 'null' || v === 'false' || v === 'nan';
}

function splitTSVLine(line) {
  return String(line).replace(/\r$/, '').split('\t');
}

function columnIndex(header, candidates, required = false) {
  const lower = header.map(h => String(h).toLowerCase().trim());

  for (const c of candidates) {
    const target = c.toLowerCase();
    const exact = lower.indexOf(target);
    if (exact >= 0) return exact;
  }

  for (const c of candidates) {
    const target = c.toLowerCase();
    const partial = lower.findIndex(h => h.includes(target));
    if (partial >= 0) return partial;
  }

  if (required) {
    throw new Error('Missing required column: ' + candidates[0]);
  }

  return -1;
}


/* =============================================================
   TSV parser

   This is intentionally a little forgiving. If an ignored column has an
   accidental line break, the parser treats a new record as starting only
   when the line begins with an integer COREF value followed by a tab.

   This is not a full quoted-TSV parser, but it handles the most common
   malformed pasted TSV issue.
   ============================================================= */

function parseCorefTSVLoose(raw) {
  const rawLines = String(raw ?? '').replace(/\r\n/g, '\n').split('\n');

  const useful = rawLines.filter(line => {
    const t = line.trim();
    return t !== '' && !t.startsWith('#');
  });

  if (!useful.length) {
    return { header: [], rows: [] };
  }

  const header = splitTSVLine(useful[0].trim()).map(h => h.trim());
  const records = [];
  let current = null;

  for (let i = 1; i < useful.length; i++) {
    const line = useful[i];

    if (/^\s*-?\d+\t/.test(line)) {
      if (current !== null) records.push(current);
      current = line.trim();
    } else if (current !== null) {
      current += ' ' + line.trim();
    }
  }

  if (current !== null) records.push(current);

  return {
    header,
    rows: records.map(splitTSVLine)
  };
}


/* =============================================================
   Entity type icons and colors
   ============================================================= */

const ICON_MAP = {
  CHARACTER: ['user', '#4A90D9'],
  GROUP: ['users', '#1A6B4A'],
  LOCATION: ['map-marker', '#E05D44'],
  OBJECT: ['cube', '#8E44AD'],
  ABSTRACT: ['cloud', '#7F8C8D'],
  EVENT: ['bolt', '#E67E22'],
  TIME: ['clock-o', '#D4AC0D'],
  ANIMAL: ['paw', '#A04000'],
  DEITY: ['star', '#922B21'],
  ORGANIZATION: ['bank', '#2C3E50'],

  PER: ['user', '#4A90D9'],
  LOC: ['map-marker', '#E05D44'],
  FAC: ['building', '#9B59B6'],
  GPE: ['globe', '#27AE60'],
  VEH: ['car', '#E67E22'],
  ORG: ['bank', '#2C3E50'],

  person: ['user', '#4A90D9'],
  place: ['map-marker', '#E05D44'],
  object: ['cube', '#8E44AD'],
  abstract: ['cloud', '#7F8C8D'],
  time: ['clock-o', '#D4AC0D'],
  event: ['bolt', '#E67E22']
};

function baseType(type) {
  const t = String(type ?? '').trim();

  if (!t) return DEFAULT_ENTITY_TYPE;
  if (ICON_MAP[t]) return t;

  const upper = t.toUpperCase();

  const bases = [
    'CHARACTER',
    'GROUP',
    'LOCATION',
    'OBJECT',
    'ABSTRACT',
    'EVENT',
    'TIME',
    'ANIMAL',
    'DEITY',
    'ORGANIZATION'
  ];

  for (const base of bases) {
    if (upper === base || upper.startsWith(base + '_')) {
      return base;
    }
  }

  return t;
}

function iconFor(type) {
  const b = baseType(type);
  return ICON_MAP[b] ? ICON_MAP[b][0] : 'question';
}

function colorFor(type) {
  const b = baseType(type);
  return ICON_MAP[b] ? ICON_MAP[b][1] : 'lightgray';
}


/* =============================================================
   Global defaults
   ============================================================= */

const global_defaults = {
  ANNO_MODE: 'entities',
  DEFAULT_ENTITY_TYPE: 'CHARACTER_PERSON',
  DEFAULT_ICON: 'question',
  DEFAULT_COLOR: 'lightgray',
  DRAG_TOL: 5,
  DEFAULT_GROUP: 'coref'
};

for (const k in global_defaults) {
  window[k] = global_defaults[k];
}

const coref_colors = [
  'Red', 'RoyalBlue', 'ForestGreen', 'DarkMagenta', 'Brown',
  'DarkTurquoise', 'Plum', 'Orange', 'Navy', 'Olive',
  'LightSeaGreen', 'MediumSeaGreen', 'Aqua', 'Blue', 'BlueViolet',
  'CadetBlue', 'Chartreuse', 'Chocolate', 'Coral', 'CornflowerBlue',
  'Crimson', 'DarkBlue', 'DarkCyan', 'DarkGoldenRod', 'DarkGreen',
  'DarkKhaki', 'DarkOliveGreen', 'DarkOrange', 'DarkOrchid', 'DarkRed',
  'DarkSalmon', 'DarkSeaGreen', 'DarkSlateBlue', 'DarkSlateGray',
  'DeepPink', 'DarkViolet', 'DeepSkyBlue', 'DimGray', 'DodgerBlue',
  'FireBrick', 'Fuchsia', 'Gold', 'GoldenRod', 'Gray', 'Green',
  'GreenYellow', 'HotPink', 'IndianRed', 'Indigo', 'Khaki',
  'LawnGreen', 'LightBlue', 'LightCoral', 'LightGreen', 'LightPink',
  'LightSalmon', 'LightSkyBlue', 'LightSlateGray', 'LightSteelBlue',
  'Lime', 'LimeGreen', 'Magenta', 'Maroon', 'MediumAquaMarine',
  'MediumBlue', 'MediumOrchid', 'MediumPurple', 'MediumSlateBlue',
  'MediumSpringGreen', 'MediumTurquoise', 'MediumVioletRed',
  'MidnightBlue', 'NavajoWhite', 'OliveDrab', 'OrangeRed', 'Orchid',
  'PaleGreen', 'PaleTurquoise', 'PaleVioletRed', 'PeachPuff', 'Peru',
  'Pink', 'PowderBlue', 'Purple', 'RebeccaPurple', 'RosyBrown',
  'SaddleBrown', 'Salmon', 'SandyBrown', 'SeaGreen', 'Sienna',
  'SkyBlue', 'SlateBlue', 'SlateGray', 'SpringGreen', 'SteelBlue',
  'Tan', 'Teal', 'Thistle', 'Tomato', 'Turquoise', 'Violet',
  'Wheat', 'Yellow'
];


/* =============================================================
   Runtime state
   ============================================================= */

let entities = {};
let toks2entities = {};
let tokens = {};

let groups = { coref: { 0: [] } };
let assigned_colors = { coref: { 0: 'lightgray' } };

let anno_mode = 'entities';
let color_modes = new Set(['entities', 'coref']);
let active_group = 'coref';

let def_group = 'coref';
let def_color = 'lightgray';

let sentnum = 0;

let internalGroupToCoref = {};
let corefToInternalGroup = {};
let nextInternalGroupId = 1;
let nextManualCorefId = 0;

let activeEntityId = null;

let summaries = {
  '100 words': '',
  '50 words': '',
  '25 words': ''
};


/* =============================================================
   Classes
   ============================================================= */

class Entity {
  constructor(tok_ids, type, has_flag = false, originalCoref = null, isInSummary = '') {
    this.type = type || DEFAULT_ENTITY_TYPE;
    this.has_flag = !!has_flag;
    this.originalCoref = originalCoref;
    this.isInSummary = normalizeSummaryMatchValue(isInSummary);

    this.toks = tok_ids.map(Number).sort((a, b) => a - b);
    this.start = Math.min(...this.toks);
    this.end = Math.max(...this.toks);
    this.length = this.end - this.start + 1;

    this.div_id = this.start + '-' + this.end;
    this.groups = { coref: 0 };
  }

  get_text() {
    return this.toks
      .map(i => tokens[String(i)] ? tokens[String(i)].word : '')
      .join(' ');
  }
}

class Token {
  constructor(tid, toknum_in_sent, word, sent, snum, tooltip = '') {
    this.tid = String(tid);
    this.toknum_in_sent = toknum_in_sent;
    this.word = word;
    this.sent = sent;
    this.sentnum = snum;
    this.sent_tooltip = tooltip;
  }
}


/* =============================================================
   Summary panel
   ============================================================= */

function init_summary_panel() {
  const $p = $('#summary-panel');
  if (!$p.length) return;

  $p.empty();

  ['100 words', '50 words', '25 words'].forEach(slot => {
    const val = summaries[slot] || '';
    const sid = 'sum-' + slot.replace(/\s/g, '-');

    const tick = val
      ? '<i class="fa fa-check-circle" style="color:#4CAF50"></i>'
      : '<i class="fa fa-circle-o" style="color:#aaa"></i>';

    const preview = val
      ? `<span class="sum-text-preview">${escHTML(val)}</span>`
      : '<span class="sum-placeholder">Click to write summary…</span>';

    const $card = $(`
      <div class="summary-card" data-slot="${escHTML(slot)}">
        <div class="summary-label">
          <i class="fa fa-file-text-o sum-icon"></i>
          <span class="sum-title">${escHTML(slot)} summary</span>
          <span class="sum-status">${tick}</span>
        </div>
        <div class="summary-preview" id="prev-${sid}">${preview}</div>
        <textarea class="summary-textarea" id="${sid}" style="display:none">${escHTML(val)}</textarea>
        <div class="summary-actions" id="act-${sid}" style="display:none">
          <button class="btn-sum-save" onclick="save_summary('${slot}', '${sid}')">
            <i class="fa fa-save"></i> Save
          </button>
          <button class="btn-sum-cancel" onclick="cancel_summary('${sid}')">
            <i class="fa fa-times"></i> Cancel
          </button>
        </div>
      </div>
    `);

    $card.find('.summary-preview').on('click', () => open_summary(sid));
    $p.append($card);
  });
}

const SUMMARY_SLOTS = ['25 words', '50 words', '100 words'];

const SUMMARY_MATCH_OPTIONS = [
  '25 words summary',
  '50 words summary',
  '100 words summary'
];

function normalizeSummaryMatchValue(value) {
  const v = String(value || '').trim().toLowerCase();

  if (!v || v === '_' || v === 'none' || v === 'null' || v === 'false') {
    return '';
  }

  if (v.includes('25')) return '25 words summary';
  if (v.includes('50')) return '50 words summary';
  if (v.includes('100')) return '100 words summary';

  return '';
}

function normalizeSummarySlot(label, fallbackNumber = null) {
  const clean = String(label || '')
    .toLowerCase()
    .replace(/[()]/g, '')
    .replace(/summary/g, '')
    .trim();

  if (clean.includes('25')) return '25 words';
  if (clean.includes('50')) return '50 words';
  if (clean.includes('100')) return '100 words';

  // Fallback for imported files with #Summary1, #Summary2, #Summary3
  if (fallbackNumber === 1) return '25 words';
  if (fallbackNumber === 2) return '50 words';
  if (fallbackNumber === 3) return '100 words';

  return null;
}

function parse_summaries_from_tsv(raw) {
  // Reset summary fields first
  summaries = {
    '25 words': '',
    '50 words': '',
    '100 words': ''
  };

  const lines = String(raw || '').replace(/\r\n/g, '\n').split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Accept:
    // #Summary1=(25 words summary) ...
    // # Summary3=(100 words summary) ...
    const match = trimmed.match(/^#\s*Summary\s*(\d+)\s*=\s*\((.*?)\)\s*(.*)$/i);

    if (!match) continue;

    const summaryNumber = parseInt(match[1], 10);
    const label = match[2];
    const text = match[3] || '';

    const slot = normalizeSummarySlot(label, summaryNumber);

    if (slot) {
      summaries[slot] = text.trim();
    }
  }

  init_summary_panel();
}

function make_summary_header_lines() {
  const labels = {
    '25 words': '25 words summary',
    '50 words': '50 words summary',
    '100 words': '100 words summary'
  };

  return SUMMARY_SLOTS.map((slot, idx) => {
    const cleanSummary = String(summaries[slot] || '')
      .replace(/\r?\n/g, ' ')
      .trim();

    return `#Summary${idx + 1}=(${labels[slot]}) ${cleanSummary}`;
  });
}

function open_summary(id) {
  $('#' + id).slideDown(150).focus();
  $('#act-' + id).slideDown(150);
  $('#prev-' + id).slideUp(100);
}

function cancel_summary(id) {
  $('#' + id).slideUp(150);
  $('#act-' + id).slideUp(150);
  $('#prev-' + id).slideDown(100);
}

function save_summary(slot, id) {
  const val = $('#' + id).val().trim();
  summaries[slot] = val;

  const $card = $('#' + id).closest('.summary-card');

  $card.find('.sum-status').html(
    val
      ? '<i class="fa fa-check-circle" style="color:#4CAF50"></i>'
      : '<i class="fa fa-circle-o" style="color:#aaa"></i>'
  );

  $card.find('.summary-preview').html(
    val
      ? `<span class="sum-text-preview">${escHTML(val)}</span>`
      : '<span class="sum-placeholder">Click to write summary…</span>'
  );

  cancel_summary(id);
}


/* =============================================================
   File-name based token TSV discovery
   ============================================================= */

function stripKnownAnnotationSuffix(filename) {
  let base = filename.split('/').pop();

  base = base
    .replace(/\.coref\.tsv$/i, '')
    .replace(/\.entities\.tsv$/i, '')
    .replace(/\.entity\.tsv$/i, '')
    .replace(/\.annotations\.tsv$/i, '')
    .replace(/\.annotation\.tsv$/i, '')
    .replace(/\.tsv$/i, '')
    .replace(/\.txt$/i, '');

  return base;
}

function deriveTokenUrlFromEntityFilename(entityFilename) {
  const base = stripKnownAnnotationSuffix(entityFilename);
  return `tokens/${base}.tokens.tsv`;
}

function getDocIDFromEntityTSV(raw) {
  const lines = String(raw ?? '').replace(/\r\n/g, '\n').split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('#DocID=')) {
      return trimmed.replace('#DocID=', '').trim();
    }

    if (trimmed.startsWith('#Document=')) {
      return trimmed.replace('#Document=', '').trim();
    }
  }

  return null;
}

async function fetchTokenTSVForEntityImport(entityRaw, entityFilename = null) {
  let tokenUrl = null;

  if (entityFilename) {
    tokenUrl = deriveTokenUrlFromEntityFilename(entityFilename);
  } else {
    const docID = getDocIDFromEntityTSV(entityRaw);
    if (docID) {
      tokenUrl = `tokens/${docID}.tokens.tsv`;
    }
  }

  if (!tokenUrl) {
    throw new Error(
      'Could not infer the matching token TSV. Use file upload, or add a line like #DocID=mythology to the pasted TSV.'
    );
  }

  const response = await fetch(tokenUrl);

  if (!response.ok) {
    throw new Error(
      `Could not find matching token TSV at: ${tokenUrl}\n\n` +
      `Expected naming pattern: imported_file.tsv -> tokens/imported_file.tokens.tsv`
    );
  }

  return await response.text();
}


/* =============================================================
   Document/token loading
   ============================================================= */

function reset_all_state() {
  $('#selectable').html('');

  entities = {};
  toks2entities = {};
  tokens = {};

  groups = { coref: { 0: [] } };
  assigned_colors = { coref: { 0: def_color } };

  color_modes = new Set(['entities', 'coref']);
  anno_mode = 'entities';
  active_group = 'coref';

  sentnum = 0;

  internalGroupToCoref = {};
  corefToInternalGroup = {};
  nextInternalGroupId = 1;
  nextManualCorefId = 0;

  activeEntityId = null;
  $('#active_entity').val('');
}

function reset_annotations_only() {
  Object.keys(entities).forEach(id => {
    delete_entity(id, { silent: true });
  });

  entities = {};
  toks2entities = {};

  groups = { coref: { 0: [] } };
  assigned_colors = { coref: { 0: def_color } };

  internalGroupToCoref = {};
  corefToInternalGroup = {};
  nextInternalGroupId = 1;
  nextManualCorefId = 0;

  activeEntityId = null;
  $('#active_entity').val('');
}

function read_token_tsv(raw) {
  reset_all_state();

  const lines = String(raw ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter(l => l.trim() !== '');

  if (!lines.length) {
    alert('Token TSV is empty.');
    return;
  }

  const header = splitTSVLine(lines[0]).map(h => h.toLowerCase().trim());

  const iGlob = columnIndex(header, [
    'token_id_within_document',
    'token_id',
    'global_token_id',
    'id'
  ], true);

  const iWord = columnIndex(header, [
    'word',
    'token',
    'text'
  ], true);

  const iSent = columnIndex(header, [
    'sentence_id',
    'sent_id',
    'sentence'
  ], false);

  const iTokInSent = columnIndex(header, [
    'token_id_within_sentence',
    'token_in_sentence'
  ], false);

  let prevSent = null;
  const divs = [];

  for (let li = 1; li < lines.length; li++) {
    const row = splitTSVLine(lines[li]);

    if (row.length <= Math.max(iGlob, iWord)) continue;

    const global0 = parseInt(row[iGlob], 10);
    if (Number.isNaN(global0)) continue;

    const word = row[iWord];

    const sentId = iSent >= 0 && row[iSent] !== ''
      ? parseInt(row[iSent], 10)
      : 0;

    const tokInSent0 = iTokInSent >= 0 && row[iTokInSent] !== ''
      ? parseInt(row[iTokInSent], 10)
      : li - 1;

    const internalTid = global0 + 1;
    const isNewSent = sentId !== prevSent;
    prevSent = sentId;

    const tok = new Token(
      internalTid,
      tokInSent0 + 1,
      word,
      isNewSent ? sentId + 1 : null,
      sentId + 1,
      ''
    );

    tokens[String(internalTid)] = tok;
    divs.push(make_token_div(tok));
  }

  $('#selectable').html(divs.join(''));
  init_doc();
}

function make_token_div(tok) {
  if (tok.sent !== null) sentnum++;

  let html = `  <div id="t${tok.tid}" toknum="${tok.tid}" class="tok s${sentnum}">${escHTML(tok.word)}</div>\n`;

  if (tok.sent !== null) {
    const title = tok.sent_tooltip
      ? `title="${escHTML(tok.sent_tooltip)}" `
      : '';

    html = `  <span id="s${sentnum}" ${title}class="sent s${sentnum}"></span>\n` + html;
  }

  return html;
}


/* =============================================================
   Context menu and initialization
   ============================================================= */

function make_context_menu() {
  const $menu = $('#anno-context');
  if (!$menu.length) return;

  $menu.html('');

  const types = [
    'CHARACTER_PERSON',
    'GROUP_COMMUNITY',
    'LOCATION_SETTING',
    'OBJECT_ARTIFACT',
    'ABSTRACT_CONCEPT',
    'EVENT',
    'TIME',
    'ANIMAL',
    'DEITY',
    'ORGANIZATION'
  ];

  types.forEach(type => {
    const label = type.replace(/_/g, ' ');
    const icon = iconFor(type);

    $menu.append(`
      <li onclick="change_entity('${type}')">
        <i style="color:gray;font-size:small" class="fa fa-${icon}"></i>
        ${escHTML(label)}
      </li>
    `);
  });
}

function init_doc() {
  make_context_menu();
  bind_tok_events();
  bind_entity_events();

  $('#editor').off('mousemove', track_hover).on('mousemove', track_hover);

  if ($('#selectable').length && $.fn.selectable) {
    try {
      $('#selectable').selectable('destroy');
    } catch (e) {}

    $('#selectable').selectable({
      filter: '.tok',
      distance: 10
    });
  }

  update_color_mode_selector();
  set_color_mode($('#color_mode').val() || 'entities');
}

function update_color_mode_selector() {
  const $sel = $('#color_mode');
  if (!$sel.length) return;

  const current = $sel.val() || 'entities';

  $sel.html(`
    <option value="entities">entity types</option>
    <option value="coref">coref</option>
  `);

  $sel.val(current === 'coref' ? 'coref' : 'entities');
}


/* =============================================================
   Keyboard behavior
   ============================================================= */

$(document).on('keyup', function(e) {
  if ($(e.target).is('textarea,input,select')) return;

  if (e.which === 13) {
    if ($('.ui-selected').length) {
      add_entity();
      e.preventDefault();
      return false;
    }

    if ($('.selected-entity').length) {
      group_selected();
      e.preventDefault();
      return false;
    }
  }

  if (e.which === 46 && $('.selected-entity').length) {
    ungroup_selected();
    e.preventDefault();
    return false;
  }
});

$(document).on('keydown', function(e) {
  if ($(e.target).is('textarea,input,select')) return;

  if (e.ctrlKey && e.keyCode === 67 && $('.ui-selected').length) {
    e.preventDefault();

    const words = [];
    $('.ui-selected').each(function() {
      words.push($(this).text());
    });

    window.prompt('Copy to clipboard: Ctrl+C, Enter', words.join(' '));
  }
});


/* =============================================================
   Token and entity events
   ============================================================= */

function bind_tok_events() {
  if ($.fn.droppable) {
    $('.tok').droppable({});
  }

  $('.tok').off('click').on('click', function(ev) {
    if (ev.ctrlKey || ev.metaKey) {
      $(this).toggleClass('ui-selected');
    } else {
      $('.ui-selected').removeClass('ui-selected');
      $(this).addClass('ui-selected');
    }

    $('.selected-entity').removeClass('selected-entity');
  });
}

function bind_entity_events() {
  $('.entity')
    .each(function() {
      if ($.fn.draggable) {
        try {
          $(this).draggable(draggable_settings);
        } catch (e) {}
      }
    })
    .off('mouseover mouseleave click dblclick')
    .on('mouseover', set_hovered_entity)
    .on('mouseleave', unhighlight_entity_border)
    .on('click', select_entity)
    .on('dblclick', show_annotation);
}

function set_entity_classes() {
  bind_tok_events();
  bind_entity_events();

  $('.ui-selectee').removeClass('ui-selectee');

  if ($.fn.droppable) {
    $('.tok').droppable({});
  }

  if ($('#selectable').length && $.fn.selectable) {
    try {
      $('#selectable').selectable('destroy');
    } catch (e) {}

    $('#selectable').selectable({
      filter: '.tok',
      distance: 10
    });
  }

  $('#selectable .ui-selected').removeClass('ui-selected');
}


/* =============================================================
   Hover and dragging
   ============================================================= */

let hovered_entity = null;
let drag_border_side = null;

$(document).on('mousedown', function(e) {
  if (!$(e.target).parents('.custom-menu').length) {
    $('.custom-menu').hide(100);
  }

  $('#editor').off('mousemove', track_hover);
});

$(document).on('mouseup', function() {
  $('#editor').off('mousemove', track_hover).on('mousemove', track_hover);
});

function unhighlight_entity_border() {
  if ($(this).hasClass('entity')) {
    $('.entity').not('.selected-entity').css('background-color', 'transparent');
    $(this).removeClass('entity-border-hover-left entity-border-hover-right');
    hovered_entity = null;
  }
}

function set_hovered_entity(ev) {
  if (!$(ev.target).hasClass('entity')) return;

  hovered_entity = $(ev.target).attr('id');

  const cm = $('#color_mode').val();

  if (cm === 'coref' && hovered_entity in entities) {
    const grp = entities[hovered_entity].groups.coref;

    if (parseInt(grp, 10) !== 0) {
      for (const id in entities) {
        if (entities[id].groups.coref === grp) {
          $('#' + id).not('.selected-entity').css('background-color', '#ffffaa');
        }
      }
    }
  }
}

function select_entity(ev) {
  if (!$(ev.target).hasClass('entity')) return;

  ev.stopPropagation();

  const id = $(ev.target).attr('id');
  $('#' + id).toggleClass('selected-entity');

  if ($('.selected-entity').length) {
    $('.ui-selected').removeClass('ui-selected');
  }
}

function track_hover(ev) {
  if (!hovered_entity) return;

  const $e = $('#' + hovered_entity);

  if (!$e.length || !$e.offset()) {
    hovered_entity = null;
    return;
  }

  const x = ev.clientX - $e.offset().left;

  $e.toggleClass('entity-border-hover-left', x < DRAG_TOL);
  $e.toggleClass(
    'entity-border-hover-right',
    x >= DRAG_TOL && x + DRAG_TOL > $e.width()
  );

  if (x >= DRAG_TOL && x + DRAG_TOL <= $e.width()) {
    $e.removeClass('entity-border-hover-left entity-border-hover-right');
  }
}

const draggable_settings = {
  stop: drag_stop,
  revert: true,
  revertDuration: 0,

  helper: function() {
    return $('<div class="entity" style="border:3px solid green;width:0;height:14px;position:relative;pointer-events:none"></div>');
  },

  start: function(ev, ui) {
    $('#editor').off('mousemove', track_hover);

    const cx = ev.clientX - $(ev.target).offset().left;

    if (cx < DRAG_TOL) {
      drag_border_side = 'left';
    } else if (cx + DRAG_TOL > $(ev.target).width()) {
      drag_border_side = 'right';
    } else {
      return false;
    }

    $(this).draggable('instance').offset.click = {
      left: Math.floor(ui.helper.width() / 2),
      top: Math.floor(ui.helper.height() / 2)
    };

    $('.custom-menu').hide(100);
  }
};

function drag_stop(ev, ui) {
  $('#editor').off('mousemove', track_hover).on('mousemove', track_hover);

  const mx = ev.clientX;
  const my = ev.clientY;

  const toks = Array.from($('.tok'));

  if (!toks.length) return;

  const dists = toks.map(t => {
    const r = t.getBoundingClientRect();

    if (r.left > mx || r.right < mx || r.bottom < my || r.top > my) {
      return 1e9;
    }

    return Math.hypot(r.left - mx, r.top - my);
  });

  const minIdx = dists.indexOf(Math.min(...dists));
  const target = toks[minIdx];

  if (!target) return;

  drop_response($(this).attr('id'), $(target).attr('id'), ui);
  $('.custom-menu').hide(100);
}

function drop_response(draggableId, droppableId, ui) {
  if (!droppableId || !droppableId.startsWith('t')) {
    alert('Invalid drag target.');
    return false;
  }

  const oldEnt = entities[draggableId];

  if (!oldEnt) return false;

  let targetTok = parseInt(droppableId.replace('t', ''), 10);

  let newStart = oldEnt.start;
  let newEnd = oldEnt.end;

  if (drag_border_side === 'left') {
    newStart = targetTok;
  } else if (drag_border_side === 'right') {
    newEnd = targetTok;
  }

  if (newStart > newEnd) {
    const temp = newStart;
    newStart = newEnd;
    newEnd = temp;
  }

  const newToks = range(newStart, newEnd + 1);

  if (!check_sequential(newToks)) return false;

  const newId = newStart + '-' + newEnd;

  if (entities[newId] && newId !== draggableId) {
    alert('That span already exists.');
    return false;
  }

  const oldType = oldEnt.type;
  const oldFlag = oldEnt.has_flag;
  const oldCoref = oldEnt.originalCoref;

  delete_entity(draggableId, { keepGroupIfMoving: true });

  const ne = add_entity(newToks, oldType, true, oldFlag, oldCoref);

  if (!ne) return false;

  assign_group_by_coref(ne, oldCoref);
  set_entity_classes();
  set_color_mode($('#color_mode').val() || 'entities');

  return true;
}


/* =============================================================
   Entity CRUD
   ============================================================= */

function check_sequential(tok_ids) {
  let sent = null;

  for (const id of tok_ids) {
    const tok = tokens[String(id)];

    if (!tok) continue;

    if (sent !== null && tok.sentnum !== sent) {
      alert("Can't span across sentences.");
      $('.ui-selected').removeClass('ui-selected');
      return false;
    }

    sent = tok.sentnum;
  }

  return true;
}

function entity_html(div_id, type, has_flag) {
  const label = type ? type.replace(/_/g, ' ') : type;
  const icon = iconFor(type);

  const icon_div = `
    <div id="icon${div_id}" class="entity_type">
      <i title="${escHTML(label)}" class="fa fa-${icon} entity_icon"></i>
    </div>
  `;

  const close_div = `
    <div id="close${div_id}" class="close" onclick="delete_entity('${div_id}');">
      <i title="close" class="fa fa-times-circle"></i>
    </div>
  `;

  const flag_div = has_flag
    ? '<div class="review-flag" title="Review flag set">!</div>'
    : '';

  return { icon_div, close_div, flag_div };
}

function get_maximal_covers(tok_ids) {
  const covers = new Set();

  tok_ids.forEach(tok => {
    const key = String(tok);

    if (key in toks2entities) {
      const candidates = Object.values(toks2entities[key]).filter(e =>
        e.toks.every(t => tok_ids.includes(t))
      );

      if (candidates.length) {
        const longest = candidates.reduce((a, b) =>
          a.length > b.length ? a : b
        );

        covers.add(longest.div_id);
      } else {
        covers.add('t' + tok);
      }
    } else {
      covers.add('t' + tok);
    }
  });

  return Array.from(covers);
}

function add_entity(tok_ids = null, entity_type = null, batch = false, has_flag = false, originalCoref = null, isInSummary = '') {
  if (!tok_ids) {
    tok_ids = [];

    $('.ui-selected').each(function() {
      tok_ids.push(parseInt(this.getAttribute('toknum'), 10));
    });

    if (!tok_ids.length) {
      alert('No words selected. Click or drag over words first.');
      return false;
    }

    if (!check_sequential(tok_ids)) return false;
  }

  tok_ids = tok_ids.map(Number).sort((a, b) => a - b);

  if (!tok_ids.every(t => tokens[String(t)])) {
    alert('This span refers to token IDs that are not in the loaded document.');
    return false;
  }

  const divId = Math.min(...tok_ids) + '-' + Math.max(...tok_ids);

  if (entities[divId]) {
    return false;
  }

  const ne = new Entity(
    tok_ids,
    entity_type || DEFAULT_ENTITY_TYPE,
    has_flag,
    originalCoref,
    isInSummary
  );

  const covering = get_maximal_covers(tok_ids);
  const col = colorFor(ne.type);

  $('#' + covering.join(',#')).wrapAll(
    `<div id="${ne.div_id}" class="entity s${sentnum}" style="border-color:${col}"> </div>`
  );

  const { icon_div, close_div, flag_div } = entity_html(
    ne.div_id,
    ne.type,
    ne.has_flag
  );

  const inner = $('#' + ne.div_id).html();
  $('#' + ne.div_id).html(icon_div + flag_div + inner + close_div);

  record_entity(ne);

  activeEntityId = ne.div_id;
  $('#active_entity').val(ne.div_id);

  if (!batch) {
    if (ne.originalCoref === null || ne.originalCoref === undefined) {
      ne.originalCoref = get_next_manual_coref_id();
    }

    assign_group_by_coref(ne, ne.originalCoref);
    change_entity(ne.type);
    set_entity_classes();
  }

  return ne;
}

function record_entity(e) {
  entities[e.div_id] = e;

  for (const t of e.toks) {
    const key = String(t);

    if (!(key in toks2entities)) {
      toks2entities[key] = {};
    }

    toks2entities[key][e.div_id] = e;
  }
}

function delete_entity(es, opts = {}) {
  if (!(es in entities)) return;

  const ent = entities[es];
  const start = ent.start;
  const len = ent.length;

  $('#' + es).children('.entity_type').first().remove();
  $('#' + es).children('.close').first().remove();
  $('#' + es).children('.review-flag').remove();

  const childTokens = $('#' + es).children('.tok');

  if (childTokens.length) {
    childTokens.first().unwrap();
  } else {
    const childEntities = $('#' + es).children('.entity');

    if (childEntities.length) {
      childEntities.first().unwrap();
    }
  }

  delete entities[es];

  for (let i = 0; i < len; i++) {
    const key = String(start + i);

    if (!(key in toks2entities)) continue;

    delete toks2entities[key][es];

    if (!Object.keys(toks2entities[key]).length) {
      delete toks2entities[key];
    }
  }

  if (!opts.keepGroupIfMoving) {
    for (const gt in groups) {
      for (const g in groups[gt]) {
        groups[gt][g] = arrayRemove(groups[gt][g], es);

        if (!groups[gt][g].length && parseInt(g, 10) !== 0) {
          delete groups[gt][g];
        }
      }
    }
  } else {
    for (const gt in groups) {
      for (const g in groups[gt]) {
        groups[gt][g] = arrayRemove(groups[gt][g], es);
      }
    }
  }

  $('.custom-menu').hide(100);

  if (!opts.silent) {
    set_entity_classes();
  }
}

function change_entity(etype) {
  const es = $('#active_entity').val();

  if (!es || !(es in entities)) return;

  const label = etype ? etype.replace(/_/g, ' ') : etype;
  const icon = iconFor(etype);

  $('#icon' + es).html(`
    <i title="${escHTML(label)}" class="fa fa-${icon} entity_icon"></i>
  `);

  entities[es].type = etype;

  if ($('#color_mode').val() === 'entities') {
    $('#' + es).css('border-color', colorFor(etype));
  }

  $('.custom-menu').hide(100);
}

$(document).on('mousedown', '.entity_type', function() {
  const top = $(this).offset().top;
  const left = $(this).offset().left;

  $('.custom-menu')
    .finish()
    .toggle(100)
    .css({
      top: top + 'px',
      left: left + 'px'
    });

  const id = $(this).attr('id').replace('icon', '');
  activeEntityId = id;
  $('#active_entity').val(id);
});

$(document).on('mousedown', '.close', function() {
  const id = $(this).attr('id').replace('close', '');

  activeEntityId = id;
  $('#active_entity').val(id);

  delete_entity(id);
});


/* =============================================================
   Coreference grouping
   ============================================================= */

function ensure_internal_group_for_coref(corefId) {
  const key = String(corefId);

  if (!(key in corefToInternalGroup)) {
    const gid = nextInternalGroupId++;

    corefToInternalGroup[key] = gid;
    internalGroupToCoref[gid] = key;
  }

  return corefToInternalGroup[key];
}

function assign_group_by_coref(entity, corefId) {
  if (corefId === null || corefId === undefined || String(corefId).trim() === '') {
    return;
  }

  entity.originalCoref = String(corefId);

  const gid = ensure_internal_group_for_coref(entity.originalCoref);
  assign_group(entity, 'coref', gid);
}

function assign_group(span, gtype, ng) {
  ng = parseInt(ng, 10);

  if (!(gtype in groups)) {
    groups[gtype] = { 0: [] };
  }

  if (!(gtype in assigned_colors)) {
    assigned_colors[gtype] = { 0: def_color };
  }

  if (!(ng in groups[gtype])) {
    groups[gtype][ng] = [];
  }

  const old = span.groups[gtype] || 0;

  if (old in groups[gtype]) {
    groups[gtype][old] = arrayRemove(groups[gtype][old], span.div_id);
  }

  span.groups[gtype] = ng;

  if (!groups[gtype][ng].includes(span.div_id)) {
    groups[gtype][ng].push(span.div_id);
  }

  let col;

  if (ng === 0) {
    col = def_color;
  } else if (ng in assigned_colors[gtype]) {
    col = assigned_colors[gtype][ng];
  } else {
    col = ng > coref_colors.length
      ? '#' + Math.floor(Math.random() * 16777215).toString(16)
      : coref_colors[ng - 1];

    assigned_colors[gtype][ng] = col;
  }

  if ($('#color_mode').val() === gtype) {
    $('#' + span.div_id).css('border-color', col);
  }
}

function get_next_manual_coref_id() {
  const used = new Set(
    Object.values(entities)
      .map(e => String(e.originalCoref))
      .filter(v => !isEmptyValue(v))
  );

  let max = -1;

  used.forEach(v => {
    if (/^-?\d+$/.test(v)) {
      max = Math.max(max, parseInt(v, 10));
    }
  });

  nextManualCorefId = Math.max(nextManualCorefId, max + 1);

  while (used.has(String(nextManualCorefId))) {
    nextManualCorefId++;
  }

  return String(nextManualCorefId++);
}

function group_selected(gt = 'coref') {
  if ($('#color_mode').val() === 'entities') return;

  const sel = [];

  $('.selected-entity').each(function() {
    sel.push($(this).attr('id'));
  });

  if (sel.length < 2) return;

  const existingCorefs = sel
    .map(id => entities[id].originalCoref)
    .filter(v => !isEmptyValue(v));

  const chosenCoref = existingCorefs.length
    ? String(existingCorefs[0])
    : get_next_manual_coref_id();

  const gid = ensure_internal_group_for_coref(chosenCoref);

  sel.forEach(id => {
    entities[id].originalCoref = chosenCoref;
    assign_group(entities[id], gt, gid);
  });

  $('.selected-entity').removeClass('selected-entity');
  set_color_mode('coref');
}

function ungroup_selected(gt = 'coref') {
  if ($('#color_mode').val() === 'entities') return;

  const sel = [];

  $('.selected-entity').each(function() {
    sel.push($(this).attr('id'));
  });

  if (!sel.length) return;

  sel.forEach(id => {
    const newId = get_next_manual_coref_id();

    entities[id].originalCoref = newId;
    assign_group_by_coref(entities[id], newId);
  });

  $('.selected-entity').removeClass('selected-entity');
  set_color_mode('coref');
}

function set_color_mode(cm) {
  if (!cm) cm = $('#color_mode').val() || 'entities';

  anno_mode = cm;
  active_group = cm === 'coref' ? 'coref' : 'entities';

  for (const id in entities) {
    const e = entities[id];
    let col;

    if (cm === 'coref') {
      $('#btn_group').prop('disabled', false);
      $('#btn_ungroup').prop('disabled', false);

      const grp = e.groups.coref || 0;

      col = assigned_colors.coref && grp in assigned_colors.coref
        ? assigned_colors.coref[grp]
        : def_color;
    } else {
      $('#btn_group').prop('disabled', true);
      $('#btn_ungroup').prop('disabled', true);

      col = colorFor(e.type);
    }

    $('#' + id).css('border-color', col);
  }
}


/* =============================================================
   Import: token TSV + entity/coref TSV
   ============================================================= */

function read_coref_tsv(raw) {
  if (!Object.keys(tokens).length) {
    alert('The matching token TSV could not be loaded, so the entity TSV cannot be imported.');
    return;
  }
  parse_summaries_from_tsv(raw);

  reset_annotations_only();

  const parsed = parseCorefTSVLoose(raw);
  const header = parsed.header;

  if (!header.length) {
    set_entity_classes();
    init_doc();
    return;
  }

  let iCoref, iText, iStart, iEnd, iType, iFlags, iSummaryMatch;

  try {
    iCoref = columnIndex(header, ['COREF', 'coref'], true);
    iText = columnIndex(header, ['text'], false);
    iStart = columnIndex(header, ['start_token'], true);
    iEnd = columnIndex(header, ['end_token'], true);
    iType = columnIndex(header, ['lumens_entity_type', 'entity_type', 'type'], true);
    iFlags = columnIndex(header, ['lumens_review_flags', 'review_flags', 'flags'], false);
    iSummaryMatch = columnIndex(header, ['Is_in_summary', 'is_in_summary', 'summary_match'], false);
  } catch (err) {
    alert(err.message);
    return;
  }

  const errors = [];

  parsed.rows.forEach((row, idx) => {
    const coref = cleanCell(row[iCoref]);
    const s0 = parseInt(row[iStart], 10);
    const e0 = parseInt(row[iEnd], 10);
    const etype = cleanCell(row[iType]) || DEFAULT_ENTITY_TYPE;

    const flagsRaw = iFlags >= 0
      ? cleanCell(row[iFlags])
      : '';

    const hasFlag = !isEmptyValue(flagsRaw);
    const isInSummary = iSummaryMatch >= 0
      ? normalizeSummaryMatchValue(row[iSummaryMatch])
      : '';

    if (isEmptyValue(coref) || Number.isNaN(s0) || Number.isNaN(e0)) {
      errors.push(`row ${idx + 2}: invalid COREF/start_token/end_token`);
      return;
    }

    if (e0 < s0) {
      errors.push(`row ${idx + 2}: end_token is smaller than start_token`);
      return;
    }

    const internalToks = range(s0 + 1, e0 + 2);

    if (!internalToks.every(t => tokens[String(t)])) {
      errors.push(`row ${idx + 2}: token span ${s0}-${e0} not found in loaded token TSV`);
      return;
    }

    if (!check_sequential(internalToks)) {
      errors.push(`row ${idx + 2}: span crosses a sentence boundary`);
      return;
    }

    const ne = add_entity(internalToks, etype, true, hasFlag, coref, isInSummary);

    if (!ne) {
      errors.push(`row ${idx + 2}: could not add span ${s0}-${e0}, possibly duplicate or crossing span`);
      return;
    }

    assign_group_by_coref(ne, coref);
  });

  update_color_mode_selector();
  set_entity_classes();
  init_doc();
  set_color_mode('entities');

  if (errors.length) {
    console.warn('Import warnings:', errors);

    alert(
      'Import finished with warnings. The first few are:\n' +
      errors.slice(0, 8).join('\n')
    );
  }
}

async function run_import() {
  const fileInput = document.getElementById('import_coref_file');
  const textarea = document.getElementById('import_coref_textarea');

  let entityRaw = '';
  let entityFilename = null;

  if (fileInput && fileInput.files && fileInput.files.length) {
    const file = fileInput.files[0];
    entityFilename = file.name;
    entityRaw = await file.text();
  } else if (textarea && textarea.value.trim()) {
    entityRaw = textarea.value.trim();
  } else {
    alert('Please choose or paste a COREF/entity TSV file.');
    return;
  }

  try {
    const tokenRaw = await fetchTokenTSVForEntityImport(entityRaw, entityFilename);

    read_token_tsv(tokenRaw);
    read_coref_tsv(entityRaw);

    $('#import_dialog').dialog('close');
  } catch (err) {
    console.error(err);
    alert(err.message);
  }
}

function show_import() {
  const fileInput = document.getElementById('import_coref_file');
  const textarea = document.getElementById('import_coref_textarea');

  if (fileInput) fileInput.value = '';
  if (textarea) textarea.value = '';

  $('#import_dialog').dialog('open');
}


/* =============================================================
   Export: exactly five columns
   ============================================================= */

function write_coref_tsv() {
  const rows = [];

  // Save summaries at the top of the TSV
  rows.push(...make_summary_header_lines());

  rows.push([
    'COREF',
    'text',
    'start_token',
    'end_token',
    'lumens_entity_type',
    'Is_in_summary'
  ].join('\t'));

  Object.values(entities)
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .forEach(e => {
      if (isEmptyValue(e.originalCoref)) {
        e.originalCoref = get_next_manual_coref_id();
      }

      rows.push([
        String(e.originalCoref),
        cleanCell(e.get_text()),
        String(e.start - 1),
        String(e.end - 1),
        cleanCell(e.type || DEFAULT_ENTITY_TYPE),
        cleanCell(e.isInSummary || '')
      ].join('\t'));
    });

  return rows.join('\n');
}

function show_export() {
  $('#export_dialog').dialog('open');
  run_export();
}

function run_export() {
  $('#export_dialog textarea').val(write_coref_tsv());
}


/* =============================================================
   Optional entity dialog
   ============================================================= */

/* =============================================================
   Entity type dialog
   ============================================================= */

const LUMENS_ENTITY_TYPES = [
  'CHARACTER',
  'GROUP',
  'LOCATION',
  'OBJECT',
  'ABSTRACT',
  'EVENT',
  'TIME',
  'ANIMAL',
  'DEITY',
  'ORGANIZATION'
];

function show_annotation(e) {
  const id = $(this).attr('id');

  activeEntityId = id;
  $('#active_entity').val(id);

  const ent = entities[id];
  if (!ent) return;

  const $dlg = $('#annotation_dialog');
  if (!$dlg.length) return;

  $('#anno_entity_text').html(escHTML(ent.get_text()));

  const html = `
    <div class="anno-row">
      <label for="sel_entity_type"><strong>lumens_entity_type</strong></label><br>
      <select id="sel_entity_type" onchange="select_entity_type_value();"></select>
    </div>

    <div class="anno-row">
      <label for="sel_is_in_summary"><strong>Is_in_summary</strong></label><br>
      <select id="sel_is_in_summary" onchange="select_summary_match_value();"></select>
    </div>
  `;

  $('#sel_anno_key').hide();
  $('#sel_anno_value').hide();

  if (!$('#custom_entity_controls').length) {
    $('#anno_entity_text').after('<div id="custom_entity_controls"></div>');
  }

  $('#custom_entity_controls').html(html);

  let typeOptions = '';

  LUMENS_ENTITY_TYPES.forEach(type => {
    const selected = type === ent.type ? ' selected' : '';
    typeOptions += `<option value="${escHTML(type)}"${selected}>${escHTML(type)}</option>`;
  });

  $('#sel_entity_type').html(typeOptions);
  $('#sel_entity_type').val(ent.type);

  let summaryOptions = '<option value="">None</option>';

  SUMMARY_MATCH_OPTIONS.forEach(opt => {
    const selected = opt === ent.isInSummary ? ' selected' : '';
    summaryOptions += `<option value="${escHTML(opt)}"${selected}>${escHTML(opt)}</option>`;
  });

  $('#sel_is_in_summary').html(summaryOptions);
  $('#sel_is_in_summary').val(ent.isInSummary || '');

  $dlg.dialog('open');
  $('span.ui-dialog-title').text('Entity: ' + ent.type);

  if (e) e.stopPropagation();
}

function select_entity_type_value() {
  const did = $('#active_entity').val();
  if (!did || !(did in entities)) return;

  const newType = $('#sel_entity_type').val();
  if (!newType) return;

  $('#active_entity').val(did);
  change_entity(newType);

  $('span.ui-dialog-title').text('Entity: ' + newType);
}

function select_summary_match_value() {
  const did = $('#active_entity').val();
  if (!did || !(did in entities)) return;

  const val = $('#sel_is_in_summary').val();
  entities[did].isInSummary = normalizeSummaryMatchValue(val);
}

/* Keep these as no-ops for compatibility with the old HTML. */
function select_anno_key() {}
function select_anno_value() {}



/* =============================================================
   Sentence toggle
   ============================================================= */

function toggle_sents() {
  $('.sent').toggleClass('break offset numbered');

  if ($('.sent').first().hasClass('numbered')) {
    $('.sent').each(function() {
      if (!$(this).parent().hasClass('sent_row')) {
        $(this).nextUntil('.sent').addBack().wrapAll('<div class="sent_row"/>');
      }
    });
  } else {
    $('.sent').each(function() {
      if ($(this).parent().hasClass('sent_row')) {
        $(this).nextUntil('.sent').addBack().unwrap();
      }
    });
  }
}


/* =============================================================
   Document ready
   ============================================================= */

$(document).ready(function() {
  init_summary_panel();
  init_doc();

  if ($('#import_dialog').length && $.fn.dialog) {
    $('#import_dialog').dialog({
      autoOpen: false,
      resizable: true,
      width: 620,
      height: 420,
      modal: true,
      title: 'Import TSV',
      buttons: {
        'Load': function() {
          run_import();
        },
        'Cancel': function() {
          $(this).dialog('close');
        }
      }
    });
  }

  if ($('#export_dialog').length && $.fn.dialog) {
    $('#export_dialog').dialog({
      autoOpen: false,
      resizable: true,
      width: 520,
      height: 500,
      modal: true,
      title: 'Export TSV',
      buttons: {
        'Close': function() {
          $(this).dialog('close');
        }
      },
      open: function() {
        run_export();
      }
    });
  }

  if ($('#annotation_dialog').length && $.fn.dialog) {
    $('#annotation_dialog').dialog({
      autoOpen: false,
      resizable: false,
      width: 350,
      height: 260,
      modal: true,
      title: 'Entity',
      buttons: {
        'Close': function() {
          $(this).dialog('close');
        }
      }
    });
  }

  $('#loading_screen').removeClass('loading');
});