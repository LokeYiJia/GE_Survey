import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { onRequest } from '../functions/api/submit-lead.js'

const originalFetch = globalThis.fetch
const env = {
  FORM_ACCESS_CODE: 'private-code',
  GOOGLE_SHEETS_WEBHOOK_URL: 'https://script.google.com/macros/s/test-deployment/exec',
}

const validBody = {
  date: '2026-07-14',
  venue: '  Kuala Lumpur Convention Centre  ',
  fullName: 'Test Person',
  mobileNumber: '+60 12 345 6789',
  icLast4: '1234',
  agentName: 'Test Agent',
  agentId: 'GE123',
  currentInsuranceCompany: '',
  ageBand: '25-34',
  maritalStatus: 'Single',
  employmentType: 'Salaried',
  monthlyPersonalIncome: 'RM3-6k',
  existingInsurancePlans: ['Medical Card'],
  financialPriorities: ['Build emergency fund'],
  consent: true,
  formAccessCode: 'private-code',
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

test('rejects an incorrect access code without calling the webhook', async () => {
  let webhookCalled = false
  globalThis.fetch = async () => {
    webhookCalled = true
    return new Response()
  }

  const response = await onRequest({
    request: post({ ...validBody, formAccessCode: 'wrong-code' }),
    env,
  })
  assert.equal(response.status, 403)
  assert.equal(webhookCalled, false)
})

test('forwards only the 14 cleaned Sheet fields in exact column order', async () => {
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
    'venue',
    'fullName',
    'mobileNumber',
    'icLast4',
    'agentName',
    'agentId',
    'currentInsuranceCompany',
    'ageBand',
    'maritalStatus',
    'employmentType',
    'monthlyPersonalIncome',
    'existingInsurancePlans',
    'financialPriorities',
  ])
  assert.equal(forwardedPayload.venue, 'Kuala Lumpur Convention Centre')
  assert.equal('formAccessCode' in forwardedPayload, false)
  assert.equal('consent' in forwardedPayload, false)
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
