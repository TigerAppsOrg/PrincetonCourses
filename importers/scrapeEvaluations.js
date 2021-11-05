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
      return console.error(err)
    }
    callback(body)
  })
}

// Return the course evaluation data for the given semester/courseID to the function callback
const getCourseEvaluationData = function (semester, courseID, externalCallback) {
  loadPage(semester, courseID, function (data) {
    const $ = cheerio.load(data)
    if ($('title').text() !== 'Course Evaluation Results') {
      console.error('Scraping the evaluations failed. Your session cookie was probably bad. You must provide a valid session cookie.')
      console.log('Goodbye.')
      process.exit(1)
    }

    console.log('\tReceived data for course %s in semester %s.', courseID, semester)

    // Extract scores
    var scores = {}
    if ($.html().includes(semester)) {
      var table_value = $(".data-bar-chart").attr('data-bar-chart')
      if (typeof table_value === 'undefined') {
        externalCallback({}, [])
        return
      }
      JSON.parse(table_value).forEach(function (arrayItem) {
        scores[arrayItem['key']] = parseFloat(arrayItem['value'])
      });
    }

    // Extract student comments
    const comments = []
    if ($.html().includes(semester)) {
      var comment_values = $(".comment")
      if (typeof comment_values === 'undefined') {
        externalCallback({}, [])
        return
      }
      comment_values.each(function (index, element) {
        comments.push($(element).text().replace('\n', ' ').replace('\r', ' ').trim())
      })
    }

    externalCallback(scores, comments)
  })
}

const instructions = [
  '\t1. Visit and log in to: ' + 'https://registrarapps.princeton.edu/course-evaluation'.yellow,
  '\t2. Copy the value of the cookie key ' + 'PHPSESSID'.yellow + ' in the Application panel of Chrome developer tools (i.e. Inspect Element)\n'
]

console.log('Welcome to the script for scraping course evaluations from the Princeton University registrar\'s website.\n')
console.log('Course evaluations are protected behind Princeton\'s Central Authentication System. To scrape the course evaluations, follow these instructions:')
console.log(instructions.join('\n'))

promptly.prompt('Paste the session cookie output from the developer console and hit enter:').then(cookie => {
  sessionCookie = cookie
  return promptly.prompt('Enter the MongoDB-style query for the courses for which you want to import the evaluations:', {
    default: '{}',
  })
}).then(query => {
  // Connect to the database
  require('../controllers/database.js')

  // evaluationModel.deleteMany({ "comment": { $regex: "^[0-9].[0-9]$" } }).then(() => { throw new Error("Forced ending"); })

  // Find an array of courses and populate the courses with the course evaluation information from the Registrar. Save the data to the database
  return courseModel.find(JSON.parse(query))
}).then(returnedCourses => {
  courses = returnedCourses;
  return promptly.confirm(`You are about to request the course evaluation data for ${courses.length} courses. Are you sure you want to do this? (y/n):`)
}).then(confirmation => {
  if (!confirmation) {
    console.log('Goodbye')
    return process.exit(0)
  }

  let coursesPendingProcessing = courses.length
  let courseIndex = 0

  const interval = setInterval(function () {
    const thisCourse = courses[courseIndex++]

    // If there are no more courses, cease sending requests
    if (typeof (thisCourse) === 'undefined') {
      clearInterval(interval)
      return
    }

    console.log(`Processing course ${thisCourse.courseID} in semester ${thisCourse.semester._id}. (Course ${courseIndex} of ${courses.length}).`)

    // Fetch the evaluation data
    getCourseEvaluationData(thisCourse.semester._id, thisCourse.courseID, function (scores, comments) {
      let promises = []

      // Iterate over the comments
      for (const comment of comments) {
        // Save the comments to the database
        promises.push(evaluationModel.findOneAndUpdate({
          comment: comment,
          course: thisCourse._id
        }, {
          comment: comment,
          course: thisCourse._id
        }, {
          new: true,
          upsert: true,
          runValidators: true,
          setDefaultsOnInsert: true
        }).exec())
      }

      // Update the course with the newly-fetched evaluation data
      if (scores !== {}) {
        promises.push(courseModel.update({
          _id: thisCourse._id
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

      // Wait for all database operations to complete
      Promise.all(promises).then(function () {
        if (coursesPendingProcessing % 10 === 0) {
          console.log(`${coursesPendingProcessing} courses still processing…`)
        }
        if (--coursesPendingProcessing === 0) {
          console.log('Fetched and saved all the requested course evaluations.')
          process.exit(0)
        }
      }).catch(function (reason) {
        console.log(reason)
      })
    })
  }, 500)
}).catch(err => {
  console.error(err)
  process.exit(1)
})
