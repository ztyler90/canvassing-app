import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { initAnalytics } from './lib/analytics.js'

// No-ops unless VITE_POSTHOG_KEY is set, so dev/preview builds send nothing.
initAnalytics()

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
