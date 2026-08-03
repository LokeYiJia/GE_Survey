import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { onRequest } from '../functions/api/submit-lead.js'

const originalFetch = globalThis.fetch
const env = {
  GOOGLE_SHEETS_WEBHOOK_URL: 'https://script.google.com/macros/s/test-deployment/exec',
}

const validBody = {
  date: '2026-07-14',
  roadshowLocation: '  Kuala Lumpur Convention Centre  ',
  roadshowState: 'Kuala Lumpur',
  fullName: 'Test Person',
  mobileNumber: '+60 12 345 6789',
  icLast4: '1234',
  agentName: 'Test Agent',
  agentId: 'GE123',
  gmName: 'Test GM',
  currentInsuranceCompany: '',
  ageBand: '25-34',
  maritalStatus: 'Single',
  employmentType: 'Salaried',
  monthlyPersonalIncome: 'RM3-6k',
  existingInsurancePlans: ['Medical Card'],
  financialPriorities: ['Build emergency fund'],
  presentationDone: 'Yes',
  potentialFollowUp: 'No',
  onTheSpotCloseCase: 'No',
  anp: '1200.50',
  consent: true,
}

function post(body = validBody, headers = {}) {
  return new Request('https://survey.example/api/submit-lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('rejects non-POST methods with Allow header', async () => {
  const response = await onRequest({
    request: new Request('https://survey.example/api/submit-lead'),
    env,
  })
  assert.equal(response.status, 405)
  assert.equal(response.headers.get('Allow'), 'POST')
})

test('forwards only the 20 cleaned Sheet fields in exact column order', async () => {
  let forwardedUrl
  let forwardedPayload
  globalThis.fetch = async (url, options) => {
    forwardedUrl = url
    forwardedPayload = JSON.parse(options.body)
    return Response.json({ success: true })
  }

  const response = await onRequest({ request: post(), env })
  assert.equal(response.status, 200)
  assert.equal(forwardedUrl, env.GOOGLE_SHEETS_WEBHOOK_URL)
  assert.deepEqual(Object.keys(forwardedPayload), [
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
    'presentationDone',
    'potentialFollowUp',
    'onTheSpotCloseCase',
    'anp',
  ])
  assert.equal(forwardedPayload.roadshowLocation, 'Kuala Lumpur Convention Centre')
  assert.equal('consent' in forwardedPayload, false)
})

test('rejects invalid popup answers and ANP values', async () => {
  const invalidAnswer = await onRequest({
    request: post({ ...validBody, presentationDone: 'Maybe' }),
    env,
  })
  assert.equal(invalidAnswer.status, 400)

  const invalidAnp = await onRequest({
    request: post({ ...validBody, anp: 'RM 1,200' }),
    env,
  })
  const result = await invalidAnp.json()
  assert.equal(invalidAnp.status, 400)
  assert.equal(result.error, 'ANP must be a number with no more than two decimal places')
})

test('rejects requests that are not JSON', async () => {
  const request = new Request('https://survey.example/api/submit-lead', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: '{}',
  })
  const response = await onRequest({ request, env })
  assert.equal(response.status, 415)
})

test('rejects a roadshow state outside West Malaysia', async () => {
  const response = await onRequest({
    request: post({ ...validBody, roadshowState: 'Sabah' }),
    env,
  })
  assert.equal(response.status, 400)
})

test('returns the Apps Script diagnostic when the destination reports an error', async () => {
  globalThis.fetch = async () => Response.json({
    success: false,
    error: 'Sheet header mismatch. Column 6 does not match',
  })

  const response = await onRequest({ request: post(), env })
  const result = await response.json()
  assert.equal(response.status, 502)
  assert.equal(result.error, 'Data destination reported an error')
  assert.equal(result.details, 'Sheet header mismatch. Column 6 does not match')
})
