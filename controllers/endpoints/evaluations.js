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
    var evaluation = await evaluationModel.findById(req.params.id).exec()

    // Ensure the user has not already voted on this comment
    if (typeof (evaluation.voters) !== 'undefined' && evaluation.voters.indexOf(user._id) > -1) {
      res.sendStatus(403)
      return
    }

    // Update the evaluation (increment the number of votes and add the user's netID to the list of voters)
    await evaluationModel.findByIdAndUpdate(req.params.id, {
      $inc: {
        votes: 1
      },
      $addToSet: {
        voters: user._id
      }
    })

    // Return success to the client
    res.sendStatus(200)
  } catch (err) {
    console.log(err)
    res.sendStatus(500)
  }
}).delete(async function (req, res) {
  let user = res.locals.user

  try {
    var evaluation = await evaluationModel.findById(req.params.id).exec()

    if (typeof (evaluation.voters) === 'undefined') {
      res.sendStatus(500)
      return
    }

    // Ensure the user has already voted on this comment
    if (typeof (evaluation.voters) !== 'object' && evaluation.voters.indexOf(user._id) === -1) {
      res.sendStatus(403)
      return
    }

    // Update the evaluation (decrement the number of votes and remove the user's netID from the list of voters)
    await evaluationModel.findByIdAndUpdate(req.params.id, {
      $inc: {
        votes: -1
      },
      $pull: {
        voters: user._id
      }
    })

    // Return success to the client
    res.sendStatus(200)
  } catch (err) {
    console.log(err)
    res.sendStatus(500)
  }
})

module.exports = router
