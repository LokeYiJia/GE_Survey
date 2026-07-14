const MAX_BODY_BYTES = 20_000

const REQUIRED_TEXT_FIELDS = [
  'date', 'venue', 'fullName', 'mobileNumber', 'icLast4', 'agentName',
  'agentId', 'ageBand', 'maritialStatus', 'employmentType',
  'monthlyPersonalIncome', 'formAccessCode',
]

const FIELD_LIMITS = {
  date: 10,
  venue: 150,
  fullName: 150,
  mobileNumber: 30,
  icLast4: 4,
  caseClosedPolicyNumber: 80,
  agentName: 150,
  agentId: 80,
  currentInsuranceCompany: 150,
  ageBand: 10,
  maritialStatus: 30,
  employmentType: 110,
  monthlyPersonalIncome: 20,
  formAccessCode: 128,
}

const ALLOWED_VALUES = {
  ageBand: ['<25', '25-34', '35-44', '45-54', '55-64', '65+'],
  maritialStatus: ['Single', 'Married', 'Married with children', 'Divorced / widowed'],
  employmentType: ['Salaried', 'Self-employed', 'Business owner', 'Homemaker', 'Retired', 'Student'],
  monthlyPersonalIncome: ['<RM3k', 'RM3-6k', 'RM6-10k', 'RM10-20k', '>RM20k'],
  existingInsurancePlans: ['Medical Card', 'Life / Term', 'Critical Illness', 'Savings', 'Legacy', 'Not sure', "I don’t have one"],
  financialPriorities: [
    'Plan for kids’ education', 'Build emergency fund', 'Retirement savings',
    'Increase my savings', 'Venture into investment', 'Manage my debts better',
    'Reduce medical expenses risk', 'Protect income if I cannot work',
    'Plan for legacy / estate planning', 'Review and optimize current policies',
    'Accident and disability coverage', 'Critical illness planning',
  ],
}

const encoder = new TextEncoder()

const json = (data, status = 200, extraHeaders = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  },
})

const cleanText = (value) => typeof value === 'string' ? value.trim() : ''

function secretsMatch(input, expected) {
  const inputBytes = encoder.encode(input)
  const expectedBytes = encoder.encode(expected)
  const length = Math.max(inputBytes.length, expectedBytes.length)
  let mismatch = inputBytes.length ^ expectedBytes.length

  for (let index = 0; index < length; index += 1) {
    mismatch |= (inputBytes[index] || 0) ^ (expectedBytes[index] || 0)
  }
  return mismatch === 0
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
}

function cleanAllowedArray(value, allowedValues) {
  if (!Array.isArray(value) || value.length === 0) return null
  const cleaned = value.map(cleanText)
  if (new Set(cleaned).size !== cleaned.length) return null
  return cleaned.every((item) => allowedValues.includes(item)) ? cleaned : null
}

function isGoogleAppsScriptUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && url.hostname === 'script.google.com'
      && url.pathname.startsWith('/macros/s/')
      && url.pathname.endsWith('/exec')
  } catch {
    return false
  }
}

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') {
    return json({ success: false, error: 'Method not allowed' }, 405, { Allow: 'POST' })
  }

  if (!env.FORM_ACCESS_CODE || !isGoogleAppsScriptUrl(env.GOOGLE_SHEETS_WEBHOOK_URL)) {
    console.error('Required server environment variables are missing or invalid')
    return json({ success: false, error: 'Server configuration error' }, 500)
  }

  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return json({ success: false, error: 'Content-Type must be application/json' }, 415)
  }

  const declaredLength = Number(request.headers.get('content-length') || 0)
  if (declaredLength > MAX_BODY_BYTES) {
    return json({ success: false, error: 'Request body is too large' }, 413)
  }

  let body
  try {
    const rawBody = await request.text()
    if (encoder.encode(rawBody).length > MAX_BODY_BYTES) {
      return json({ success: false, error: 'Request body is too large' }, 413)
    }
    body = JSON.parse(rawBody)
  } catch {
    return json({ success: false, error: 'Invalid JSON body' }, 400)
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ success: false, error: 'Invalid request body' }, 400)
  }

  const cleaned = Object.fromEntries(
    Object.keys(FIELD_LIMITS).map((field) => [field, cleanText(body[field])]),
  )

  for (const field of REQUIRED_TEXT_FIELDS) {
    if (!cleaned[field]) {
      return json({ success: false, error: `Missing required field: ${field}` }, 400)
    }
  }
  for (const [field, limit] of Object.entries(FIELD_LIMITS)) {
    if (cleaned[field].length > limit) {
      return json({ success: false, error: `Field is too long: ${field}` }, 400)
    }
  }

  if (body.consent !== true) return json({ success: false, error: 'Consent is required' }, 400)

  const phoneDigits = cleaned.mobileNumber.replace(/\D/g, '')
  if (!/^\+?[0-9 ]+$/.test(cleaned.mobileNumber) || phoneDigits.length < 7 || phoneDigits.length > 15) {
    return json({ success: false, error: 'Invalid mobile number' }, 400)
  }
  if (!/^\d{4}$/.test(cleaned.icLast4)) {
    return json({ success: false, error: 'IC last 4 must contain exactly 4 numbers' }, 400)
  }
  if (!isValidDate(cleaned.date)) return json({ success: false, error: 'Invalid date' }, 400)

  if (!ALLOWED_VALUES.ageBand.includes(cleaned.ageBand)
    || !ALLOWED_VALUES.maritialStatus.includes(cleaned.maritialStatus)
    || !ALLOWED_VALUES.monthlyPersonalIncome.includes(cleaned.monthlyPersonalIncome)) {
    return json({ success: false, error: 'Invalid profile selection' }, 400)
  }

  const isStandardEmployment = ALLOWED_VALUES.employmentType.includes(cleaned.employmentType)
  const isSpecifiedOther = cleaned.employmentType.startsWith('Others: ')
    && cleaned.employmentType.slice(8).trim().length > 0
  if (!isStandardEmployment && !isSpecifiedOther) {
    return json({ success: false, error: 'Invalid employment type' }, 400)
  }

  const existingInsurancePlans = cleanAllowedArray(
    body.existingInsurancePlans,
    ALLOWED_VALUES.existingInsurancePlans,
  )
  const financialPriorities = cleanAllowedArray(
    body.financialPriorities,
    ALLOWED_VALUES.financialPriorities,
  )
  if (!existingInsurancePlans || !financialPriorities) {
    return json({ success: false, error: 'Invalid or missing checkbox selection' }, 400)
  }

  if (!secretsMatch(cleaned.formAccessCode, env.FORM_ACCESS_CODE)) {
    return json({ success: false, error: 'Invalid access code' }, 403)
  }

  const payload = {
    date: cleaned.date,
    venue: cleaned.venue,
    fullName: cleaned.fullName,
    mobileNumber: cleaned.mobileNumber,
    icLast4: cleaned.icLast4,
    caseClosedPolicyNumber: cleaned.caseClosedPolicyNumber,
    agentName: cleaned.agentName,
    agentId: cleaned.agentId,
    currentInsuranceCompany: cleaned.currentInsuranceCompany,
    ageBand: cleaned.ageBand,
    maritialStatus: cleaned.maritialStatus,
    employmentType: cleaned.employmentType,
    monthlyPersonalIncome: cleaned.monthlyPersonalIncome,
    existingInsurancePlans: existingInsurancePlans.join(', '),
    financialPriorities: financialPriorities.join(', '),
  }

  try {
    const webhookResponse = await fetch(env.GOOGLE_SHEETS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'follow',
    })
    if (!webhookResponse.ok) {
      console.error('Google Apps Script returned', webhookResponse.status)
      return json({ success: false, error: 'Data destination rejected the submission' }, 502)
    }

    const result = await webhookResponse.json().catch(() => null)
    if (!result || result.success !== true) {
      console.error('Unexpected Google Apps Script response')
      return json({ success: false, error: 'Data destination reported an error' }, 502)
    }
    return json({ success: true })
  } catch (error) {
    console.error('Webhook request failed', error)
    return json({ success: false, error: 'Unable to reach data destination' }, 502)
  }
}
