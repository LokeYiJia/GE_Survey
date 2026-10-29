const LEADS_GATHERING_CONFIG = {
  spreadsheetId: '1PWhuDutSTs1Bg2lirVozX75ToFkvvnQBhF0Lmethncw',
  sheetName: 'GE Survey Form',
  reportSheetNames: [
    'Rapid Survey Form',
    'GE Survey Form',
    'Baby Fair Survey',
    'Hospital Survey',
  ],
  scriptBuild: '2026-10-12-configured-email-reports-v2',
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

function getLeadsGatheringSpreadsheet_() {
  return SpreadsheetApp.openById(LEADS_GATHERING_CONFIG.spreadsheetId);
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Agent Reports')
    .addItem('Send unsent agent reports now', 'sendAgentReports')
    .addSeparator()
    .addItem('Install/reinstall daily midnight sending', 'installDailyAgentReportTrigger')
    .addToUi();
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ success: false, error: 'Missing request body' });
    }

    const data = JSON.parse(e.postData.contents);
    const sheet = getLeadsGatheringSpreadsheet_().getSheetByName(LEADS_GATHERING_CONFIG.sheetName);
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
    const spreadsheet = getLeadsGatheringSpreadsheet_();
    const sheets = LEADS_GATHERING_CONFIG.reportSheetNames.map(function (sheetName) {
      const sheet = spreadsheet.getSheetByName(sheetName);
      if (!sheet) throw new Error('Configured report tab not found: ' + sheetName);
      return sheet;
    });
    const groups = {};
    let incompleteCount = 0;
    let invalidEmailCount = 0;
    let compatibleTabCount = 0;

    sheets.forEach(function (sheet) {
      const reportInfo = getReportInfo_(sheet);
      if (!reportInfo) {
        throw new Error(
          'Configured report tab "' + sheet.getName()
            + '" is missing one or more required agent-report headers.'
        );
      }
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
      showAgentReportMessage_(
        ui,
        'Agent Reports',
        'No completed, unsent submissions were found.'
          + formatSkippedRows_(incompleteCount, invalidEmailCount)
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
      SpreadsheetApp.flush();
      totalLeads += leads.length;
    });

    SpreadsheetApp.flush();
    showAgentReportMessage_(
      ui,
      'Agent Reports Sent',
      'Sent ' + recipients.length + ' agent email(s) containing ' + totalLeads + ' lead(s).'
        + '\nScanned ' + compatibleTabCount + ' compatible survey tab(s).'
        + formatSkippedRows_(incompleteCount, invalidEmailCount)
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
