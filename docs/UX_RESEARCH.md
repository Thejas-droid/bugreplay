# UI/UX research and implemented decisions

The goal is to let a first-time user explain BugReplay and complete its local workflow without knowing browser instrumentation, trace formats, or Playwright. This research combines usability principles, accessibility guidance, and a comparable debugging product’s interaction model. It is desk research, not a user study; the conclusions below are design hypotheses until evaluated with users.

## Findings applied to the product

### 1. Begin with a task, not an empty technical tool

[NN/g: Onboarding tutorials vs. contextual help](https://www.nngroup.com/articles/onboarding-tutorials/) recommends assistance in the context of the user’s task. A long introduction requires users to remember information before they can use it.

**Implementation:** the starting screen explains what a recording helps you do, offers two clear actions (open a recording or explore an example), and provides a short three-step workflow. The example is interactive and needs no external file or account. The practice checkout presents its next action beside the recording controls. Help remains available at the point where the user needs it.

**Expected benefit:** someone who has never used a trace viewer can see a complete report before learning how to make one. Example data is visibly labelled and cannot create real issues.

### 2. Put the story before raw data

[NN/g: Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) describes prioritizing primary tasks while making less frequent details available on demand.

**Implementation:** overview shows the marked problem, counts, readable steps, and environment. Raw JSON, browser identifiers, and credentials for direct issue submission live behind explicit details controls. Replay setup is separate from inspection. The snapshot view shows escaped structure rather than executing captured HTML.

**Expected benefit:** a non-developer gets a useful summary without having to interpret event namespaces or stack traces, while a developer can still inspect the underlying evidence.

### 3. Make choices visible and familiar

[NN/g: Recognition rather than recall](https://www.nngroup.com/articles/recognition-and-recall/) explains why visible choices and contextual cues reduce memory demands. [NN/g: Ten usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) also emphasizes familiar language, visibility of system status, user control, and recovery.

**Implementation:** persistent labelled navigation, six named practice scenarios, plain-language event summaries, numbered reproduction steps, visible recording state, a session timer, pause/resume, and fixed recorder/viewer addresses. Frequent input events are collapsed into a final readable input step in reports. Users can reopen a file and bookmark moments in memory.

**Expected benefit:** the workflow is presentable without narrating internal architecture. “Page slowdowns” and “What should have happened?” communicate useful concepts before introducing technical terminology.

### 4. Reveal context around a failure

[Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer) brings actions, snapshots, logs, and requests together so developers can inspect what happened around an action.

**Implementation:** selecting an event opens a detail panel with the readable action, element hints, relevant captured request data, and activity within two seconds. The list is virtualized. Views separate errors, requests, and performance; searches can filter by content, problems, or bookmarks.

**Expected benefit:** users can connect a failed checkout to the nearby click and request without manually searching unrelated raw records. The UI explicitly says temporal proximity does not establish causation.

**Current difference:** there is no visual DOM playback or recorded-versus-replay diff view. Page structure is safely shown as text. Large-file decoding uses a worker, but filtering still happens in the UI thread; responsiveness at 100,000 events has not been measured.

### 5. Explain errors and recovery in place

[W3C: User notifications](https://www.w3.org/WAI/tutorials/forms/notifications/) calls for understandable feedback and instructions for resolving errors. [W3C: Forms tutorial](https://www.w3.org/WAI/tutorials/forms/) recommends clear labels and instructions.

**Implementation:** file import handles wrong extensions, unsupported/damaged files, excessive file size, and loading failure with recovery guidance. Clipboard failure offers downloading or manual copying. Invalid replay addresses receive an inline message. Tracker errors offer a local report fallback. Fields have visible labels; native required/email/URL validation supplements the messages. Report submission requires reviewing the destination and explicitly confirming.

**Expected benefit:** a failed import, blocked clipboard, or blocked Jira request does not become a dead end.

### 6. Make dynamic status available to assistive technology

[W3C: WCAG status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) distinguishes communicating results from moving focus. [W3C: Modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) describes contained focus, Escape dismissal, and focus restoration.

**Implementation:** loading/copy/save feedback uses status regions, failures use alerts, search result counts announce updates, and the event inspector uses a native modal dialog. It has a visible close button and Escape support. Focus moves to the section heading after navigation. Skip links, text labels, visible focus indicators, native form controls, and reduced-motion rules are included. Status is communicated with text as well as color.

**Expected benefit:** keyboard and screen-reader users have an explicit route through the workflow. These choices do not establish WCAG compliance; accessibility still needs manual verification with assistive technology.

### 7. Keep the product usable at narrow widths

The mobile viewer previously hid its navigation entirely. The revised layout retains all section choices in a horizontally scrollable navigation bar, stacks complex panels, and keeps the inspector within the viewport. The recorder moves above the practice checkout on small screens. Forms and common actions have generous control heights.

**Expected benefit:** a user can navigate, import, inspect, and prepare a report on a small window without losing sections. Small event labels are supplementary; the main action text stays visible.

### 8. Make privacy and replay claims precise

User trust depends on understandable boundaries. The UI says files are processed locally, reports are sent only on explicit submission, and a redaction count is not proof that all private information was removed. The capture confidence estimate is explicitly separated from an actual replay result. Screenshot absence, missing response bodies, hidden inputs, and partial recordings have understandable empty/error states.

The [Chrome content script documentation](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) explains isolated and main execution worlds. This shaped the extension change: injection occurs only after a popup action, the recorder executes in the page world to observe page APIs, and privileged actions stay in the extension. No page-to-background message bridge can request downloads or issue creation.

## Visual direction

A restrained green and warm neutral palette, clear typography, modest borders, and generous spacing make the tool feel calm and readable. A bright summary surface draws attention to the problem; restrained red identifies failures. Count cards link to useful detail rather than functioning as decorative metrics. Native controls and CSS/SVG-free geometric treatments keep the interface independent of hosted images, fonts, icon downloads, or new UI frameworks.

## Proposed acceptance tasks (not executed)

These are evaluation criteria, not completed tests:

1. A newcomer can explain the purpose after opening the starting screen.
2. A newcomer can explore the example, identify the problem, and find the preceding action without help.
3. Someone can start a recording, trigger the checkout failure, save it, and open it in the viewer using visible guidance.
4. Someone can add an expected outcome and download a report without entering a token.
5. A keyboard user can reach each section, open/close the inspector, and return to the selected event.
6. A damaged file or blocked clipboard leaves the user with a clear alternative.
7. Users distinguish a capture confidence estimate from proof of successful replay.
8. On a narrow viewport, every section and recording control remains reachable.

Measure task success, time, errors, and the explanations users give. Avoid claiming that the product is understandable to everyone without evaluating these tasks with representative users.
