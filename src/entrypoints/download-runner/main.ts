// Firefox / Safari fallback engine host (hidden extension page).
// Used when chrome.offscreen is unavailable. Same engine code as offscreen.
import { bootstrapHost } from '@/lib/engine/hostRuntime';

bootstrapHost('runner');
