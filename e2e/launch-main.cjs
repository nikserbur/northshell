// E2E entry: isolates app data in a temp dir, then boots the built main process.
const { app } = require('electron')

if (process.env.XMT_E2E_DATA) app.setPath('userData', process.env.XMT_E2E_DATA)
// Started from this folder, Electron reports its own version; report the app's, as the packaged build does.
const { version } = require('../package.json')
app.getVersion = () => version
require('../out/main/index.js')
