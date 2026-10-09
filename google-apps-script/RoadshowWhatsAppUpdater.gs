/**
 * Standalone two-hour WhatsApp lead updater for the Leads Gathering spreadsheet.
 * Install this in the existing roadshow WhatsApp Apps Script project, not in the
 * survey web-app project (which has its own Code.gs and Whapi notification).
 *
 * Script Properties required: WHAPI_TOKEN, WHAPI_CHAT_ID.
 */
const ROADSHOW_CONFIG = {
  SPREADSHEET_ID: '1PWhuDutSTs1Bg2lirVozX75ToFkvvnQBhF0Lmethncw',
  ROADSHOW_SHEETS: ['GE Survey Form', 'Hospital Survey'],
  SCHEDULE_SHEET: 'Master Roadshow Listing',
  TIME_ZONE: 'Asia/Kuala_Lumpur',
  SKIP_IF_NO_NEW_LEADS: true,
  GRACE_DAYS: 3,
  STATUS_LIMIT: 4,
};

function sendRoadshowUpdate() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const ss = SpreadsheetApp.openById(ROADSHOW_CONFIG.SPREADSHEET_ID);
    const props = PropertiesService.getScriptProperties();
    const tabCounts = [];
    let grandTotal = 0;
    let grandNew = 0;

    ROADSHOW_CONFIG.ROADSHOW_SHEETS.forEach(function (sheetName) {
      const sheet = ss.getSheetByName(sheetName);
      if (!sheet) throw new Error('Survey tab not found: ' + sheetName);

      const total = Math.max(sheet.getLastRow() - 1, 0);
      const propertyKey = 'lastCount_' + sheetName;
      const previous = Number(props.getProperty(propertyKey) || 0);
      if (!Number.isFinite(previous) || previous < 0) {
        throw new Error('Invalid stored lead count for ' + sheetName);
      }

      grandTotal += total;
      grandNew += Math.max(total - previous, 0);
      tabCounts.push({ propertyKey: propertyKey, total: total, sheet: sheet });
    });

    if (grandNew === 0 && ROADSHOW_CONFIG.SKIP_IF_NO_NEW_LEADS) {
      Logger.log('No new leads; WhatsApp update skipped.');
      return;
    }

    const today = parseRoadshowDate_(Utilities.formatDate(
      new Date(), ROADSHOW_CONFIG.TIME_ZONE, 'yyyy-MM-dd'
    ));
    const schedule = readRoadshowSchedule_(ss);
    const activeRuns = schedule.filter(function (run) {
      return run.startDay <= today && today <= run.endDay + ROADSHOW_CONFIG.GRACE_DAYS;
    });
    const statuses = selectRoadshowStatuses_(schedule, today);
    const counts = countLeadsForRuns_(tabCounts, activeRuns);
    const message = buildRoadshowUpdateMessage_(grandTotal, grandNew, statuses, activeRuns, counts);

    sendWhatsAppGroupMessage_(message, props);

    // Keep the original count-difference baseline: advance it only after Whapi
    // accepts the message. A failed send is retried at the next trigger run.
    tabCounts.forEach(function (tab) {
      props.setProperty(tab.propertyKey, String(tab.total));
    });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function readRoadshowSchedule_(ss) {
  const sheet = ss.getSheetByName(ROADSHOW_CONFIG.SCHEDULE_SHEET);
  if (!sheet) throw new Error('Schedule tab not found: ' + ROADSHOW_CONFIG.SCHEDULE_SHEET);
  if (sheet.getLastRow() < 1) throw new Error('Roadshow schedule has no headers.');

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const venueColumn = findHeader_(headers, 'Roadshow Venue');
  const startColumn = findHeader_(headers, 'Start Date');
  const endColumn = findHeader_(headers, 'End Date');
  if ([venueColumn, startColumn, endColumn].some(function (index) { return index < 0; })) {
    throw new Error('Schedule needs Roadshow Venue, Start Date, and End Date headers.');
  }

  const rowCount = sheet.getLastRow() - 1;
  if (rowCount === 0) return [];
  const rows = sheet.getRange(2, 1, rowCount, sheet.getLastColumn()).getValues();
  const runs = [];

  rows.forEach(function (row, index) {
    const venue = String(row[venueColumn] || '').trim();
    const startValue = row[startColumn];
    const endValue = row[endColumn];

    // A draft or undated schedule row is not an active event.
    if (!venue || !startValue || !endValue) return;

    const startDay = parseRoadshowDate_(startValue);
    const endDay = parseRoadshowDate_(endValue);
    if (startDay == null || endDay == null || endDay < startDay) {
      throw new Error('Invalid schedule dates on row ' + (index + 2) + ' for ' + venue);
    }
    runs.push({
      venue: venue,
      normalizedVenue: normalizeRoadshowVenue_(venue),
      startDay: startDay,
      endDay: endDay,
      scheduleRow: index + 2,
    });
  });
  return runs;
}

function selectRoadshowStatuses_(runs, today) {
  const relevant = runs.filter(function (run) {
    return today <= run.endDay + ROADSHOW_CONFIG.GRACE_DAYS;
  });
  const current = relevant.filter(function (run) { return run.startDay <= today; })
    .sort(function (a, b) { return b.startDay - a.startDay || a.scheduleRow - b.scheduleRow; });
  const upcoming = relevant.filter(function (run) { return run.startDay > today; })
    .sort(function (a, b) { return a.startDay - b.startDay || a.scheduleRow - b.scheduleRow; });
  return current.concat(upcoming).slice(0, ROADSHOW_CONFIG.STATUS_LIMIT).map(function (run) {
    let status = 'Upcoming';
    if (run.startDay <= today && today <= run.endDay) status = 'Ongoing';
    if (today > run.endDay) status = 'Recently ended (day ' + (today - run.endDay) + ' of 3)';
    return { run: run, status: status };
  });
}

function countLeadsForRuns_(tabs, activeRuns) {
  const counts = {};
  activeRuns.forEach(function (run) { counts[run.scheduleRow] = 0; });
  if (!activeRuns.length) return counts;

  tabs.forEach(function (tab) {
    if (tab.total === 0) return;
    const headers = tab.sheet.getRange(1, 1, 1, tab.sheet.getLastColumn()).getDisplayValues()[0];
    const dateColumn = findHeader_(headers, 'Date');
    const venueColumn = findHeader_(headers, 'Roadshow Location');
    if (dateColumn < 0 || venueColumn < 0) {
      throw new Error(tab.sheet.getName() + ' needs Date and Roadshow Location headers.');
    }

    const rows = tab.sheet.getRange(2, 1, tab.total, tab.sheet.getLastColumn()).getValues();
    rows.forEach(function (row) {
      const day = parseRoadshowDate_(row[dateColumn]);
      if (day == null) return;
      const venue = normalizeRoadshowVenue_(row[venueColumn]);
      const matchingRuns = activeRuns.filter(function (run) {
        return run.normalizedVenue === venue && run.startDay <= day && day <= run.endDay;
      });
      if (!matchingRuns.length) return;

      // If the master list accidentally overlaps two runs of one venue, count
      // a lead only once, against the most recently started matching run.
      matchingRuns.sort(function (a, b) {
        return b.startDay - a.startDay || b.scheduleRow - a.scheduleRow;
      });
      counts[matchingRuns[0].scheduleRow]++;
    });
  });
  return counts;
}

function buildRoadshowUpdateMessage_(grandTotal, grandNew, statuses, activeRuns, counts) {
  const timestamp = Utilities.formatDate(
    new Date(), ROADSHOW_CONFIG.TIME_ZONE, 'd MMM, h:mm a'
  );
  const statusLines = statuses.map(function (entry) {
    return '• ' + formatRun_(entry.run) + ' — ' + entry.status;
  });
  const countLines = activeRuns.sort(function (a, b) {
    return b.startDay - a.startDay || a.scheduleRow - b.scheduleRow;
  }).map(function (run) {
    return '• ' + formatRun_(run) + ': ' + counts[run.scheduleRow];
  });
  return '📊 *Roadshow Leads Update* — ' + timestamp + '\n\n'
    + 'Total leads: *' + grandTotal + '*\n'
    + 'New since last update: *+' + grandNew + '*\n\n'
    + '*Roadshow Status:*\n'
    + (statusLines.length ? statusLines.join('\n') : '• No current or upcoming scheduled roadshows')
    + '\n\n*By Roadshow Location:*\n'
    + (countLines.length ? countLines.join('\n') : '• No ongoing or recently ended roadshows');
}

function formatRun_(run) {
  return run.venue + ' (' + formatRoadshowDay_(run.startDay) + '–'
    + formatRoadshowDay_(run.endDay) + ')';
}

function formatRoadshowDay_(day) {
  const date = new Date(day * 86400000);
  return date.getUTCDate() + '/' + (date.getUTCMonth() + 1) + '/' + date.getUTCFullYear();
}

function normalizeRoadshowVenue_(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function findHeader_(headers, expected) {
  return headers.findIndex(function (header) {
    return String(header || '').trim().toLowerCase() === expected.toLowerCase();
  });
}

function parseRoadshowDate_(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    value = Utilities.formatDate(value, ROADSHOW_CONFIG.TIME_ZONE, 'yyyy-MM-dd');
  }
  const text = String(value == null ? '' : value).trim();
  let year;
  let month;
  let day;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (match) {
    year = Number(match[1]); month = Number(match[2]); day = Number(match[3]);
  } else {
    match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
    if (!match) return null;
    day = Number(match[1]); month = Number(match[2]); year = Number(match[3]);
  }
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day) return null;
  return Math.floor(parsed.getTime() / 86400000);
}

function sendWhatsAppGroupMessage_(message, props) {
  const token = String(props.getProperty('WHAPI_TOKEN') || '').trim();
  const chatId = String(props.getProperty('WHAPI_CHAT_ID') || '').trim();
  if (!token || !chatId) {
    throw new Error('Set WHAPI_TOKEN and WHAPI_CHAT_ID in Script Properties.');
  }
  const response = UrlFetchApp.fetch('https://gate.whapi.cloud/messages/text', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ to: chatId, body: message }),
    muteHttpExceptions: true,
  });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Whapi send failed: HTTP ' + code + ' — '
      + String(response.getContentText() || '').slice(0, 300));
  }
  Logger.log('WhatsApp roadshow update sent.');
}

function createTwoHourTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'sendRoadshowUpdate') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger('sendRoadshowUpdate').timeBased().everyHours(2).create();
}

function checkRoadshowCounts() {
  const ss = SpreadsheetApp.openById(ROADSHOW_CONFIG.SPREADSHEET_ID);
  const props = PropertiesService.getScriptProperties();
  ROADSHOW_CONFIG.ROADSHOW_SHEETS.forEach(function (sheetName) {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) throw new Error('Survey tab not found: ' + sheetName);
    const total = Math.max(sheet.getLastRow() - 1, 0);
    const previous = Number(props.getProperty('lastCount_' + sheetName) || 0);
    Logger.log(sheetName + ': current=' + total + ', stored=' + previous
      + ', new=' + Math.max(total - previous, 0));
  });
}
