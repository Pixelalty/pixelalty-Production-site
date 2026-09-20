const shell = document.querySelector('[data-demo]');
const video = shell.querySelector('video');
const placeholder = shell.querySelector('[data-demo-placeholder]');
const url = new URL('../assets/listing-video-demo.mp4', import.meta.url);
// A missing video is expected. HEAD avoids downloading it or showing a broken player.
try {
  const response = await fetch(url, { method:'HEAD', cache:'no-store' });
  if (response.ok && (response.headers.get('content-type') || '').toLowerCase().startsWith('video/')) {
    video.addEventListener('loadedmetadata', () => { placeholder.hidden = true; video.hidden = false; }, {once:true});
    video.addEventListener('error', () => { placeholder.hidden = false; video.hidden = true; });
    video.src = url.href;
  }
} catch { /* Keep the designed demo state until a playable file is available. */ }
