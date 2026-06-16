/**
 * Haptics — a tiny cross-platform "buzz" helper.
 *
 * On native iOS/Android we use Capacitor's Haptics plugin, which reaches the
 * real Taptic engine on iOS (the web Vibration API is a no-op inside iOS
 * WKWebView). On the web we fall back to navigator.vibrate, which works on
 * Android Chrome and is harmlessly ignored elsewhere.
 *
 * The plugin is dynamically imported so the package only loads on native and
 * never bloats / breaks the web bundle. Everything is best-effort: haptics are
 * a nicety, never a requirement, so all failures are swallowed.
 */
import { Capacitor } from '@capacitor/core'

export async function tapHaptic() {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Haptics, ImpactStyle } = await import('@capacitor/haptics')
      await Haptics.impact({ style: ImpactStyle.Medium })
      return
    } catch { /* plugin missing / call failed — fall through to web path */ }
  }
  try { navigator.vibrate?.(18) } catch { /* Vibration API unsupported */ }
}
