# Importing Data

This repo has two import paths:

1. Local scripts in `importers/`
2. The GitHub Actions workflow at `.github/workflows/imports.yml`

The workflow is the usual production path because it loads the required secrets from Heroku config vars and writes directly to the live MongoDB.

## Important Notes

- The current workflow UI does **not** have a dry-run mode.
- If `Run course import (OIT + registrar details)` is enabled in GitHub Actions, it will write to the real database.
- The current no-argument course importer imports the **newest term only**. It does **not** import all historical semesters.
- The evaluations workflow can now do either:
  - a targeted scrape of courses whose scores are missing or backfilled
  - a full-term scrape of every course in the selected term/subject if `Run full-term eval scrape` is checked

## Minimal Workflow: Import New Semester Courses

Use this when a new semester's course listings drop and you just want the new courses in PrincetonCourses.

In the workflow UI:

- Leave `Branch` as `master`
- Check `Run course import (OIT + registrar details)`
- Check `Run departments import (OIT)`
- Uncheck `Run evaluations scraper (requires PHPSESSID)`
- Leave `Run backfill for missing Quality of Course` unchecked
- Leave `Run setNewCourseFlag` unchecked
- Check `Restart Heroku dynos at end (refresh dept cache)`
- Leave `Target term code` blank to use the newest term automatically
- Leave `Target subject code` blank to import all subjects
- Leave `Registrar PHPSESSID cookie` blank
- Leave `Registrar FE API token` blank unless the course import fails because the workflow cannot auto-read the registrar front-end token

Then click `Run workflow`.

Expected jobs:

- `import_courses`
- `import_departments`
- `restart_heroku`

Skipped jobs:

- `scrape_evals`
- `backfill_scores`
- `set_new_flag`

## Workflow: Import Fall 2025 Evaluations Only

If what you want is "import the Fall 2025 evaluations into PrincetonCourses", use:

- Leave `Branch` as `master`
- Leave `Run course import (OIT + registrar details)` unchecked unless you also want to refresh course data in the same run
- Leave `Run departments import (OIT)` unchecked
- Check `Run evaluations scraper (requires PHPSESSID)`
- Check `Run full-term eval scrape` if you want every Fall 2025 course rescraped, not just the missing/backfilled ones
- Leave `Run backfill for missing Quality of Course` unchecked
- Leave `Run setNewCourseFlag` unchecked
- Leave `Restart Heroku dynos at end (refresh dept cache)` unchecked
- Set `Target term code` to `1262` for Fall 2025
- Leave `Target subject code` blank for all subjects, or fill in a subject like `COS` to narrow the scrape
- Paste a fresh `PHPSESSID` into `Registrar PHPSESSID cookie`
- Leave `Registrar FE API token` blank unless the `import_courses` step fails because token auto-discovery fails

Then click `Run workflow`.

What this Fall 2025 workflow actually scrapes:

- Courses in term `1262`
- Optionally narrowed by subject
- If `Run full-term eval scrape` is unchecked:
  - only courses where `scores.Quality of Course` is missing or `scoresFromPreviousSemester` is true
- If `Run full-term eval scrape` is checked:
  - every course in the selected term/subject

For "all Fall 2025 evals", you should check `Run full-term eval scrape`.

## Getting PHPSESSID

The eval workflow needs a valid Princeton registrar session cookie.

Steps:

1. Open `https://registrarapps.princeton.edu/course-evaluation`
2. Log in through Princeton CAS in the browser
3. Open browser developer tools
4. In Chrome, go to `Application` -> `Cookies` -> `https://registrarapps.princeton.edu`
5. Copy the value for the cookie named `PHPSESSID`
6. Paste that value into the workflow field `Registrar PHPSESSID cookie`

Notes:

- The cookie can expire, so get it right before running the workflow
- If the eval job says your cookie is invalid or expired, log in again and copy a fresh `PHPSESSID`

## Local Scripts

Run these from the repo root.

### Local Course Import

Required environment variables:

- `MONGODB_URI`
- `CONSUMER_KEY`
- `CONSUMER_SECRET`

Optional:

- `REGISTRAR_FE_API_TOKEN`

Install dependencies:

```bash
npm ci
python -m pip install -r requirements.txt
```

Newest term only:

```bash
node importers/importBasicCourseDetails.js
```

Specific term:

```bash
node importers/importBasicCourseDetails.js "term=1262"
```

Specific term and subject:

```bash
node importers/importBasicCourseDetails.js "term=1262&subject=COS"
```

### Local Departments Import

```bash
node importers/importDepartments.js
```

### Local Evaluations Import

Required:

- `MONGODB_URI`
- a valid `PHPSESSID`

Optional environment variables:

- `EVAL_QUERY`
- `EVAL_SCRAPE_DELAY_MS`
- `EVAL_SCRAPE_MAX_RETRIES`
- `EVAL_SCRAPE_RETRY_BACKOFF_MS`
- `EVAL_RANDOMIZE_ORDER`

Interactive:

```bash
node importers/scrapeEvaluations.js
```

Non-interactive:

```bash
export PHPSESSID='...'
export EVAL_QUERY='{"semester":1262}'
node importers/scrapeEvaluations.js --skip
```

## Other Importer Scripts

- `importDepartments.js` updates department names and codes
- `insertMostRecentScoreIntoUnevaluatedSemesters.js` backfills missing `Quality of Course` scores from earlier offerings
- `setNewCourseFlag.js` marks one-off course IDs with `new: true`
