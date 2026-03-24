// Handle requests to the /instructor API endpoint

// Load Express
let express = require('express')
let router = express.Router()

// Load internal modules
let instructorModel = require.main.require('./models/instructor.js')

// Respond to requests for an instructor
router.use('/:id', async function (req, res) {
    // Validate that the request is correct
  if ((typeof (req.params.id) === 'undefined') || isNaN(req.params.id)) {
    res.sendStatus(400)
    return
  }

  try {
    // Search for the instructor in the database
    var instructor = await instructorModel.findOne({ _id: req.params.id }).populate({
      path: 'courses',
      options: {
        sort: {
          semester: -1,
          department: 1,
          catalogNumber: 1
        }
      }
    }).exec()

    if (instructor === null) {
      res.sendStatus(404)
    } else {
      res.set('Cache-Control', 'public, max-age=86400').json(instructor)
    }
  } catch (err) {
    console.log(err)
    res.sendStatus(500)
  }
})

module.exports = router
