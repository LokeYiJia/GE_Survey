const SHEET_NAME = 'Leads Gathering';
const SCRIPT_BUILD = '2026-08-17-optional-profile-conditional-anp-v1';
const EXPECTED_HEADERS = [
  'Date',
  'Roadshow Location',
  'Roadshow State',
  'Full Name',
  'Mobile Number',
  'IC Num (last 4 digits)',
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
  'Presentation Done',
  'Potential Follow Up',
  'On the Spot Close Case',
  'ANP',
  'Submission Timestamp',
  'Submission ID',
];
const BASE_COLUMN_KEYS = [
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
const OUTCOME_COLUMN_KEYS = [
  'presentationDone',
  'potentialFollowUp',
  'onTheSpotCloseCase',
  'anp',
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

    const lock = LockService.getDocumentLock();
    lock.waitLock(10000);
    try {
      if (data.action === 'create') {
        // The four outcome cells start blank and are completed by the second request.
        const baseRow = BASE_COLUMN_KEYS.map(function (key) {
          return safeCell(data[key]);
        });
        const emptyOutcomes = OUTCOME_COLUMN_KEYS.map(function () { return ''; });
        const submissionTimestamp = new Date();
        const submissionId = Utilities.getUuid();

        sheet.appendRow([
          ...baseRow,
          ...emptyOutcomes,
          submissionTimestamp,
          submissionId,
        ]);

        const appendedRowNumber = sheet.getLastRow();
        sheet.getRange(appendedRowNumber, 21).setNumberFormat('yyyy-mm-dd hh:mm:ss');
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
          .getRange(2, 22, dataRowCount, 1)
          .createTextFinder(submissionId)
          .matchEntireCell(true)
          .findNext();
        if (!idCell) throw new Error('Submission not found');

        validateOutcomes(data);
        const outcomeRow = OUTCOME_COLUMN_KEYS.map(function (key) {
          return safeCell(data[key]);
        });
        sheet.getRange(idCell.getRow(), 17, 1, outcomeRow.length).setValues([outcomeRow]);
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
      error: '[' + SCRIPT_BUILD + '] ' + message,
    });
  }
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
