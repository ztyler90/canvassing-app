/**
 * ViewModeSwitch — header control that lets a platform manager flip between the
 * Manager dashboard and the rep Canvassing UI. Renders nothing for reps and
 * closers (canSwitch === false), so it's safe to drop into any header.
 *
 * To stay light on already-crowded mobile headers it renders a single pill that
 * shows the *destination* mode: in Manager view it offers "Canvass" (jump into
 * the rep UI to knock); in Rep view it offers "Manager" (jump back to the
 * dashboard). Tapping switches mode and navigates to that tree's home route.
 *
 * Designed for dark/gradient headers (white-on-translucent). Pass a className
 * to nudge spacing if needed.
 */
import { useNavigate } from 'react-router-dom'
import { DoorOpen, LayoutDashboard } from 'lucide-react'
import { useViewMode } from '../contexts/ViewModeContext.jsx'

export default function ViewModeSwitch({ className = '' }) {
  const { viewMode, setViewMode, canSwitch } = useViewMode()
  const navigate = useNavigate()

  if (!canSwitch) return null

  const goRep     = viewMode !== 'rep'
  const Icon      = goRep ? DoorOpen : LayoutDashboard
  const label     = goRep ? 'Canvass' : 'Manager'
  const targetUrl = goRep ? '/' : '/manager'

  const handleClick = () => {
    setViewMode(goRep ? 'rep' : 'manager')
    navigate(targetUrl)
  }

  return (
    <button
      onClick={handleClick}
      title={goRep ? 'Switch to Canvassing (rep) view' : 'Switch to Manager view'}
      aria-label={goRep ? 'Switch to Canvassing view' : 'Switch to Manager view'}
      className={`flex items-center gap-1.5 pl-2.5 pr-3 py-2 rounded-full bg-white/20 active:bg-white/30 text-white text-xs font-semibold shrink-0 ${className}`}
    >
      <Icon className="w-4 h-4" />
      <span>{label}</span>
    </button>
  )
}
