const REQUIRED_TEXT_FIELDS = [
  'date', 'venue', 'fullName', 'mobileNumber', 'icLast4', 'agentName',
  'agentId', 'ageBand', 'maritalStatus', 'employmentType',
  'monthlyPersonalIncome', 'formAccessCode',
]

const ALLOWED_VALUES = {
  ageBand: ['<25', '25-34', '35-44', '45-54', '55-64', '65+'],
  maritalStatus: ['Single', 'Married', 'Married with children', 'Divorced / widowed'],
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

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
})

const cleanText = (value) => typeof value === 'string' ? value.trim() : ''
const validArray = (value, allowed) => Array.isArray(value)
  && value.length > 0
  && value.every((item) => typeof item === 'string' && allowed.includes(item))

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') {
    return json({ success: false, error: 'Method not allowed' }, 405)
  }

  if (!env.FORM_ACCESS_CODE || !env.GOOGLE_SHEETS_WEBHOOK_URL) {
    console.error('Required server environment variables are missing')
    return json({ success: false, error: 'Server configuration error' }, 500)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ success: false, error: 'Invalid JSON body' }, 400)
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ success: false, error: 'Invalid request body' }, 400)
  }

  for (const field of REQUIRED_TEXT_FIELDS) {
    if (!cleanText(body[field])) return json({ success: false, error: `Missing required field: ${field}` }, 400)
  }
  if (body.consent !== true) return json({ success: false, error: 'Consent is required' }, 400)
  if (!/^\+?[0-9 ]+$/.test(cleanText(body.mobileNumber))) return json({ success: false, error: 'Invalid mobile number' }, 400)
  if (!/^\d{4}$/.test(cleanText(body.icLast4))) return json({ success: false, error: 'IC last 4 must contain exactly 4 numbers' }, 400)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanText(body.date))) return json({ success: false, error: 'Invalid date' }, 400)
  if (!ALLOWED_VALUES.ageBand.includes(cleanText(body.ageBand))
    || !ALLOWED_VALUES.maritalStatus.includes(cleanText(body.maritalStatus))
    || !ALLOWED_VALUES.monthlyPersonalIncome.includes(cleanText(body.monthlyPersonalIncome))) {
    return json({ success: false, error: 'Invalid profile selection' }, 400)
  }
  const employmentType = cleanText(body.employmentType)
  const standardEmploymentTypes = ['Salaried', 'Self-employed', 'Business owner', 'Homemaker', 'Retired', 'Student']
  if (!standardEmploymentTypes.includes(employmentType)
    && !(employmentType.startsWith('Others: ') && employmentType.slice(8).trim())) {
    return json({ success: false, error: 'Invalid employment type' }, 400)
  }
  if (!validArray(body.existingInsurancePlans, ALLOWED_VALUES.existingInsurancePlans)
    || !validArray(body.financialPriorities, ALLOWED_VALUES.financialPriorities)) {
    return json({ success: false, error: 'Invalid or missing checkbox selection' }, 400)
  }
  if (cleanText(body.formAccessCode) !== env.FORM_ACCESS_CODE) {
    return json({ success: false, error: 'Invalid access code' }, 403)
  }

  const payload = {
    date: cleanText(body.date),
    venue: cleanText(body.venue),
    fullName: cleanText(body.fullName),
    mobileNumber: cleanText(body.mobileNumber),
    icLast4: cleanText(body.icLast4),
    caseClosedPolicyNumber: cleanText(body.caseClosedPolicyNumber),
    agentName: cleanText(body.agentName),
    agentId: cleanText(body.agentId),
    currentInsuranceCompany: cleanText(body.currentInsuranceCompany),
    ageBand: cleanText(body.ageBand),
    maritalStatus: cleanText(body.maritalStatus),
    employmentType: cleanText(body.employmentType),
    monthlyPersonalIncome: cleanText(body.monthlyPersonalIncome),
    existingInsurancePlans: body.existingInsurancePlans.map(cleanText).join(', '),
    financialPriorities: body.financialPriorities.map(cleanText).join(', '),
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
