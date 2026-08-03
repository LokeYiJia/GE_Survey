import { useEffect, useRef, useState } from 'react'

const initialForm = {
  date: '', roadshowLocation: '', roadshowState: '', fullName: '', mobileNumber: '', icLast4: '',
  agentName: '', agentId: '', gmName: '',
  currentInsuranceCompany: '', ageBand: '', maritalStatus: '',
  employmentType: '', employmentTypeOther: '', monthlyPersonalIncome: '',
  existingInsurancePlans: [], financialPriorities: [], consent: false,
}

const initialSubmissionDetails = {
  presentationDone: '',
  potentialFollowUp: '',
  onTheSpotCloseCase: '',
  anp: '',
}

const options = {
  roadshowState: [
    'Johor', 'Kedah', 'Kelantan', 'Melaka', 'Negeri Sembilan', 'Pahang',
    'Pulau Pinang', 'Perak', 'Perlis', 'Selangor', 'Terengganu',
    'Kuala Lumpur', 'Putrajaya',
  ],
  ageBand: ['<25', '25-34', '35-44', '45-54', '55-64', '65+'],
  maritalStatus: ['Single', 'Married', 'Married with children', 'Divorced / widowed'],
  employmentType: ['Salaried', 'Self-employed', 'Business owner', 'Homemaker', 'Retired', 'Student', 'Others'],
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

function TextField({ label, name, required, autoComplete = 'off', ...props }) {
  return (
    <label className="field">
      <span>{label}{required && <b aria-hidden="true"> *</b>}</span>
      <input name={name} required={required} autoComplete={autoComplete} {...props} />
    </label>
  )
}

function SelectField({ label, name, value, values, onChange, required }) {
  return (
    <label className="field">
      <span>{label}{required && <b aria-hidden="true"> *</b>}</span>
      <select name={name} value={value} onChange={onChange} required={required} autoComplete="off">
        <option value="" disabled>Select a state</option>
        {values.map((option) => <option value={option} key={option}>{option}</option>)}
      </select>
    </label>
  )
}

function ChoiceGroup({ legend, name, values, selected, multiple = false, onChange, required }) {
  return (
    <fieldset className="choice-group">
      <legend>{legend}{required && <b aria-hidden="true"> *</b>}</legend>
      <div className={`choices ${values.length > 7 ? 'choices-wide' : ''}`}>
        {values.map((value) => (
          <label className="choice" key={value}>
            <input
              type={multiple ? 'checkbox' : 'radio'}
              name={name}
              value={value}
              checked={multiple ? selected.includes(value) : selected === value}
              onChange={onChange}
              required={required && !multiple}
            />
            <span>{value}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function Section({ number, title, children }) {
  return (
    <section className="form-section">
      <h2><span>{number}</span>{title}</h2>
      <div className="section-body">{children}</div>
    </section>
  )
}

export default function App() {
  const [form, setForm] = useState(initialForm)
  const [status, setStatus] = useState({ type: '', message: '' })
  const [submitting, setSubmitting] = useState(false)
  const [showSubmissionDetails, setShowSubmissionDetails] = useState(false)
  const [submissionDetails, setSubmissionDetails] = useState(initialSubmissionDetails)
  const submissionLock = useRef(false)
  const statusRef = useRef(null)
  const modalTitleRef = useRef(null)

  useEffect(() => {
    if (status.message) statusRef.current?.focus()
  }, [status.message])

  useEffect(() => {
    if (showSubmissionDetails) modalTitleRef.current?.focus()
  }, [showSubmissionDetails])

  const update = ({ target }) => {
    const { name, value, type, checked } = target
    if (status.message) setStatus({ type: '', message: '' })
    setForm((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }))
  }

  const updateMultiple = ({ target }) => {
    const { name, value, checked } = target
    if (status.message) setStatus({ type: '', message: '' })
    setForm((current) => ({
      ...current,
      [name]: checked
        ? [...current[name], value]
        : current[name].filter((item) => item !== value),
    }))
  }

  const updateSubmissionDetail = ({ target }) => {
    const { name, value } = target
    if (status.message) setStatus({ type: '', message: '' })
    setSubmissionDetails((current) => ({ ...current, [name]: value }))
  }

  const openSubmissionDetails = (event) => {
    event.preventDefault()
    if (submissionLock.current) return
    if (!form.existingInsurancePlans.length || !form.financialPriorities.length) {
      setStatus({ type: 'error', message: 'Please select at least one option in each required checkbox group.' })
      return
    }
    if (form.employmentType === 'Others' && !form.employmentTypeOther.trim()) {
      setStatus({ type: 'error', message: 'Please specify your employment type.' })
      return
    }

    setStatus({ type: '', message: '' })
    setShowSubmissionDetails(true)
  }

  const submit = async (event) => {
    event.preventDefault()
    if (submissionLock.current) return

    const anp = submissionDetails.anp.trim()
    if (!/^\d+(?:\.\d{1,2})?$/.test(anp)) {
      setStatus({ type: 'error', message: 'ANP must be a number with no more than two decimal places.' })
      return
    }

    submissionLock.current = true
    setSubmitting(true)
    setStatus({ type: '', message: '' })
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 20000)
    try {
      const payload = {
        ...form,
        ...submissionDetails,
        anp,
        employmentType: form.employmentType === 'Others'
          ? `Others: ${form.employmentTypeOther.trim()}`
          : form.employmentType,
      }
      delete payload.employmentTypeOther
      const response = await fetch('/api/submit-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      const result = await response.json().catch(() => null)
      if (!response.ok || result?.success !== true) {
        throw new Error(result?.details || '')
      }
      setForm(initialForm)
      setSubmissionDetails(initialSubmissionDetails)
      setShowSubmissionDetails(false)
      setStatus({ type: 'success', message: 'Survey submitted successfully. Thank you.' })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (error) {
      const details = error instanceof Error ? error.message.trim() : ''
      setStatus({
        type: 'error',
        message: details
          ? `Submission failed: ${details}`
          : 'Submission failed. Please try again or contact admin.',
      })
    } finally {
      window.clearTimeout(timeoutId)
      submissionLock.current = false
      setSubmitting(false)
    }
  }

  return (
    <main className="page-shell">
      <div className="survey-card">
        <header className="survey-header">
          <img
            className="brand-logo"
            src="/assets/great-eastern-ocbc-logo-v2.png"
            alt="Great Eastern — An OCBC Company"
          />
          <div>
            <h1>SURVEY FORM</h1>
          </div>
        </header>

        {status.message && !showSubmissionDetails && (
          <div
            ref={statusRef}
            className={`notice ${status.type}`}
            role={status.type === 'error' ? 'alert' : 'status'}
            aria-live={status.type === 'error' ? 'assertive' : 'polite'}
            tabIndex="-1"
          >
            {status.message}
          </div>
        )}

        <form onSubmit={openSubmissionDetails} aria-busy={submitting} autoComplete="off">
          <Section number="01" title="Personal Details">
            <div className="grid two-col">
              <div className="grid-full-width">
                <TextField label="Full Name" name="fullName" value={form.fullName} onChange={update} maxLength="150" required />
              </div>
              <TextField label="Mobile Number" name="mobileNumber" type="tel" value={form.mobileNumber} onChange={update} pattern="[+0-9 ]+" title="Use only numbers, spaces, and +" inputMode="tel" required />
              <TextField label="IC Number (last 4 digits)" name="icLast4" value={form.icLast4} onChange={update} pattern="[0-9]{4}" title="Enter exactly 4 numbers" inputMode="numeric" maxLength="4" required />
              <div className="grid-full-width">
                <TextField label="Current Insurance Company" name="currentInsuranceCompany" value={form.currentInsuranceCompany} onChange={update} maxLength="150" placeholder="If applicable" />
              </div>
            </div>
          </Section>

          <Section number="02" title="Your Profile">
            <ChoiceGroup legend="Age Band" name="ageBand" values={options.ageBand} selected={form.ageBand} onChange={update} required />
            <ChoiceGroup legend="Marital Status" name="maritalStatus" values={options.maritalStatus} selected={form.maritalStatus} onChange={update} required />
            <ChoiceGroup legend="Employment type" name="employmentType" values={options.employmentType} selected={form.employmentType} onChange={update} required />
            {form.employmentType === 'Others' && (
              <div className="conditional-field">
                <TextField label="Please specify" name="employmentTypeOther" value={form.employmentTypeOther} onChange={update} maxLength="100" required />
              </div>
            )}
            <ChoiceGroup legend="Monthly Personal Income" name="monthlyPersonalIncome" values={options.monthlyPersonalIncome} selected={form.monthlyPersonalIncome} onChange={update} required />
            <ChoiceGroup legend="Existing insurance plans" name="existingInsurancePlans" values={options.existingInsurancePlans} selected={form.existingInsurancePlans} onChange={updateMultiple} multiple required />
            <ChoiceGroup legend="Financial Priorities in the next 12 months" name="financialPriorities" values={options.financialPriorities} selected={form.financialPriorities} onChange={updateMultiple} multiple required />
          </Section>

          <Section number="03" title="For Agent Use">
            <div className="grid two-col">
              <TextField label="Date" name="date" type="date" value={form.date} onChange={update} required />
              <TextField label="Roadshow Location (e.g. Lotus Kepong)" name="roadshowLocation" value={form.roadshowLocation} onChange={update} maxLength="150" placeholder="Enter roadshow location" required />
              <div className="grid-full-width">
                <SelectField label="Roadshow State" name="roadshowState" value={form.roadshowState} values={options.roadshowState} onChange={update} required />
              </div>
              <TextField label="Agent Name" name="agentName" value={form.agentName} onChange={update} maxLength="150" required />
              <TextField label="Agent ID" name="agentId" value={form.agentId} onChange={update} maxLength="80" required />
              <div className="grid-full-width">
                <TextField label="GM Name" name="gmName" value={form.gmName} onChange={update} maxLength="150" required />
              </div>
            </div>
          </Section>

          <Section number="04" title="Consent & Submission">
            <label className="consent-box">
              <input type="checkbox" name="consent" checked={form.consent} onChange={update} required />
              <span>By participating in this survey and submitting your personal data, you consent to the collection, use, processing, and disclosure of your personal data for follow-up and advisory purposes. <b>*</b></span>
            </label>
            <button className="submit-button" type="submit" disabled={submitting}>
              {submitting ? <><span className="spinner" aria-hidden="true" /> Submitting…</> : 'Submit Survey'}
            </button>
          </Section>
        </form>
        <footer>Thank you for taking the time to complete this survey.</footer>
      </div>

      {showSubmissionDetails && (
        <div className="modal-backdrop">
          <form
            className="submission-modal"
            onSubmit={submit}
            role="dialog"
            aria-modal="true"
            aria-labelledby="submission-details-title"
            autoComplete="off"
          >
            <h2 id="submission-details-title" ref={modalTitleRef} tabIndex="-1">
              Submission Details
            </h2>
            <p>Complete these questions before submitting the survey.</p>

            <ChoiceGroup legend="Presentation done" name="presentationDone" values={['Yes', 'No']} selected={submissionDetails.presentationDone} onChange={updateSubmissionDetail} required />
            <ChoiceGroup legend="Potential follow up" name="potentialFollowUp" values={['Yes', 'No']} selected={submissionDetails.potentialFollowUp} onChange={updateSubmissionDetail} required />
            <ChoiceGroup legend="On the spot close case" name="onTheSpotCloseCase" values={['Yes', 'No']} selected={submissionDetails.onTheSpotCloseCase} onChange={updateSubmissionDetail} required />

            <TextField
              label="ANP"
              name="anp"
              value={submissionDetails.anp}
              onChange={updateSubmissionDetail}
              pattern="[0-9]+(?:\.[0-9]{1,2})?"
              title="Enter a number with no more than two decimal places"
              inputMode="decimal"
              maxLength="20"
              placeholder="0.00"
              required
            />

            {status.message && (
              <div ref={statusRef} className={`notice ${status.type}`} role="alert" aria-live="assertive" tabIndex="-1">
                {status.message}
              </div>
            )}

            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setShowSubmissionDetails(false)} disabled={submitting}>
                Back
              </button>
              <button className="submit-button" type="submit" disabled={submitting}>
                {submitting ? <><span className="spinner" aria-hidden="true" /> Submitting...</> : 'Confirm & Submit'}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}
