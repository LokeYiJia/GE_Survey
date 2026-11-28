const MAX_BODY_BYTES = 20_000

const BASE_REQUIRED_TEXT_FIELDS = [
  'date', 'roadshowLocation', 'roadshowState', 'fullName', 'mobileNumber', 'icLast4', 'agentName',
  'agentId', 'agentEmail',
]

const BASE_FIELD_LIMITS = {
  date: 10,
  roadshowLocation: 150,
  roadshowState: 100,
  fullName: 150,
  mobileNumber: 30,
  icLast4: 4,
  agentName: 150,
  agentId: 80,
  agentEmail: 254,
  gmName: 150,
  currentInsuranceCompany: 150,
  ageBand: 10,
  maritalStatus: 30,
  employmentType: 110,
  monthlyPersonalIncome: 20,
}

const OUTCOME_FIELD_LIMITS = {
  presentationDone: 3,
  potentialFollowUp: 3,
  onTheSpotCloseCase: 3,
}

const ALLOWED_VALUES = {
  roadshowLocation: [
    'BP Expo',
    'Live Expo',
    'Lotus E-Gate',
    'Food Bayana',
  ],
  roadshowState: [
    'Johor', 'Kedah', 'Kelantan', 'Melaka', 'Negeri Sembilan', 'Pahang',
    'Pulau Pinang', 'Perak', 'Perlis', 'Selangor', 'Terengganu',
    'Kuala Lumpur', 'Putrajaya',
  ],
  ageBand: ['<25', '25-34', '35-44', '45-54', '55-64', '65+'],
  maritalStatus: ['Single', 'Married', 'Married with children', 'Divorced / widowed'],
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

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
}

function cleanAllowedArray(value, allowedValues) {
  if (!Array.isArray(value)) return null
  if (value.length === 0) return []
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

function isAllowedGoogleRedirect(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && (url.hostname === 'script.google.com'
        || url.hostname === 'script.googleusercontent.com'
        || url.hostname.endsWith('.googleusercontent.com'))
  } catch {
    return false
  }
}

async function fetchGoogleAppsScript(url, options) {
  const response = await fetch(url, { ...options, redirect: 'manual' })
  if (![301, 302, 303, 307, 308].includes(response.status)) return response

  const location = response.headers.get('location')
  const redirectUrl = location ? new URL(location, url).toString() : ''
  if (!isAllowedGoogleRedirect(redirectUrl)) {
    throw new Error('Google Apps Script returned an invalid redirect')
  }

  const preserveRequest = response.status === 307 || response.status === 308
  return fetch(redirectUrl, preserveRequest
    ? { ...options, redirect: 'follow' }
    : { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'follow' })
}

function upstreamSummary(response) {
  let finalHost = 'unknown'
  try {
    if (response.url) finalHost = new URL(response.url).hostname
  } catch {
    // Keep the diagnostic host generic.
  }
  return `HTTP ${response.status}, content-type ${response.headers.get('content-type') || 'unknown'}, host ${finalHost}`
}

async function destinationHealth(url) {
  try {
    const response = await fetchGoogleAppsScript(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    const responseText = await response.text()
    let result = null
    try {
      result = JSON.parse(responseText)
    } catch {
      // The diagnostic below intentionally does not expose Google's HTML.
    }

    if (response.ok && result?.success === true && result?.service) {
      return json({
        success: true,
        destination: {
          service: cleanText(result.service),
          build: cleanText(result.build),
          sheet: cleanText(result.destinationSheet),
        },
      })
    }

    return json({
      success: false,
      error: 'Apps Script health check failed',
      details: upstreamSummary(response),
    }, 502)
  } catch (error) {
    return json({
      success: false,
      error: 'Unable to reach Apps Script',
      details: error instanceof Error ? error.message : 'Unknown destination error',
    }, 502)
  }
}

export async function onRequest({ request, env }) {
  if (!isGoogleAppsScriptUrl(env.GOOGLE_SHEETS_WEBHOOK_URL)) {
    console.error('Google Apps Script environment variable is missing or invalid')
    return json({ success: false, error: 'Server configuration error' }, 500)
  }

  if (request.method === 'GET') {
    return destinationHealth(env.GOOGLE_SHEETS_WEBHOOK_URL)
  }
  if (request.method !== 'POST') {
    return json({ success: false, error: 'Method not allowed' }, 405, { Allow: 'GET, POST' })
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

  const action = cleanText(body.action)
  let payload

  if (action === 'create') {
    const cleaned = Object.fromEntries(
      Object.keys(BASE_FIELD_LIMITS).map((field) => [field, cleanText(body[field])]),
    )

    for (const field of BASE_REQUIRED_TEXT_FIELDS) {
      if (!cleaned[field]) {
        return json({ success: false, error: `Missing required field: ${field}` }, 400)
      }
    }
    for (const [field, limit] of Object.entries(BASE_FIELD_LIMITS)) {
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
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned.agentEmail)) {
      return json({ success: false, error: 'Invalid agent email address' }, 400)
    }
    if (!isValidDate(cleaned.date)) return json({ success: false, error: 'Invalid date' }, 400)

    if (!ALLOWED_VALUES.roadshowLocation.includes(cleaned.roadshowLocation)) {
      return json({ success: false, error: 'Invalid roadshow location' }, 400)
    }

    if (!ALLOWED_VALUES.roadshowState.includes(cleaned.roadshowState)) {
      return json({ success: false, error: 'Invalid roadshow state' }, 400)
    }

    if ((cleaned.ageBand && !ALLOWED_VALUES.ageBand.includes(cleaned.ageBand))
      || (cleaned.maritalStatus && !ALLOWED_VALUES.maritalStatus.includes(cleaned.maritalStatus))
      || (cleaned.monthlyPersonalIncome && !ALLOWED_VALUES.monthlyPersonalIncome.includes(cleaned.monthlyPersonalIncome))) {
      return json({ success: false, error: 'Invalid profile selection' }, 400)
    }

    const isStandardEmployment = !cleaned.employmentType
      || ALLOWED_VALUES.employmentType.includes(cleaned.employmentType)
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
      return json({ success: false, error: 'Invalid checkbox selection' }, 400)
    }

    payload = {
      action,
      date: cleaned.date,
      roadshowLocation: cleaned.roadshowLocation,
      roadshowState: cleaned.roadshowState,
      fullName: cleaned.fullName,
      mobileNumber: cleaned.mobileNumber,
      icLast4: cleaned.icLast4,
      agentName: cleaned.agentName,
      agentId: cleaned.agentId,
      agentEmail: cleaned.agentEmail,
      gmName: cleaned.gmName,
      currentInsuranceCompany: cleaned.currentInsuranceCompany,
      ageBand: cleaned.ageBand,
      maritalStatus: cleaned.maritalStatus,
      employmentType: cleaned.employmentType,
      monthlyPersonalIncome: cleaned.monthlyPersonalIncome,
      existingInsurancePlans: existingInsurancePlans.join(', '),
      financialPriorities: financialPriorities.join(', '),
    }
  } else if (action === 'complete') {
    const submissionId = cleanText(body.submissionId)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(submissionId)) {
      return json({ success: false, error: 'Invalid submission ID' }, 400)
    }

    const cleaned = Object.fromEntries(
      Object.keys(OUTCOME_FIELD_LIMITS).map((field) => [field, cleanText(body[field])]),
    )
    for (const [field, limit] of Object.entries(OUTCOME_FIELD_LIMITS)) {
      if (!cleaned[field]) return json({ success: false, error: `Missing required field: ${field}` }, 400)
      if (cleaned[field].length > limit) {
        return json({ success: false, error: `Field is too long: ${field}` }, 400)
      }
    }
    cleaned.anp = cleanText(body.anp)
    if (cleaned.anp.length > 20) {
      return json({ success: false, error: 'Field is too long: anp' }, 400)
    }
    if (![cleaned.presentationDone, cleaned.potentialFollowUp, cleaned.onTheSpotCloseCase]
      .every((value) => value === 'Yes' || value === 'No')) {
      return json({ success: false, error: 'Invalid Yes or No submission detail' }, 400)
    }
    if (cleaned.onTheSpotCloseCase === 'Yes' && !/^\d+(?:\.\d{1,2})?$/.test(cleaned.anp)) {
      return json({ success: false, error: 'ANP must be a number with no more than two decimal places' }, 400)
    }
    if (cleaned.onTheSpotCloseCase === 'No') cleaned.anp = ''

    payload = {
      action,
      submissionId,
      presentationDone: cleaned.presentationDone,
      potentialFollowUp: cleaned.potentialFollowUp,
      onTheSpotCloseCase: cleaned.onTheSpotCloseCase,
      anp: cleaned.anp,
    }
  } else {
    return json({ success: false, error: 'Invalid submission action' }, 400)
  }

  try {
    const webhookResponse = await fetchGoogleAppsScript(env.GOOGLE_SHEETS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!webhookResponse.ok) {
      console.error('Google Apps Script returned', webhookResponse.status)
      return json({ success: false, error: 'Data destination rejected the submission' }, 502)
    }

    const responseText = await webhookResponse.text()
    let result = null
    try {
      result = JSON.parse(responseText)
    } catch {
      // Do not expose HTML returned by a login or deployment error page.
    }
    if (!result || result.success !== true) {
      const details = typeof result?.error === 'string'
        ? result.error.slice(0, 500)
        : `Google Apps Script returned a non-JSON response (${upstreamSummary(webhookResponse)})`
      console.error('Google Apps Script reported an error:', details)
      return json({
        success: false,
        error: 'Data destination reported an error',
        details,
      }, 502)
    }
    if (action === 'create') {
      const submissionId = cleanText(result.submissionId)
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(submissionId)) {
        return json({ success: false, error: 'Data destination returned an invalid submission ID' }, 502)
      }
      return json({ success: true, submissionId })
    }
    return json({ success: true })
  } catch (error) {
    console.error('Webhook request failed', error)
    return json({ success: false, error: 'Unable to reach data destination' }, 502)
  }
}
