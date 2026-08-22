// Lightweight seat updater: refreshes enrollment / capacity / status on each
// course's classes array from the OIT Student App API, without re-running the
// full course import. Modeled on TigerJunction's hourly seats cron.
//
// Authenticates against api.princeton.edu with an OAuth client_credentials
// token from CONSUMER_KEY / CONSUMER_SECRET (the same credentials
// importers/mobileapp.py uses) — deliberately NOT the registrar-website token
// scrape used by importBasicCourseDetails.js, which 403s behind Cloudflare
// from datacenter IPs (CI runners, cron boxes).
//
// Usage: node importers/updateSeats.js [termCode]
//   termCode optional — defaults to the latest semester in the database.
// Requires: MONGODB_URI, CONSUMER_KEY, CONSUMER_SECRET

require('dotenv').config()

const mongoose = require('mongoose')

const SEATS_URL = 'https://api.princeton.edu/student-app/1.0.3/courses/seats'
const TOKEN_URL = 'https://api.princeton.edu/token'
const BATCH_SIZE = 30

// Connect directly rather than via controllers/database.js: that path pulls in
// config.js, which hard-exits without SESSION_SECRET and other app-only vars.
const mongoDBURI = process.env.MONGODB_URI
if (!mongoDBURI) {
  console.error('MONGODB_URI is required.')
  process.exit(1)
}
if (!process.env.CONSUMER_KEY || !process.env.CONSUMER_SECRET) {
  console.error('CONSUMER_KEY and CONSUMER_SECRET are required.')
  process.exit(1)
}

var semesterModel = require('../models/semester.js')
var courseModel = require('../models/course.js')

var authorizationHeader = null

async function refreshAccessToken () {
  const basic = Buffer.from(process.env.CONSUMER_KEY + ':' + process.env.CONSUMER_SECRET).toString('base64')
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + basic,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  })
  if (!response.ok) {
    throw new Error(`Token endpoint responded ${response.status}`)
  }
  const payload = await response.json()
  authorizationHeader = 'Bearer ' + payload.access_token
}

async function fetchSeatBatch (term, courseIds) {
  const url = `${SEATS_URL}?term=${term}&course_ids=${courseIds.join(',')}&fmt=json`
  let response = await fetch(url, { headers: { Authorization: authorizationHeader } })
  if (response.status === 401) {
    // Token expired mid-run — refresh once and retry.
    await refreshAccessToken()
    response = await fetch(url, { headers: { Authorization: authorizationHeader } })
  }
  if (!response.ok) {
    throw new Error(`Seats API responded ${response.status}`)
  }
  const payload = await response.json()
  if (!payload || !Array.isArray(payload.course)) {
    throw new Error('Unexpected seats API response shape')
  }
  return payload.course
}

async function main () {
  await refreshAccessToken()
  await mongoose.connect(mongoDBURI)

  let term = parseInt(process.argv[2], 10)
  if (!term) {
    const latest = await semesterModel.find({}).sort({ _id: -1 }).limit(1).lean()
    if (latest.length === 0) throw new Error('No semesters found in the database.')
    term = latest[0]._id
  }
  console.log('Updating seats for term %d.', term)

  const courses = await courseModel.find(
    { semester: term },
    { courseID: true, classes: true }
  ).lean()
  console.log('Loaded %d courses from the database.', courses.length)

  let updatedCourses = 0
  let updatedClasses = 0
  let failedBatches = 0

  for (let i = 0; i < courses.length; i += BATCH_SIZE) {
    const batch = courses.slice(i, i + BATCH_SIZE)

    let seatCourses
    try {
      seatCourses = await fetchSeatBatch(term, batch.map(function (c) { return c.courseID }))
    } catch (error) {
      console.warn('Seat batch starting at %d failed: %s', i, error.message)
      failedBatches++
      continue
    }

    const bulkOps = []
    for (const seatCourse of seatCourses) {
      const doc = batch.find(function (c) { return c.courseID === seatCourse.course_id })
      if (!doc || !Array.isArray(doc.classes) || !Array.isArray(seatCourse.classes)) continue

      const seatsByClassNumber = new Map(seatCourse.classes.map(function (c) {
        return [String(c.class_number), c]
      }))

      let changed = false
      for (const cls of doc.classes) {
        const seat = seatsByClassNumber.get(String(cls.class_number))
        if (!seat) continue

        // Match the string types the full importer stores.
        const enrollment = String(seat.enrollment)
        const capacity = String(seat.capacity)
        const puStatus = seat.pu_calc_status

        if (cls.enrollment !== enrollment || cls.capacity !== capacity ||
            (puStatus && cls.pu_calc_status !== puStatus)) {
          cls.enrollment = enrollment
          cls.capacity = capacity
          if (puStatus) {
            cls.pu_calc_status = puStatus
            cls.seat_status = puStatus
          }
          changed = true
          updatedClasses++
        }
      }

      if (changed) {
        bulkOps.push({
          updateOne: {
            filter: { _id: doc._id },
            update: { $set: { classes: doc.classes } }
          }
        })
        updatedCourses++
      }
    }

    if (bulkOps.length > 0) {
      await courseModel.bulkWrite(bulkOps, { ordered: false })
    }

    if ((i / BATCH_SIZE) % 10 === 0) {
      console.log('Progress: %d / %d courses.', Math.min(i + BATCH_SIZE, courses.length), courses.length)
    }
  }

  console.log('Done. Updated %d classes across %d courses (%d failed batches).',
    updatedClasses, updatedCourses, failedBatches)

  await mongoose.connection.close()

  // Fail the run only when nothing at all could be fetched.
  process.exit(failedBatches > 0 && updatedCourses === 0 && failedBatches >= Math.ceil(courses.length / BATCH_SIZE) ? 1 : 0)
}

main().catch(function (error) {
  console.error(error)
  process.exit(1)
})
