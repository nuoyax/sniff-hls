// Chrome.offscreen document host: boots the download engine in a DOM context
// where Blob / URL.createObjectURL / chrome.downloads are available.
// Loaded by offscreen/index.html as a normal page script (not defineUnlistedScript —
// that form is for standalone .js entrypoints and gets stripped from HTML builds).
import { bootstrapHost } from '@/lib/engine/hostRuntime';

bootstrapHost('offscreen');
