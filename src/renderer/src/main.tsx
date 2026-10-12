import '@fontsource-variable/inter'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/700.css'
import '@xterm/xterm/css/xterm.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/layout.css'
import './styles/components.css'
import './styles/panels.css'
import './styles/themes.css'
import { createRoot } from 'react-dom/client'
import { App } from './App'

const root = document.getElementById('root')
if (root) createRoot(root).render(<App />)
