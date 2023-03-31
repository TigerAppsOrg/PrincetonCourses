// Handle requests to the /semesters API endpoint

// Load Express
let express = require('express')
let router = express.Router()

// Load internal modules
let semesterModel = require.main.require('./models/semester.js')

// Respond to requests for semester listings
router.use(function (req, res) {
  semesterModel.getAll(function (fetchedSemesters) {
    res.set('Cache-Control', 'no-cache').status(200).json(fetchedSemesters)
  })
})

module.exports = router
