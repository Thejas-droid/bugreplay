# Present BugReplay in three minutes

## 0:00 — Explain the problem

“Someone reports that a button did nothing. The developer needs the steps, browser, error, and API activity. BugReplay records those clues into a portable local file.”

Open the viewer at `http://localhost:5174`. Choose **Explore an example**. Point out the fictional example label, summary, and readable steps. Explain that a recording is a `.bugreplay` file, not a video.

## 0:40 — Capture a real practice session

Open `http://localhost:5173`, choose **Checkout stops**, and start recording. Enter `SAVE20`, apply the coupon, then place the order. The page intentionally fails. Describe the problem and stop/save.

The checkout is simulated. Its APIs run locally. No purchase occurs.

## 1:20 — Understand the recording

Open the downloaded file in the viewer. Read the summary and steps. Select the error to reveal the stack and nearby click/request activity. Open **Network** and inspect the coupon response.

“Someone can understand the story first, while a developer can inspect the technical details.”

Open **Privacy**. Explain that fields and common secrets are masked, but the report still needs review before sharing.

## 2:00 — Share a useful report

Choose **Share report**. Add what should have happened. Copy or download the Markdown report. Explain that GitHub/Jira submission is optional, requires a destination/token and explicit confirmation, and never automatically uploads the recording.

## 2:30 — Explain replay and regression prevention

Open **Replay** to show the prepared command and the Playwright script download.

“A developer can repeat the actions against a local build, check for the original error, and turn the sequence into a starting regression test.”

Explain the boundaries: this command runs separately, a confidence estimate is not a successful replay, hidden data may need fixtures, and generated scripts need meaningful assertions. Full-page extension recording recovery and advanced reconstruction remain release gaps; see the PRD audit.

## Before a presentation

Start both apps with `pnpm dev`. Download a fresh practice recording if needed. Keep the example available as a fallback. If you plan to demonstrate replay live, prepare the browser and establish runtime acceptance beforehand; no replay or validation runs were performed during this improvement pass.
