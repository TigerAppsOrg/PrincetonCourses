// Handle requests to the /evaluations API endpoint

// Load Express
let express = require('express')
let router = express.Router()

// Load internal modules
let evaluationModel = require.main.require('./models/evaluation.js')

// Handle requests to vote on an evaluation
router.route('/:id/vote').all(async function (req, res, next) {
  if (typeof (req.params.id) === 'undefined') {
    res.sendStatus(400)
    return
  }

  try {
    var evaluation = await evaluationModel.findById(req.params.id).exec()
    if (evaluation === null) {
      res.sendStatus(404)
      return
    }
    next()
  } catch (err) {
    console.log(err)
    res.sendStatus(500)
  }
}).put(async function (req, res) {
  let user = res.locals.user

  try {
    // Update only if this user has not already voted on this comment
    var evaluation = await evaluationModel.findOneAndUpdate({
      _id: req.params.id,
      voters: {
        $ne: user._id
      }
    }, {
      $inc: {
        votes: 1
      },
      $addToSet: {
        voters: user._id
      }
    }).exec()

    if (evaluation === null) {
      res.sendStatus(403)
      return
    }

    // Return success to the client
    res.sendStatus(200)
  } catch (err) {
    console.log(err)
    res.sendStatus(500)
  }
}).delete(async function (req, res) {
  let user = res.locals.user

  try {
    // Update only if this user has already voted on this comment
    var evaluation = await evaluationModel.findOneAndUpdate({
      _id: req.params.id,
      voters: user._id
    }, {
      $inc: {
        votes: -1
      },
      $pull: {
        voters: user._id
      }
    }).exec()

    if (evaluation === null) {
      res.sendStatus(403)
      return
    }

    // Return success to the client
    res.sendStatus(200)
  } catch (err) {
    console.log(err)
    res.sendStatus(500)
  }
})

module.exports = router
