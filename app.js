// This script is the main app script that powers Princeton Courses
// This script is run when the app is launched

// Greet the world!
console.log('Launching Princeton Courses.')

// Load Node.js components
const path = require('path')

// Load external dependencies
require('mongoose')
var express = require('express')
var session = require('cookie-session')
var CentralAuthenticationService = require('cas')
var app = express()

app.set('port', (process.env.PORT || 5000))
app.set('host', (process.env.HOST || 'http://localhost:5000'))

// Load internal models
// var courseModel = require('./course.js')
var UserModel = require('./user.js')
// var auth = require('./authentication.js')

// Connect to the database
require('./database.js')

// Configure CAS authentication
var casURL = 'https://fed.princeton.edu/cas/'
var cas = new CentralAuthenticationService({
  base_url: casURL,
  service: app.get('host') + '/verify'
})
app.use(session({ keys: ['key1', 'key2'] }))

//OMG I WROTE SOME COMMENTS DOPE
// If the user is authenticated, load the user for the lifetime of this req
app.use('*', function (req, res, next) {
  if (req.session.cas) {
    UserModel.findByNetid(req.session.cas.netid, function (doc) {
      if (doc != null) {
        app.set('user', doc)
      }
      next()
    })
  } else {
    next()
  }
})

// Route a req for the homepage
app.get('/', function (req, res) {
    // Check whether the user has authenticated
  if (!req.session.cas) {
        // The user in unauthenticated. Display a splash page.
    res.render('pages/splash')
  } else {
        // The user has authenticated. Display the app
    res.render('pages/app', {
      netid: app.get('user').netid
    })
  }
})

// Handle replies from CAS server about authentication
app.get('/verify', function (req, res) {
  if (!req.session.cas) {
    var ticket = req.param('ticket')
    if (ticket) {
            // Check if the user has a valid ticket
      cas.validate(ticket, function (err, status, netid) {
        if (err) {
          res.send({ error: err })
        } else {
          req.session.cas = {
            status: status,
            netid: netid
          }

          console.log('Searching the database for a user with netid %s', netid)
          UserModel.findByNetid(req.session.cas.netid, function (user) {
            if (user == null) {
              var User = new UserModel({
                netid: netid
              })
              User.save(function (error) {
                if (error) {
                  console.log('An error occured saving a user: %s', error)
                }
              })
            }
            app.set('user', user)
          })

          res.redirect('/')
        }
      })
    } else {
      res.redirect('/')
    }
  } else {
    res.redirect('/')
  }
})

app.get('/login', function (req, res) {
  res.redirect(casURL + 'login?service=' + app.get('host') + '/verify')
})

app.get('/logout', function (req, res) {
  req.session = null
  res.redirect('/')
})

app.use(express.static(path.join(__dirname, '/public')))

// views is directory for all template files
app.set('views', path.join(__dirname, '/views'))
app.set('view engine', 'ejs')

// Start listening for reqs
app.listen(app.get('port'), function () {
  console.log('Listening for reqs on port %d.', app.get('port'))
})
