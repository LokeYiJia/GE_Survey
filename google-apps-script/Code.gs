const SHEET_NAME = 'Leads Gathering';

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

    const row = [
      data.date || '',
      data.venue || '',
      data.fullName || '',
      data.mobileNumber || '',
      data.icLast4 || '',
      data.caseClosedPolicyNumber || '',
      data.agentName || '',
      data.agentId || '',
      data.currentInsuranceCompany || '',
      data.ageBand || '',
      data.maritalStatus || '',
      data.employmentType || '',
      data.monthlyPersonalIncome || '',
      data.existingInsurancePlans || '',
      data.financialPriorities || '',
    ];

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
    return jsonResponse({ success: false, error: error.message });
  }
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
