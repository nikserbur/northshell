// E2E entry: isolates app data in a temp dir, then boots the built main process.
const { app } = require('electron')

if (process.env.XMT_E2E_DATA) app.setPath('userData', process.env.XMT_E2E_DATA)
require('../out/main/index.js')
