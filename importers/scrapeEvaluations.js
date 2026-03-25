// A script that uses Cheerio to scrape course evaluation information from the Registrar
// At the moment this script does not save the data anywhere

// Load external dependencies
const cheerio = require('cheerio')
const { execFile } = require('child_process')
const https = require('https')
const promptly = require('promptly')
require('colors')

// Load config variables from the .env file
require('dotenv').config()

// Load internal modules
const courseModel = require('../models/course.js')
require('../models/semester.js')
const evaluationModel = require('../models/evaluation.js')

let sessionCookie
let courses

// Throttling and retry configuration
const DELAY_MS = parseInt(process.env.EVAL_SCRAPE_DELAY_MS || '600', 10) // delay between course requests
const MAX_RETRIES = parseInt(process.env.EVAL_SCRAPE_MAX_RETRIES || '5', 10) // per-course retries on transient errors
const RETRY_BACKOFF_MS = parseInt(process.env.EVAL_SCRAPE_RETRY_BACKOFF_MS || '1000', 10) // base backoff
const TRANSIENT_ERROR_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'EPIPE', 'EAI_AGAIN', 'ECONNREFUSED'])
const REQUEST_TIMEOUT_MS = parseInt(process.env.EVAL_SCRAPE_REQUEST_TIMEOUT_MS || '30000', 10)
const REQUEST_TRANSPORT = String(process.env.EVAL_SCRAPE_TRANSPORT || 'auto').toLowerCase()

const loadUrlWithCurl = function (url) {
  return new Promise(function (resolve, reject) {
    execFile('curl', [
      '-fsSL',
      '--location',
      '--connect-timeout', String(Math.max(5, Math.ceil(REQUEST_TIMEOUT_MS / 1000))),
      '--max-time', String(Math.max(15, Math.ceil(REQUEST_TIMEOUT_MS / 1000))),
      '-H', `Cookie: PHPSESSID=${sessionCookie};`,
      '-H', 'User-Agent: Princeton Courses (https://www.princetoncourses.com)',
      url
    ], function (error, stdout, stderr) {
      if (error) {
        if (!error.code && /timed out/i.test(stderr || error.message || '')) {
          error.code = 'ETIMEDOUT'
        }
        error.message = stderr || error.message
        return reject(error)
      }
      resolve(stdout)
    })
  })
}

const loadUrl = function (url, redirectCount = 0) {
  return new Promise(function (resolve, reject) {
    const request = https.get(url, {
      headers: {
        Cookie: `PHPSESSID=${sessionCookie};`,
        'User-Agent': 'Princeton Courses (https://www.princetoncourses.com)'
      },
      timeout: REQUEST_TIMEOUT_MS
    }, function (response) {
      const status = response.statusCode || 0
      const location = response.headers.location

      if (status >= 300 && status < 400 && location) {
        response.resume()
        if (redirectCount >= 5) {
          return reject(new Error('Too many redirects while loading registrar evaluation page'))
        }
        return resolve(loadUrl(location, redirectCount + 1))
      }

      let body = ''
      response.setEncoding('utf8')
      response.on('data', function (chunk) {
        body += chunk
      })
      response.on('end', function () {
        resolve(body)
      })
    })

    request.on('timeout', function () {
      const error = new Error('Timed out fetching registrar evaluation page')
      error.code = 'ETIMEDOUT'
      request.destroy(error)
    })

    request.on('error', function (error) {
      reject(error)
    })
  })
}

// Load a request from the server and call the function externalCallback
const loadPage = async function (term, courseID) {
  const url = 'https://registrarapps.princeton.edu/course-evaluation?terminfo=' + term + '&courseinfo=' + courseID
  if (REQUEST_TRANSPORT === 'curl') {
    return loadUrlWithCurl(url)
  }
  if (REQUEST_TRANSPORT === 'https') {
    return loadUrl(url)
  }
  try {
    return await loadUrl(url)
  } catch (error) {
    if (error && error.code && TRANSIENT_ERROR_CODES.has(error.code)) {
      console.log(`\tPrimary HTTPS request failed for course ${courseID}; retrying with curl fallback.`.yellow)
      return loadUrlWithCurl(url)
    }
    throw error
  }
}

// Return the course evaluation data for the given semester/courseID to the function callback
const getCourseEvaluationData = function (semester, courseID, externalCallback) {
  loadPage(semester, courseID).then(function (data) {
    const $ = cheerio.load(data)
    if ($('title').text() !== 'Course Evaluation Results') {
      console.error('Scraping the evaluations failed. Your session cookie probably expired. You must provide a valid session cookie.'.red)
      console.log('Goodbye.')
      process.exit(1)
    }

    console.log('\tReceived data for course %s in semester %s.'.green, courseID, semester)

    // Extract scores
    var scores = {}
    if ($.html().includes(semester)) {
      var table_value = $('.data-bar-chart').attr('data-bar-chart')
      if (typeof table_value !== 'undefined') {
        try {
          JSON.parse(table_value).forEach(function (arrayItem) {
            scores[arrayItem.key] = parseFloat(arrayItem.value)
          })
        } catch (e) {
          // ignore parse error and continue without scores for course
        }
      }
    }

    // Extract student comments
    const comments = []
    if ($.html().includes(semester)) {
      var comment_values = $('.comment')
      if (typeof comment_values !== 'undefined') {
        comment_values.each(function (index, element) {
          comments.push($(element).text().replace('\n', ' ').replace('\r', ' ').trim())
        })
      }
    }

    externalCallback(null, scores, comments)
  }).catch(function (err) {
    externalCallback(err)
  })
}

const instructions = [
  '\t1. Visit and log in to: ' + 'https://registrarapps.princeton.edu/course-evaluation'.yellow,
  '\t2. Copy the value of the cookie key ' + 'PHPSESSID'.yellow + ' in the Application panel of Chrome developer tools (i.e. Inspect Element)\n',
  '\tNote: run this script with the argument --skip to bypass confirmation prompts'.green
]

console.log('Welcome to the script for scraping course evaluations from the Princeton University registrar\'s website.\n')
console.log('Course evaluations are protected behind Princeton\'s Central Authentication System. To scrape the course evaluations, follow these instructions:')
console.log(instructions.join('\n'))

const envCookie = process.env.PHPSESSID || process.env.EVAL_PHPSESSID
const envQuery = process.env.EVAL_QUERY || process.env.EVAL_QUERY_JSON

const getCookie = () => {
  if (envCookie && envCookie.trim().length > 0) {
    return Promise.resolve(envCookie.trim())
  }
  return promptly.prompt('Paste the session cookie output from the developer console and hit enter:')
}

const getQuery = () => {
  if (envQuery && envQuery.trim().length > 0) {
    return Promise.resolve(envQuery.trim())
  }
  return promptly.prompt('Enter the MongoDB-style query for the courses for which you want to import the evaluations ' + '(or simply press return to scrape everything)'.green + ':', {
    default: '{}'
  })
}

getCookie().then(function (cookie) {
  sessionCookie = cookie
  return getQuery()
}).then(function (query) {
  // Connect to the database
  require('../controllers/database.js')

  // Find an array of courses and populate the courses with the course evaluation information from the Registrar. Save the data to the database
  return courseModel.find(JSON.parse(query))
}).then(async function (returnedCourses) {
  courses = returnedCourses

  // optional: randomized processing order to avoid repeating same leading set on reruns
  if (String(process.env.EVAL_RANDOMIZE_ORDER || 'true').toLowerCase() === 'true') {
    for (let i = courses.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = courses[i]
      courses[i] = courses[j]
      courses[j] = tmp
    }
  }

  if (process.argv.length > 2 && process.argv[2] === '--skip') return true
  return promptly.confirm(`You are about to request the course evaluation data for ${courses.length} courses. Are you sure you want to do this? (y/n):`)
}).then(function (confirmation) {
  if (!confirmation) {
    console.log('Goodbye')
    return process.exit(0)
  }

  const total = courses.length
  let processed = 0
  const failed = []

  const sleep = function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms) }) }

  const fetchCourse = function (course) {
    return new Promise(function (resolve, reject) {
      getCourseEvaluationData(course.semester._id, course.courseID, function (err, scores, comments) {
        if (err) return reject(err)

        let promises = []
        for (const comment of comments) {
          promises.push(evaluationModel.findOneAndUpdate({
            comment: comment,
            course: course._id
          }, {
            comment: comment,
            course: course._id
          }, {
            new: true,
            upsert: true,
            runValidators: true,
            setDefaultsOnInsert: true
          }).exec())
        }

        if (scores && Object.keys(scores).length > 0) {
          promises.push(courseModel.updateOne({
            _id: course._id
          }, {
            $set: {
              scores: scores
            },
            $unset: {
              scoresFromPreviousSemester: '',
              scoresFromPreviousSemesterSemester: ''
            }
          }))
        }

        Promise.all(promises).then(function () { resolve() }).catch(reject)
      })
    })
  }

  const attemptCourse = async function (course) {
    let attempt = 0
    while (attempt < MAX_RETRIES) {
      try {
        await fetchCourse(course)
        return true
      } catch (err) {
        attempt++
        const transient = Boolean(err && err.code && TRANSIENT_ERROR_CODES.has(err.code))
        const detail = err && err.code ? ` [${err.code}]` : ''
        console.error((`Error on course ${course.courseID} (attempt ${attempt}/${MAX_RETRIES}): ${err && err.message || err}${detail}`).red)
        if (!transient || attempt >= MAX_RETRIES) {
          return false
        }
        await sleep(RETRY_BACKOFF_MS * attempt)
      }
    }
    return false
  }

  const run = async function () {
    for (let i = 0; i < courses.length; i++) {
      const thisCourse = courses[i]
      console.log(`Processing course ${thisCourse.courseID} in semester ${thisCourse.semester._id}. (Course ${i + 1} of ${total}).`.yellow)
      const ok = await attemptCourse(thisCourse)
      if (!ok) failed.push(thisCourse)
      processed++
      const remaining = total - processed
      if (remaining % 10 === 0) {
        console.log(`${remaining} courses still processing…`)
      }
      await sleep(DELAY_MS)
    }

    // Second pass over failures (one more retry pass)
    if (failed.length > 0) {
      console.log((`Re-attempting ${failed.length} failed courses…`).yellow)
      const secondPass = failed.splice(0)
      for (const c of secondPass) {
        const ok = await attemptCourse(c)
        if (!ok) failed.push(c)
        await sleep(DELAY_MS)
      }
    }

    if (failed.length > 0) {
      console.log((`Finished with ${failed.length} course(s) still failing.`).red)
    }
    console.log('Fetched and saved all the requested course evaluations.')
    process.exit(0)
  }

  run()

  // delete malformatted evaluations
  evaluationModel.deleteMany({ comment: { $regex: '^[0-9]$' } })
  evaluationModel.deleteMany({ comment: '.' })
}).catch(function (err) {
  console.error(err)
  process.exit(1)
})
