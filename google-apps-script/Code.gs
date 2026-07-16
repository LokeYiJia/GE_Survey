const SHEET_NAME = 'Leads Gathering';
const EXPECTED_HEADERS = [
  'Date',
  'Roadshow Location',
  'Roadshow State',
  'Full Name',
  'Mobile Number',
  'IC Number (last 4 digits)',
  'Agent Name',
  'Agent ID',
  'GM Name',
  'Current Insurance Company',
  'Age Band',
  'Marital Status',
  'Employment Type',
  'Monthly Income',
  'Existing Insurance Plan',
  'Financial Priorities in the next 12 months',
];
const COLUMN_KEYS = [
  'date',
  'roadshowLocation',
  'roadshowState',
  'fullName',
  'mobileNumber',
  'icLast4',
  'agentName',
  'agentId',
  'gmName',
  'currentInsuranceCompany',
  'ageBand',
  'maritalStatus',
  'employmentType',
  'monthlyPersonalIncome',
  'existingInsurancePlans',
  'financialPriorities',
];

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ success: false, error: 'Missing request body' });
    }

    const data = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    if (!sheet) {
      throw new Error('Sheet tab not found: ' + SHEET_NAME);
    }

    // Read and verify row 1, but never write to or modify it.
    const headers = sheet.getRange(1, 1, 1, EXPECTED_HEADERS.length).getDisplayValues()[0];
    const headerMismatches = EXPECTED_HEADERS.reduce(function (mismatches, header, index) {
      if (headers[index] !== header) {
        mismatches.push(
          'Column ' + (index + 1) + ': expected "' + header
          + '", found "' + (headers[index] || '(blank)') + '"'
        );
      }
      return mismatches;
    }, []);
    if (headerMismatches.length > 0) {
      throw new Error('Sheet header mismatch. ' + headerMismatches.join('; '));
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Invalid payload');
    }

    // Mapping this fixed list preserves the exact Sheet column order.
    const row = COLUMN_KEYS.map(function (key) {
      return safeCell(data[key]);
    });

    const lock = LockService.getDocumentLock();
    lock.waitLock(10000);
    try {
      sheet.appendRow(row);
    } finally {
      lock.releaseLock();
    }
    return jsonResponse({ success: true });
  } catch (error) {
    console.error(error);
    return jsonResponse({ success: false, error: error.message || 'Unable to append submission' });
  }
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
