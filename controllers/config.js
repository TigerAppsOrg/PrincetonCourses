// This script loads configuration information
// Other scripts import it to gain access to important configuration details

// The URL of our MongoDB database
var mongoDBURI = process.env.MONGODB_URI
if (typeof (mongoDBURI) === 'undefined') {
  console.log("No database URI has been set in this app's config file. You must set the config variable 'MONGODB_URI' to point to a MongoDB database.")
  process.exit(1)
}
module.exports.mongoDBURI = mongoDBURI

// The domain and port on which the app is running
var host = process.env.HOST || 'http://localhost:5050'
module.exports.host = host

// The domain and port on which the app is running
var port = process.env.PORT || 5050
module.exports.port = port

// The secret used to sign session cookies
var sessionSecret = process.env.SESSION_SECRET
if (typeof (sessionSecret) !== 'string' || sessionSecret.length < 32) {
  console.log("A SESSION_SECRET of at least 32 characters is required to sign session cookies.")
  process.exit(1)
}
module.exports.sessionSecret = sessionSecret

// Chatbot API key
module.exports.chatbotAPIKey = process.env.CHATBOT_API_KEY

// Ask Gateway (AI chat)
module.exports.askGatewayURL = process.env.ASK_GATEWAY_URL || 'http://localhost:8010'
module.exports.askGatewayToken = process.env.ASK_GATEWAY_TOKEN || ''
