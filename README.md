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
   9. GM Name
   10. Current Insurance Company
   11. Age Band
   12. Marital Status
   13. Employment Type
   14. Monthly Income
   15. Existing Insurance Plan
   16. Financial Priorities in the next 12 months
   17. Presentation Done
   18. Potential Follow Up
   19. On the Spot Close Case
   20. ANP
   21. Submission Timestamp
   22. Submission ID

4. In the Sheet, select **Extensions → Apps Script**.
5. Replace the editor contents with [`google-apps-script/Code.gs`](google-apps-script/Code.gs) and save.
6. Select **Deploy → New deployment**, choose **Web app**, execute as yourself, and set access to **Anyone**.
7. Authorize the script and copy the deployed Web App URL ending in `/exec`. Keep it private.

The script verifies all 22 headers. The first submit appends the 16 lead fields, four blank outcome cells, a server-generated timestamp, and a unique submission ID. The popup submit uses that ID to update only the four outcome cells in the same row. It reads row 1 for validation but never writes to or changes it. The `Submission ID` column can be hidden in Google Sheets. If the script changes later, create a new deployment version from **Manage deployments**.

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
