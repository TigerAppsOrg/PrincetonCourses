// A script that uses Cheerio to scrape course evaluation information from the Registrar
// At the moment this script does not save the data anywhere

// Load external dependencies
const cheerio = require('cheerio')
const request = require('request')
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
const DELAY_MS = parseInt(process.env.EVAL_SCRAPE_DELAY_MS || '500', 10) // delay between course requests
const MAX_RETRIES = parseInt(process.env.EVAL_SCRAPE_MAX_RETRIES || '3', 10) // per-course retries on transient errors
const RETRY_BACKOFF_MS = parseInt(process.env.EVAL_SCRAPE_RETRY_BACKOFF_MS || '1000', 10) // base backoff

// Load a request from the server and call the function externalCallback
const loadPage = function (term, courseID, callback) {
  // Define the HTTP request options
  const options = {
    url: 'https://registrarapps.princeton.edu/course-evaluation?terminfo=' + term + '&courseinfo=' + courseID,
    headers: {
      'Cookie': `PHPSESSID=${sessionCookie};`,
      'User-Agent': 'Princeton Courses (https://www.princetoncourses.com)'
    }
  }

  request(options, (err, response, body) => {
    if (err) {
      return callback(err)
    }
    callback(null, body)
  })
}

// Return the course evaluation data for the given semester/courseID to the function callback
const getCourseEvaluationData = function (semester, courseID, externalCallback) {
  loadPage(semester, courseID, function (err, data) {
    if (err) {
      return externalCallback(err)
    }
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
      var table_value = $(".data-bar-chart").attr('data-bar-chart')
      if (typeof table_value !== 'undefined') {
        try {
          JSON.parse(table_value).forEach(function (arrayItem) {
            scores[arrayItem['key']] = parseFloat(arrayItem['value'])
          })
        } catch (e) {
          // ignore parse error and continue without scores for course
        }
      }
    }

    // Extract student comments
    const comments = []
    if ($.html().includes(semester)) {
      var comment_values = $(".comment")
      if (typeof comment_values !== 'undefined') {
        comment_values.each(function (index, element) {
          comments.push($(element).text().replace('\n', ' ').replace('\r', ' ').trim())
        })
      }
    }

    externalCallback(null, scores, comments)
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

promptly.prompt('Paste the session cookie output from the developer console and hit enter:').then(cookie => {
  sessionCookie = cookie
  return promptly.prompt('Enter the MongoDB-style query for the courses for which you want to import the evaluations ' + '(or simply press return to scrape everything)'.green + ':', {
    default: '{}',
  })
}).then(query => {
  // Connect to the database
  require('../controllers/database.js')

  // evaluationModel.deleteMany({ "comment": { $regex: "^[0-9].[0-9]$" } }).then(() => { throw new Error("Forced ending"); })

  // Find an array of courses and populate the courses with the course evaluation information from the Registrar. Save the data to the database
  return courseModel.find(JSON.parse(query))
}).then(async (returnedCourses) => {
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

  if (process.argv.length > 2 && process.argv[2] == '--skip') return true
  return promptly.confirm(`You are about to request the course evaluation data for ${courses.length} courses. Are you sure you want to do this? (y/n):`)
}).then(confirmation => {
  if (!confirmation) {
    console.log('Goodbye')
    return process.exit(0)
  }

  const total = courses.length
  let processed = 0
  const failed = []

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

  const fetchCourse = (course) => new Promise((resolve, reject) => {
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
        promises.push(courseModel.update({
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

      Promise.all(promises).then(() => resolve()).catch(reject)
    })
  })

  const attemptCourse = async (course) => {
    let attempt = 0
    while (attempt < MAX_RETRIES) {
      try {
        await fetchCourse(course)
        return true
      } catch (err) {
        attempt++
        const transient = (err && (err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET'))
        console.error((`Error on course ${course.courseID} (attempt ${attempt}/${MAX_RETRIES}): ${err && err.message || err}`).red)
        if (!transient || attempt >= MAX_RETRIES) {
          return false
        }
        await sleep(RETRY_BACKOFF_MS * attempt)
      }
    }
    return false
  }

  const run = async () => {
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
  evaluationModel.deleteMany({comment: {$regex: "^[0-9]$"}})
  evaluationModel.deleteMany({comment: "."})
}).catch(err => {
  console.error(err)
  process.exit(1)
})
