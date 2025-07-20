require('dotenv').config();
const { connectToWhatsApp } = require('./app/connection/socketController');

connectToWhatsApp().catch((err) => {
  console.error('Failed to start WhatsApp connection:', err);
  process.exit(1);
});
