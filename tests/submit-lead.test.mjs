import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { onRequest } from '../functions/api/submit-lead.js'

const originalFetch = globalThis.fetch
const env = {
  GOOGLE_SHEETS_WEBHOOK_URL: 'https://script.google.com/macros/s/test-deployment/exec',
}
const submissionId = '123e4567-e89b-12d3-a456-426614174000'

const validBody = {
  action: 'create',
  date: '2026-07-14',
  roadshowLocation: '  Kuala Lumpur Convention Centre  ',
  roadshowState: 'Kuala Lumpur',
  fullName: 'Test Person',
  mobileNumber: '+60 12 345 6789',
  icLast4: '1234',
  agentName: 'Test Agent',
  agentId: 'GE123',
  agentEmail: 'agent@example.com',
  gmName: 'Test GM',
  currentInsuranceCompany: '',
  ageBand: '25-34',
  maritalStatus: 'Single',
  employmentType: 'Salaried',
  monthlyPersonalIncome: 'RM3-6k',
  existingInsurancePlans: ['Medical Card'],
  financialPriorities: ['Build emergency fund'],
  consent: true,
}

const validCompletion = {
  action: 'complete',
  submissionId,
  presentationDone: 'Yes',
  potentialFollowUp: 'No',
  onTheSpotCloseCase: 'No',
  anp: '',
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

test('creates a lead and returns its submission ID', async () => {
  let forwardedUrl
  let forwardedPayload
  globalThis.fetch = async (url, options) => {
    forwardedUrl = url
    forwardedPayload = JSON.parse(options.body)
    return Response.json({ success: true, submissionId })
  }

  const response = await onRequest({ request: post(), env })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { success: true, submissionId })
  assert.equal(forwardedUrl, env.GOOGLE_SHEETS_WEBHOOK_URL)
  assert.deepEqual(Object.keys(forwardedPayload), [
    'action',
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
  ])
  assert.equal(forwardedPayload.action, 'create')
  assert.equal(forwardedPayload.agentEmail, 'agent@example.com')
  assert.equal(forwardedPayload.roadshowLocation, 'Kuala Lumpur Convention Centre')
  assert.equal('consent' in forwardedPayload, false)
})

test('allows every Your Profile field to be blank', async () => {
  let forwardedPayload
  globalThis.fetch = async (_url, options) => {
    forwardedPayload = JSON.parse(options.body)
    return Response.json({ success: true, submissionId })
  }

  const response = await onRequest({
    request: post({
      ...validBody,
      ageBand: '',
      maritalStatus: '',
      employmentType: '',
      monthlyPersonalIncome: '',
      existingInsurancePlans: [],
      financialPriorities: [],
    }),
    env,
  })
  assert.equal(response.status, 200)
  assert.equal(forwardedPayload.ageBand, '')
  assert.equal(forwardedPayload.existingInsurancePlans, '')
  assert.equal(forwardedPayload.financialPriorities, '')
})

test('forwards only the submission ID and four outcome fields when completing a lead', async () => {
  let forwardedPayload
  globalThis.fetch = async (_url, options) => {
    forwardedPayload = JSON.parse(options.body)
    return Response.json({ success: true })
  }

  const response = await onRequest({ request: post(validCompletion), env })
  assert.equal(response.status, 200)
  assert.deepEqual(Object.keys(forwardedPayload), [
    'action',
    'submissionId',
    'presentationDone',
    'potentialFollowUp',
    'onTheSpotCloseCase',
    'anp',
  ])
  assert.deepEqual(forwardedPayload, validCompletion)
})

test('rejects invalid popup answers and ANP values', async () => {
  const invalidAnswer = await onRequest({
    request: post({ ...validCompletion, presentationDone: 'Maybe' }),
    env,
  })
  assert.equal(invalidAnswer.status, 400)

  const invalidAnp = await onRequest({
    request: post({ ...validCompletion, onTheSpotCloseCase: 'Yes', anp: 'RM 1,200' }),
    env,
  })
  const result = await invalidAnp.json()
  assert.equal(invalidAnp.status, 400)
  assert.equal(result.error, 'ANP must be a number with no more than two decimal places')
})

test('requires ANP only for an on-the-spot close', async () => {
  const missingForYes = await onRequest({
    request: post({ ...validCompletion, onTheSpotCloseCase: 'Yes', anp: '' }),
    env,
  })
  assert.equal(missingForYes.status, 400)

  let forwardedPayload
  globalThis.fetch = async (_url, options) => {
    forwardedPayload = JSON.parse(options.body)
    return Response.json({ success: true })
  }
  const noClose = await onRequest({ request: post(validCompletion), env })
  assert.equal(noClose.status, 200)
  assert.equal(forwardedPayload.anp, '')
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

test('rejects an invalid agent email address', async () => {
  const response = await onRequest({
    request: post({ ...validBody, agentEmail: 'not-an-email' }),
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
