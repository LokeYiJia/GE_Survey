const LEADS_GATHERING_CONFIG = {
  sheetName: 'GE Survey Form',
  scriptBuild: '2026-09-04-whapi-report-status-v3',
  expectedHeaders:
  [
  'Date',
  'Roadshow Location',
  'Roadshow State',
  'Full Name',
  'Mobile Number',
  'IC Num (last 4 digits)',
  'Agent Name',
  'Agent ID',
  'Agent Email',
  'GM Name',
  'Current Insurance Company',
  'Age Band',
  'Marital Status',
  'Employment Type',
  'Monthly Income',
  'Existing Insurance Plan',
  'Financial Priorities in the next 12 months',
  'Presentation Done',
  'Potential Follow Up',
  'On the Spot Close Case',
  'ANP',
  'Submission Timestamp',
  'Submission ID',
  'Email Sent Timestamp',
  ],
  baseColumnKeys: [
  'date',
  'roadshowLocation',
  'roadshowState',
  'fullName',
  'mobileNumber',
  'icLast4',
  'agentName',
  'agentId',
  'agentEmail',
  'gmName',
  'currentInsuranceCompany',
  'ageBand',
  'maritalStatus',
  'employmentType',
  'monthlyPersonalIncome',
  'existingInsurancePlans',
  'financialPriorities',
  ],
  outcomeColumnKeys: [
  'presentationDone',
  'potentialFollowUp',
  'onTheSpotCloseCase',
  'anp',
  ]
};

const AGENT_REPORT_LOG_CONFIG = {
  sheetName: 'Agent Report Log',
  headers: [
    'Email Sent At',
    'Roadshow Date',
    'Roadshow Location',
    'Agent Email',
    'Lead Count',
    'WhatsApp Sent At',
  ],
};

const WHAPI_ENDPOINT = 'https://gate.whapi.cloud/messages/text';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Agent Reports')
    .addItem('Send unsent agent reports now', 'sendAgentReports')
    .addSeparator()
    .addItem('Install/reinstall daily midnight sending', 'installDailyAgentReportTrigger')
    .addItem('Retry pending WhatsApp updates now', 'sendPendingWhapiUpdatesNow')
    .addToUi();
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ success: false, error: 'Missing request body' });
    }

    const data = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LEADS_GATHERING_CONFIG.sheetName);
    if (!sheet) {
      throw new Error('Sheet tab not found: ' + LEADS_GATHERING_CONFIG.sheetName);
    }

    verifyHeaders_(sheet);

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Invalid payload');
    }

    // Use the same script-wide lock as report sending so a report cannot read a
    // row while the form is creating or completing it.
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      if (data.action === 'create') {
        // The four outcome cells start blank and are completed by the second request.
        const baseRow = LEADS_GATHERING_CONFIG.baseColumnKeys.map(function (key) {
          return safeCell(data[key]);
        });
        const emptyOutcomes = LEADS_GATHERING_CONFIG.outcomeColumnKeys.map(function () { return ''; });
        const submissionTimestamp = new Date();
        const submissionId = Utilities.getUuid();

        sheet.appendRow([
          ...baseRow,
          ...emptyOutcomes,
          submissionTimestamp,
          submissionId,
          '',
        ]);

        const appendedRowNumber = sheet.getLastRow();
        sheet.getRange(appendedRowNumber, 22).setNumberFormat('yyyy-mm-dd hh:mm:ss');
        return jsonResponse({ success: true, submissionId: submissionId });
      }

      if (data.action === 'complete') {
        const submissionId = data.submissionId == null ? '' : String(data.submissionId);
        if (!/^[0-9a-f-]{36}$/i.test(submissionId)) {
          throw new Error('Invalid submission ID');
        }

        const dataRowCount = sheet.getLastRow() - 1;
        if (dataRowCount < 1) throw new Error('Submission not found');

        const idCell = sheet
          .getRange(2, 23, dataRowCount, 1)
          .createTextFinder(submissionId)
          .matchEntireCell(true)
          .findNext();
        if (!idCell) throw new Error('Submission not found');

        validateOutcomes(data);
        const outcomeRow = LEADS_GATHERING_CONFIG.outcomeColumnKeys.map(function (key) {
          return safeCell(data[key]);
        });
        sheet.getRange(idCell.getRow(), 18, 1, outcomeRow.length).setValues([outcomeRow]);
        return jsonResponse({ success: true });
      }

      throw new Error('Invalid submission action');
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    console.error(error);
    const message = error && error.message ? String(error.message) : String(error);
    return jsonResponse({
      success: false,
      error: '[' + LEADS_GATHERING_CONFIG.scriptBuild  + '] ' + message,
    });
  }
}

// Manual failsafe called from the Agent Reports menu.
function sendAgentReports() {
  runAgentReports_(false);
}

// Silent entry point called by the time-based trigger.
function sendAgentReportsDaily() {
  runAgentReports_(true);
}

function runAgentReports_(silent) {
  const ui = silent ? null : SpreadsheetApp.getUi();
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000);
    const sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
    const groups = {};
    let incompleteCount = 0;
    let invalidEmailCount = 0;
    let compatibleTabCount = 0;

    sheets.forEach(function (sheet) {
      const reportInfo = getReportInfo_(sheet);
      if (!reportInfo) return;
      compatibleTabCount++;

      const lastRow = sheet.getLastRow();
      if (lastRow < 2) return;

      const rows = sheet
        .getRange(2, 1, lastRow - 1, reportInfo.headers.length)
        .getDisplayValues();

      rows.forEach(function (values, index) {
        const closeCase = reportCell_(values, reportInfo.columns, 'On the Spot Close Case').trim();
        const paDurationColumn = reportInfo.columns[normalizeHeader_('3 month / 6 month PA?')];
        const paDurationComplete = paDurationColumn == null
          || String(values[paDurationColumn] || '').trim() !== '';
        const alreadySent = reportCell_(values, reportInfo.columns, 'Email Sent Timestamp').trim() !== '';
        const completed = reportCell_(values, reportInfo.columns, 'Presentation Done').trim() !== ''
          && reportCell_(values, reportInfo.columns, 'Potential Follow Up').trim() !== ''
          && closeCase !== ''
          && paDurationComplete;

        if (alreadySent) return;
        if (!completed) {
          incompleteCount++;
          return;
        }

        const agentEmail = reportCell_(values, reportInfo.columns, 'Agent Email')
          .trim()
          .toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(agentEmail)) {
          invalidEmailCount++;
          return;
        }

        if (!groups[agentEmail]) groups[agentEmail] = [];
        groups[agentEmail].push({
          sheet: sheet,
          sheetName: sheet.getName(),
          rowNumber: index + 2,
          values: values,
          headers: reportInfo.headers,
          columns: reportInfo.columns,
          roadshowLocation: reportCell_(values, reportInfo.columns, 'Roadshow Location').trim()
            || 'Unspecified Roadshow',
          sentTimestampColumn: reportInfo.columns[normalizeHeader_('Email Sent Timestamp')],
        });
      });
    });

    if (compatibleTabCount === 0) {
      throw new Error(
        'No compatible survey tabs were found. A report tab must contain Agent Email, '
          + 'Presentation Done, Potential Follow Up, On the Spot Close Case, '
          + 'and Email Sent Timestamp headers.'
      );
    }

    const recipients = Object.keys(groups);
    if (recipients.length === 0) {
      const whapiStatus = sendPendingWhapiUpdates_();
      showAgentReportMessage_(
        ui,
        'Agent Reports',
        'No completed, unsent submissions were found.'
          + formatSkippedRows_(incompleteCount, invalidEmailCount)
          + '\n\n' + whapiStatus.message
      );
      return;
    }

    const remainingQuota = MailApp.getRemainingDailyQuota();
    if (remainingQuota < recipients.length) {
      throw new Error(
        'Not enough email quota. ' + recipients.length
          + ' agent reports are ready, but only ' + remainingQuota + ' recipients remain today.'
      );
    }

    const sentAt = new Date();
    let totalLeads = 0;
    recipients.forEach(function (agentEmail) {
      const leads = groups[agentEmail];
      const report = buildAgentReport_(agentEmail, leads);
      MailApp.sendEmail({
        to: agentEmail,
        subject: 'Great Eastern Lead Report - ' + leads.length
          + (leads.length === 1 ? ' lead' : ' leads'),
        body: report.text,
        htmlBody: report.html,
        name: 'Great Eastern Survey',
      });

      leads.forEach(function (lead) {
        lead.sheet.getRange(lead.rowNumber, lead.sentTimestampColumn + 1)
          .setValue(sentAt)
          .setNumberFormat('yyyy-mm-dd hh:mm:ss');
      });
      // Persist the sent stamps before creating the notification log. This
      // ensures a later Whapi failure cannot cause agent emails to be resent.
      SpreadsheetApp.flush();
      appendAgentReportLog_(agentEmail, leads, sentAt);
      totalLeads += leads.length;
    });

    SpreadsheetApp.flush();
    const whapiStatus = sendPendingWhapiUpdates_();
    showAgentReportMessage_(
      ui,
      'Agent Reports Sent',
      'Sent ' + recipients.length + ' agent email(s) containing ' + totalLeads + ' lead(s).'
        + '\nScanned ' + compatibleTabCount + ' compatible survey tab(s).'
        + formatSkippedRows_(incompleteCount, invalidEmailCount)
        + '\n\n' + whapiStatus.message
    );
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    if (silent) throw error;
    showAgentReportMessage_(
      ui,
      'Agent Reports Failed',
      error && error.message ? error.message : 'Unable to send agent reports.'
    );
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function showAgentReportMessage_(ui, title, message) {
  if (ui) {
    ui.alert(title, message, ui.ButtonSet.OK);
  } else {
    console.log(title + ': ' + message);
  }
}

function installDailyAgentReportTrigger() {
  const handlerName = 'sendAgentReportsDaily';

  // Delete existing copies first so reinstalling cannot cause duplicate sends.
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === handlerName) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger(handlerName)
    .timeBased()
    .everyDays(1)
    .atHour(0)
    .nearMinute(0)
    .inTimezone('Asia/Kuala_Lumpur')
    .create();

  const ui = SpreadsheetApp.getUi();
  ui.alert(
    'Daily Agent Reports',
    'Automatic sending is scheduled for approximately 12:00 AM daily (Malaysia time).',
    ui.ButtonSet.OK
  );
}

function sendPendingWhapiUpdatesNow() {
  const ui = SpreadsheetApp.getUi();
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000);
    const result = sendPendingWhapiUpdates_();
    ui.alert('WhatsApp Report Status', result.message, ui.ButtonSet.OK);
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    ui.alert(
      'WhatsApp Report Status Failed',
      error && error.message ? error.message : 'Unable to send the WhatsApp update.',
      ui.ButtonSet.OK
    );
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function appendAgentReportLog_(agentEmail, leads, sentAt) {
  const grouped = {};
  leads.forEach(function (lead) {
    const roadshowDate = formatRoadshowDate_(
      reportCell_(lead.values, lead.columns, 'Date').trim()
    );
    const location = lead.roadshowLocation || 'Unspecified Roadshow';
    const key = JSON.stringify([roadshowDate, location]);

    if (!grouped[key]) {
      grouped[key] = {
        roadshowDate: roadshowDate,
        location: location,
        leadCount: 0,
      };
    }
    grouped[key].leadCount++;
  });

  const rows = Object.keys(grouped).map(function (key) {
    const item = grouped[key];
    return [
      sentAt,
      item.roadshowDate,
      item.location,
      agentEmail,
      item.leadCount,
      '',
    ];
  });
  if (!rows.length) return;

  const logSheet = getAgentReportLogSheet_(true);
  const startRow = logSheet.getLastRow() + 1;
  logSheet.getRange(startRow, 1, rows.length, AGENT_REPORT_LOG_CONFIG.headers.length)
    .setValues(rows);
  logSheet.getRange(startRow, 1, rows.length, 1)
    .setNumberFormat('yyyy-mm-dd hh:mm:ss');
}

function sendPendingWhapiUpdates_() {
  const properties = PropertiesService.getScriptProperties();
  const token = String(properties.getProperty('WHAPI_TOKEN') || '').trim();
  const chatId = String(properties.getProperty('WHAPI_CHAT_ID') || '').trim();

  if (!token || !chatId) {
    return {
      sent: false,
      message: 'WhatsApp update not sent: configure WHAPI_TOKEN and WHAPI_CHAT_ID in Script Properties.',
    };
  }

  const logSheet = getAgentReportLogSheet_(false);
  if (!logSheet || logSheet.getLastRow() < 2) {
    return { sent: false, message: 'There are no pending WhatsApp report updates.' };
  }

  const rowCount = logSheet.getLastRow() - 1;
  const rows = logSheet
    .getRange(2, 1, rowCount, AGENT_REPORT_LOG_CONFIG.headers.length)
    .getDisplayValues();
  const pendingRows = [];
  const summaries = {};

  rows.forEach(function (values, index) {
    if (String(values[5] || '').trim() !== '') return;

    const roadshowDate = String(values[1] || '').trim() || 'Unspecified date';
    const location = String(values[2] || '').trim() || 'Unspecified Roadshow';
    const agentEmail = String(values[3] || '').trim().toLowerCase();
    const leadCount = Number(values[4]) || 0;
    const key = JSON.stringify([roadshowDate, location]);

    if (!summaries[key]) {
      summaries[key] = {
        roadshowDate: roadshowDate,
        location: location,
        leadCount: 0,
        agents: {},
      };
    }
    summaries[key].leadCount += leadCount;
    if (agentEmail) summaries[key].agents[agentEmail] = true;
    pendingRows.push(index + 2);
  });

  if (!pendingRows.length) {
    return { sent: false, message: 'There are no pending WhatsApp report updates.' };
  }

  const messageLines = ['✅ Agent email reports sent', ''];
  Object.keys(summaries).sort().forEach(function (key) {
    const summary = summaries[key];
    const agentCount = Object.keys(summary.agents).length;
    messageLines.push(
      'Emails for ' + summary.location + ' on ' + summary.roadshowDate
        + ' have been sent (' + summary.leadCount
        + (summary.leadCount === 1 ? ' lead' : ' leads') + ', '
        + agentCount + (agentCount === 1 ? ' agent' : ' agents') + ').'
    );
  });

  const response = UrlFetchApp.fetch(WHAPI_ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      accept: 'application/json',
      authorization: 'Bearer ' + token,
    },
    payload: JSON.stringify({
      to: chatId,
      body: messageLines.join('\n'),
    }),
    muteHttpExceptions: true,
  });
  const statusCode = response.getResponseCode();
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(
      'Whapi returned HTTP ' + statusCode + ': '
        + String(response.getContentText() || '').slice(0, 500)
    );
  }

  const sentAt = new Date();
  pendingRows.forEach(function (rowNumber) {
    logSheet.getRange(rowNumber, 6)
      .setValue(sentAt)
      .setNumberFormat('yyyy-mm-dd hh:mm:ss');
  });
  SpreadsheetApp.flush();

  return {
    sent: true,
    message: 'WhatsApp confirmation sent for ' + Object.keys(summaries).length
      + ' roadshow/date group(s).',
  };
}

function getAgentReportLogSheet_(createIfMissing) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(AGENT_REPORT_LOG_CONFIG.sheetName);

  if (!sheet && !createIfMissing) return null;
  if (!sheet) {
    sheet = spreadsheet.insertSheet(AGENT_REPORT_LOG_CONFIG.sheetName);
    sheet.getRange(1, 1, 1, AGENT_REPORT_LOG_CONFIG.headers.length)
      .setValues([AGENT_REPORT_LOG_CONFIG.headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  const headers = sheet
    .getRange(1, 1, 1, AGENT_REPORT_LOG_CONFIG.headers.length)
    .getDisplayValues()[0];
  const mismatches = AGENT_REPORT_LOG_CONFIG.headers.filter(function (header, index) {
    return headers[index] !== header;
  });
  if (mismatches.length) {
    throw new Error(
      'The ' + AGENT_REPORT_LOG_CONFIG.sheetName
        + ' headers do not match the required log format.'
    );
  }
  return sheet;
}

function formatRoadshowDate_(value) {
  const text = String(value || '').trim();
  const isoDate = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (isoDate) {
    return Number(isoDate[3]) + '/' + Number(isoDate[2]) + '/' + isoDate[1];
  }
  return text || 'Unspecified date';
}

function buildAgentReport_(agentEmail, leads) {
  const generatedAt = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyy-MM-dd HH:mm:ss'
  );
  const excludedHeaders = [
    normalizeHeader_('Agent Email'),
    normalizeHeader_('Submission ID'),
    normalizeHeader_('Email Sent Timestamp'),
  ];
  const roadshows = {};
  leads.forEach(function (lead) {
    if (!roadshows[lead.roadshowLocation]) roadshows[lead.roadshowLocation] = [];
    roadshows[lead.roadshowLocation].push(lead);
  });
  const textLines = [
    'Hello,',
    '',
    'Here are ' + leads.length + (leads.length === 1 ? ' lead' : ' leads')
      + ' assigned to ' + agentEmail + '.',
    '',
  ];
  const roadshowTables = Object.keys(roadshows).sort().map(function (roadshowLocation) {
    const roadshowLeads = roadshows[roadshowLocation];
    const seenHeaders = {};
    const reportHeaders = [];
    roadshowLeads.forEach(function (lead) {
      lead.headers.forEach(function (header) {
        const normalized = normalizeHeader_(header);
        if (!normalized || excludedHeaders.indexOf(normalized) !== -1 || seenHeaders[normalized]) return;
        seenHeaders[normalized] = true;
        reportHeaders.push({ label: header, normalized: normalized });
      });
    });

    textLines.push('Roadshow: ' + roadshowLocation);
    textLines.push(
      ['Lead', 'Survey'].concat(reportHeaders.map(function (header) { return header.label; })).join('\t')
    );
    const headerLabels = ['Lead', 'Survey'].concat(reportHeaders.map(function (header) {
      return header.label;
    }));
    const headerCells = headerLabels.map(function (label) {
      return '<th style="padding:8px 10px;text-align:left;vertical-align:top;white-space:nowrap;'
        + 'background:#102746;color:#ffffff;border:1px solid #d9dde3">'
        + escapeHtml_(label) + '</th>';
    }).join('');

    const htmlRows = roadshowLeads.map(function (lead, index) {
      const rowValues = reportHeaders.map(function (header) {
        const columnIndex = lead.columns[header.normalized];
        return columnIndex == null ? '' : lead.values[columnIndex];
      });
      const displayedValues = [index + 1, lead.sheetName].concat(rowValues);
      textLines.push(displayedValues.map(plainTextCell_).join('\t'));
      const cells = displayedValues.map(function (value) {
        return '<td style="padding:8px 10px;text-align:left;vertical-align:top;'
          + 'border:1px solid #d9dde3">' + escapeHtml_(value) + '</td>';
      }).join('');
      return '<tr style="background:' + (index % 2 === 0 ? '#ffffff' : '#f7f8fa') + '">'
        + cells + '</tr>';
    }).join('');
    textLines.push('');

    return '<h3 style="margin:28px 0 10px;color:#102746">Roadshow: '
      + escapeHtml_(roadshowLocation) + '</h3>'
      + '<div style="width:100%;overflow-x:auto"><table style="border-collapse:collapse;min-width:1600px">'
      + '<thead><tr>' + headerCells + '</tr></thead><tbody>' + htmlRows + '</tbody></table></div>';
  }).join('');

  textLines.push('', 'Report generated: ' + generatedAt);

  return {
    text: textLines.join('\n'),
    html: '<div style="font-family:Arial,Helvetica,sans-serif;color:#172033">'
      + '<p>Hello,</p><p>Here are <strong>' + leads.length
      + (leads.length === 1 ? ' lead' : ' leads') + '</strong> assigned to '
      + escapeHtml_(agentEmail) + '.</p>' + roadshowTables
      + '<p style="margin-top:24px;color:#5c667a">Report generated: '
      + escapeHtml_(generatedAt) + '</p></div>',
  };
}

function getReportInfo_(sheet) {
  const lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) return null;

  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0].map(function (header) {
    return String(header || '').trim();
  });
  const columns = headers.reduce(function (indexes, header, index) {
    const normalized = normalizeHeader_(header);
    if (normalized && indexes[normalized] == null) indexes[normalized] = index;
    return indexes;
  }, {});
  const requiredHeaders = [
    'Agent Email',
    'Presentation Done',
    'Potential Follow Up',
    'On the Spot Close Case',
    'Email Sent Timestamp',
  ];
  const compatible = requiredHeaders.every(function (header) {
    return columns[normalizeHeader_(header)] != null;
  });

  return compatible ? { headers: headers, columns: columns } : null;
}

function reportCell_(values, columns, header) {
  const index = columns[normalizeHeader_(header)];
  return index == null ? '' : String(values[index] || '');
}

function normalizeHeader_(header) {
  return String(header == null ? '' : header).trim().toLowerCase().replace(/\s+/g, ' ');
}

function verifyHeaders_(sheet) {
  const headers = sheet.getRange(1, 1, 1, LEADS_GATHERING_CONFIG.expectedHeaders.length).getDisplayValues()[0];
  const mismatches = LEADS_GATHERING_CONFIG.expectedHeaders.reduce(function (results, expected, index) {
    if (headers[index] !== expected) {
      results.push(
        'Column ' + (index + 1) + ': expected "' + expected
        + '", found "' + (headers[index] || '(blank)') + '"'
      );
    }
    return results;
  }, []);
  if (mismatches.length) throw new Error('Sheet header mismatch. ' + mismatches.join('; '));
}

function getColumnIndexes_() {
  return LEADS_GATHERING_CONFIG.expectedHeaders.reduce(function (indexes, header, index) {
    indexes[header] = index;
    return indexes;
  }, {});
}

function plainTextCell_(value) {
  return String(value == null ? '' : value).replace(/[\t\r\n]+/g, ' ');
}

function escapeHtml_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatSkippedRows_(incompleteCount, invalidEmailCount) {
  const messages = [];
  if (incompleteCount) messages.push(incompleteCount + ' incomplete row(s) skipped');
  if (invalidEmailCount) messages.push(invalidEmailCount + ' row(s) with invalid Agent Email skipped');
  return messages.length ? '\n\n' + messages.join('; ') + '.' : '';
}

function validateOutcomes(data) {
  ['presentationDone', 'potentialFollowUp', 'onTheSpotCloseCase'].forEach(function (key) {
    if (data[key] !== 'Yes' && data[key] !== 'No') {
      throw new Error(key + ' must be Yes or No');
    }
  });

  const anp = data.anp == null ? '' : String(data.anp).trim();
  if (data.onTheSpotCloseCase === 'Yes' && !/^\d+(?:\.\d{1,2})?$/.test(anp)) {
    throw new Error('ANP must be a number with no more than two decimal places');
  }
  data.anp = data.onTheSpotCloseCase === 'No' ? '' : anp;
}

// Prevent user-supplied values from being interpreted as spreadsheet formulas.
function safeCell(value) {
  const text = value == null ? '' : String(value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
