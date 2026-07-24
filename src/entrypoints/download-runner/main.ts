// Firefox / Safari fallback engine host (hidden extension page).
// Used when chrome.offscreen is unavailable. Same engine code as offscreen.ts.
import { bootstrapHost } from '@/lib/engine/hostRuntime';

export default defineUnlistedScript(() => {
  bootstrapHost('runner');
});
