# Lead Gathering Survey

A mobile-friendly React survey that sends submissions through a Cloudflare Pages Function to a Google Apps Script Web App, which appends each lead to Google Sheets. The Google webhook URL and access code remain server-side.

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
FORM_ACCESS_CODE=your-private-code
```

## Set up Google Sheets and Apps Script

1. Create or open the destination Google Sheet.
2. Name the target tab exactly `Leads Gathering`.
3. Add these headers to row 1 in this exact order (including the source spelling `Maritial Status`):

   1. Date
   2. Venue
   3. Full Name
   4. Mobile Number
   5. IC Number (last 4 digits)
   6. Case Closed (Policy Number)
   7. Agent Name
   8. Agent ID
   9. Current Insurance Company
   10. Age Band
   11. Maritial Status
   12. Employment type
   13. Monthly Personal Income
   14. Existing insurance plans
   15. Financial Priorities in the next 12 months

4. In the Sheet, select **Extensions → Apps Script**.
5. Replace the editor contents with [`google-apps-script/Code.gs`](google-apps-script/Code.gs) and save.
6. Select **Deploy → New deployment**, choose **Web app**, execute as yourself, and set access to **Anyone**.
7. Authorize the script and copy the deployed Web App URL ending in `/exec`. Keep it private.

The script verifies the 15 existing headers, then uses `appendRow` to add submissions below them. It reads row 1 for validation but never writes to or changes it. If the script changes later, create a new deployment version from **Manage deployments**.

## Deploy to Cloudflare Pages

1. Push this project to a Git provider and create a Cloudflare Pages project for the repository.
2. Use `npm run build` as the build command and `dist` as the output directory.
3. In the Pages project, open **Settings → Environment variables** and add these encrypted variables for Production (and Preview if needed):
   - `GOOGLE_SHEETS_WEBHOOK_URL`: the Apps Script `/exec` URL.
   - `FORM_ACCESS_CODE`: a strong private code shared only with authorized form users. Use a long, unpredictable value rather than a short PIN.
4. Redeploy after adding or changing variables.

The browser posts only to `/api/submit-lead`. Cloudflare checks `FORM_ACCESS_CODE`, validates and cleans the payload, removes the code, then forwards the survey fields to Apps Script.

## Test a submission

1. Open the deployed Pages URL.
2. Complete every required field, select at least one insurance plan and priority, accept consent, and enter the configured access code.
3. Submit and confirm the success message appears.
4. Verify a new row appears in `Leads Gathering` with values under the correct headers.
5. For a negative test, use a wrong code and confirm the form shows an error, retains its values, and no row is appended.

Never commit `.dev.vars`, `.env`, a real webhook URL, or a real access code. `.env.example` documents variable names only.
