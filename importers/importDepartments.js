// This script populates the database with all the departments from MobileApp API
console.log('Starting script to update our database with latest course listings information from MobileApp API.')

// Load config variables from the .env file
require('dotenv').config()

// Load external dependencies
var log = require('loglevel')
const spawn = require('child_process').spawn
var cheerio = require('cheerio')

// Set the level of the logger to the first command line argument
// Valid values: "trace", "debug", "info", "warn", "error"
if (process.argv.length > 3) {
  log.setLevel(process.argv[3])
}

// Load internal modules
var departmentModel = require('../models/department.js')

// Connect to the database
require('../controllers/database.js')

let loadDepartmentsFromRegistrar = function (callback) {
  console.log('Requesting department details from MobileApp API')

  let args = ['importers/mobileapp.py', 'importDepartmentals']
  const pythonMobileAppManager = spawn('python', args)
  var res = ''
  pythonMobileAppManager.stdout.on('data', function (data) {
    res += data.toString('utf8')
  })
  pythonMobileAppManager.stdout.on('end', function () {
    callback(JSON.parse(res))
  })
  pythonMobileAppManager.on('error', function (error) {
    console.log(error)
  })
}

// Decode escaped HTML characters in a string, for example changing "Foo&amp;bar" to "Foo&bar"
let decodeEscapedCharacters = function (html) {
  return cheerio.load('<div>' + cheerio.load('<div>' + html + '</div>').text() + '</div>').text()
}

let handleData = async function (data) {
  // Iterate over each semester and subject to save to the database
  for (const semester of data.term) {
    if (typeof (semester.subjects) !== 'undefined') {
      for (const subject of semester.subjects) {
        try {
          await departmentModel.findOneAndUpdate({
            _id: subject.code
          }, {
            _id: subject.code,
            name: decodeEscapedCharacters(subject.name)
          }, {
            new: true,
            upsert: true,
            runValidators: true
          })
          console.log('Creating or updating the subject %s succeeded.', subject.code)
        } catch (error) {
          console.log('Creating or updating the subject %s failed.', subject.code)
        }
      }
    }
  }
  console.log('Importing subjects complete.')
  process.exit(0)
}

loadDepartmentsFromRegistrar(handleData)
