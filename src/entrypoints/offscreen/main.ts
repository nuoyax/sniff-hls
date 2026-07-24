// Chrome.offscreen document host: boots the download engine in a DOM context
// where Blob / URL.createObjectURL / chrome.downloads are available.
// The engine code is identical to the Firefox runner page — only the host differs.
import { bootstrapHost } from '@/lib/engine/hostRuntime';

export default defineUnlistedScript(() => {
  bootstrapHost('offscreen');
});
