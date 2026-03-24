// Load config variables from the .env file
// require('dotenv').config({path: '../.env'})
require('dotenv').config()

// Load internal modules
var courseModel = require('../models/course.js')

// Connect to the database
require('../controllers/database.js')

courseModel.distinct('courseID', { 'scores.Quality of Course': { $exists: false } }).then(async function (courseIDs) {
  console.log(`Processing ${courseIDs.length} courses that currently lack scores`)
  const promises = []
  for (const courseID of courseIDs) {
    const count = await courseModel.countDocuments({ courseID: courseID })
    if (count === 1) {
      promises.push(courseModel.updateOne({
        courseID: courseID
      }, {
        $set: { new: true }
      }).exec())
    }
  }
  console.log(`Setting new flag on  ${promises.length} courses`)
  return Promise.all(promises)
}).then(function (result) {
  console.log('Done!')
  process.exit(0)
}).catch(function (err) {
  return console.error(err)
})
