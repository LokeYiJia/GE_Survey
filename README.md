# Lead Gathering Survey

A mobile-friendly React survey that sends submissions through a Cloudflare Pages Function to a Google Apps Script Web App, which appends each lead to Google Sheets. The Google webhook URL remains server-side.

## Run locally

Requirements: Node.js 20.19+ (or 22.12+) and npm.

```bash
npm install
npm run dev
```

Run the Cloudflare Function tests with:

```bash
npm test
```

Vite alone serves the frontend but does not emulate Pages Functions. To test the complete flow locally, install Wrangler, build, and run Pages locally:

```bash
npm install
npm run build
npx wrangler pages dev dist
```

For local full-flow testing, create an uncommitted `.dev.vars` file:

```dotenv
GOOGLE_SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
```

## Set up Google Sheets and Apps Script

1. Create or open the destination Google Sheet.
2. Name the target tab exactly `Leads Gathering`.
3. Add these headers to row 1 in this exact order:

   1. Date
   2. Roadshow Location
   3. Roadshow State
   4. Full Name
   5. Mobile Number
   6. IC Num (last 4 digits)
   7. Agent Name
   8. Agent ID
   9. Agent Email
   10. GM Name
   11. Current Insurance Company
   12. Age Band
   13. Marital Status
   14. Employment Type
   15. Monthly Income
   16. Existing Insurance Plan
   17. Financial Priorities in the next 12 months
   18. Presentation Done
   19. Potential Follow Up
   20. On the Spot Close Case
   21. ANP
   22. Submission Timestamp
   23. Submission ID
   24. Email Sent Timestamp

4. In the Sheet, select **Extensions → Apps Script**.
5. Replace the editor contents with [`google-apps-script/Code.gs`](google-apps-script/Code.gs) and save.
6. Select **Deploy → New deployment**, choose **Web app**, execute as yourself, and set access to **Anyone**.
7. Authorize the script and copy the deployed Web App URL ending in `/exec`. Keep it private.

The script verifies all 24 headers. The first submit appends the 17 lead fields, four blank outcome cells, a server-generated timestamp, a unique submission ID, and a blank email-sent timestamp. The popup submit uses that ID to update only the four outcome cells in the same row. It reads row 1 for validation but never writes to or changes it. The `Submission ID` and `Email Sent Timestamp` columns can be hidden in Google Sheets. If the script changes later, create a new deployment version from **Manage deployments**.

## Send grouped agent reports

After saving the Apps Script, reload the Google Sheet. An **Agent Reports** menu will appear next to **Extensions**. Select **Agent Reports → Send unsent agent reports** to send one consolidated table to each unique Agent Email. For example, three completed rows assigned to the same address are sent in one email, not three emails.

Only completed popup submissions with a valid Agent Email and a blank `Email Sent Timestamp` are included. ANP is required for reporting only when `On the Spot Close Case` is `Yes`. After each agent's email succeeds, the included rows are stamped so they are not sent again. The first run will ask the Google account that owns the script to authorize email sending.

## Deploy to Cloudflare Pages

1. Push this project to a Git provider and create a Cloudflare Pages project for the repository.
2. Use `npm run build` as the build command and `dist` as the output directory.
3. In the Pages project, open **Settings → Environment variables** and add this encrypted variable for Production (and Preview if needed):
   - `GOOGLE_SHEETS_WEBHOOK_URL`: the Apps Script `/exec` URL.
4. Redeploy after adding or changing variables.

The browser posts only to `/api/submit-lead`. Cloudflare validates and cleans both stages, then forwards either the lead creation data or the four outcome fields and submission ID to Apps Script. All questions in `Your Profile` are optional. ANP appears and is required only when `On the Spot Close Case` is `Yes`; it remains blank when the answer is `No`.

## Test a submission

1. Open the deployed Pages URL.
2. Complete every required field, select at least one insurance plan and priority, and accept consent.
3. Submit and confirm the success message appears.
4. Verify a new row appears in `Leads Gathering` with values under the correct headers.
5. For a negative test, omit a required field and confirm that the form prevents submission.

Never commit `.dev.vars`, `.env`, or a real webhook URL. `.env.example` documents the variable name only.
