# Mastodon Architecture Explorer

CS 8371 Application Architecture: Architectural Analysis, AI-Assisted Prototyping, and Quality Assurance.

**Live site:** [Live]
**Video walkthrough:** [Video]

## Project description

**System analyzed:** [Mastodon](https://github.com/mastodon/mastodon), an open-source, federated social network server.

**Architectural style.** Mastodon is a Ruby on Rails monolith deployed as three processes: the web app (Puma), Sidekiq background workers (same codebase), and a separate Node.js streaming server. PostgreSQL is the source of truth and Redis holds home feeds, Sidekiq job queues and streaming data. On top of that it uses asynchronous job queues (work after the response goes to Sidekiq) and federation between servers over ActivityPub. It is not a microservices system.

**Components mapped:** clients (React and Redux web UI, third-party apps), nginx, Rails web app, streaming server, Sidekiq, PostgreSQL, Redis, media storage (local disk or S3-compatible, optional), search (Elasticsearch, optional), and remote servers.

**Prototype built.** A static web app with three parts:
1. **Component map:** click any component to see its role, technology, facts and the source for each fact.
2. **Post tracer:** write a post and follow it through seven steps (validate, save, queue, fan-out, streaming, federation, email). You can set the number of remote servers, make the post public or private, and break PostgreSQL, Redis or Sidekiq to see which steps are blocked or delayed. Input is validated (empty, whitespace, over 500 characters, bad numbers).
3. **AI fact-check log:** what the first AI draft assumed, what the official sources say, and the outcome.

The failure scenarios are reasoning from the docs, not tests on a live Mastodon server. The app says so on screen.

## Setup and run

No build step and no environment variables are needed.

```bash
git clone [YOUR REPO URL]
cd mastodon-architecture-explorer

# Option 1: open index.html directly in a browser

# Option 2: serve it locally
python3 -m http.server 8000      # then visit http://localhost:8000
# or: npx serve .

# Run the unit tests (Node 20 or newer)
npm test
```

## Deploy

Any static host works. On Vercel or Cloudflare Pages, import the GitHub repository, leave the build command empty and set the output directory to the project root.

## Project structure

| File | Purpose |
|---|---|
| `index.html` | Page structure and form labels |
| `styles.css` | Responsive styling, focus styles, status badges |
| `data.js` | Components, facts, sources and the fact-check log |
| `logic.js` | Input validation and the post trace (no DOM, unit tested) |
| `app.js` | DOM wiring |
| `test/logic.test.js` | 12 unit tests (validation, failures, edge cases) |

## AI disclosure and prompt appendix

**Tools used:** Claude (Anthropic), Sonnet 5.5. No other AI tools were used.

Act as a senior software architect. I am analyzing Mastodon for a university architecture assignment.

**Prompt 1 (assignment and system choice):** analysis: Identify Mastodon’s architectural style, its core components (compute, database, queues, cache, reverse proxy, streaming, storage, search), and how they communicate. For every claim, give the official documentation or source file it comes from. If you are not sure, say “unverified” instead of guessing.

**Prompt 2 (build):** Build a lightweight static web app (HTML, CSS and plain JavaScript, no build step) with an interactive component map and a “trace a post” tool that shows what happens when a user posts. Include input validation, keyboard-accessible controls, and a layout that works on mobile.

**Prompt 3:** Add unit tests for the logic and list the edge cases you tested.

### What was verified, corrected and customized

Checked against the [Mastodon docs](https://docs.joinmastodon.org/admin/scaling/), the [repository README](https://github.com/mastodon/mastodon), the source files `post_status_service.rb` and `distribution_worker.rb`, and the [SoftwareMill article](https://softwaremill.com/the-architecture-of-mastodon/).

| First AI assumption | What the sources say | Outcome |
|---|---|---|
| Redis is only a cache | Redis also stores Sidekiq job queues and supports streaming | Corrected |
| Rails serves real-time timelines | Streaming is a separate Node.js server | Corrected |
| One generic background queue | Named queues: default, push, ingress, mailers, pull, scheduler, fasp | Corrected |
| Version requirements are uniform | README gives minimums (PostgreSQL 14+, Redis 7.0+, Node.js 22+, Ruby 3.3+); the install guide uses newer versions | Corrected |
| The SoftwareMill article is complete and official | The author says they are new to the codebase; ActivityPub is confirmed by the README, not the article | Cross-checked |
| DistributionWorker runs on a specific queue | The file sets no queue; where it is configured was not visible | Left out (not verified) |
| Posting only saves and notifies | PostStatusService also validates media, mentions and antispam, supports an idempotency key, and enqueues several jobs | Corrected |

**My own work:**
- Chose Mastodon as the system to analyze and approved the plan for an interactive architecture explorer.
- Ran the app locally and tested the post tracer with a 54-character test post, 12 remote servers, a public post and everything healthy. The trace showed all steps, with the first three marked "Done" while the user waits.
- Tested an empty post. The text box turned red and the message "Write something first. A post cannot be empty." appeared.
- Tested a very long post (2,078 characters of pasted Lorem Ipsum text). The character counter turned red and the message "This post is 1578 characters over the 500 character limit." appeared, and no trace was run.
- Tested a bad server count by entering -3. The field showed the message "Use a whole number from 0 to 10000 (no decimals, signs or letters)."
- Checked one claim myself in the official [Mastodon scaling docs](https://docs.joinmastodon.org/admin/scaling/). The Queues section lists seven Sidekiq queues in descending importance: default, push, ingress, mailers, pull, scheduler and fasp. It says ingress has lower priority than default so local users still see their posts under load, and that Sidekiq checks queues in order, so an overfilled first queue can delay the others. It also says the default queues are stored in `config/sidekiq.yml`. This matched the AI's corrected claim in the fact-check log.
- Tested a broken component by selecting "Redis is unavailable". Steps 1 and 2 (validate, save to PostgreSQL) stayed "Done". Step 3 (queue jobs in Redis) showed "Blocked", and steps 4 to 7 (home feeds, streaming, remote servers, email) showed "Not run". This matches the docs: Redis holds the job queues, so nothing after the queue step can happen. It is reasoning from the docs, not a test on a live server.

**Customized by me:**
- Changed the page header color to blue in `styles.css`.

**Known limits:** the 500 character limit is Mastodon's default and servers can change it. The tracer counts plain characters and does not apply Mastodon's special counting for links and mentions. Search indexing is not in the trace because it was not visible in `post_status_service.rb`.

## QA checklist

Run these before recording and tick them off.

- [ ] **Functional:** map selection works; trace runs; reset clears the form; empty, whitespace-only, 501-character, long unbroken string and invalid server count inputs are handled.
- [ ] **UI and responsive:** checked at 1920x1080 and a phone width (390 px) in DevTools; no clipping or overlap.
- [ ] **Cross-browser and console:** tested in Chrome/Edge and Firefox or Safari; DevTools console shows zero errors and no 404s.
- [ ] **Accessibility and performance:** every field has a label; Tab order is logical; errors are announced; page loads instantly (static files, no external requests).

Automated check results from development: 12 of 12 unit tests pass; headless Chromium at 1920x1080 and 390x844 showed zero console errors and no horizontal scroll. Firefox and Safari were not available in the development environment, so run those yourself.

## Retrospective

My main lesson is that every architecture choice is a trade-off. Mastodon's job queue keeps posting fast, but followers see posts a little later, and if Redis fails the whole chain stops. I also learned to verify AI output: the first draft was confident but wrong about Redis and streaming until I checked the official docs.

## Sources

- [Mastodon docs: Scaling](https://docs.joinmastodon.org/admin/scaling/)
- [Mastodon docs: Installing from source](https://docs.joinmastodon.org/admin/install/)
- [Mastodon docs: Object storage](https://docs.joinmastodon.org/admin/optional/object-storage/)
- [GitHub: mastodon/mastodon](https://github.com/mastodon/mastodon)
- [SoftwareMill: The architecture of Mastodon](https://softwaremill.com/the-architecture-of-mastodon/)