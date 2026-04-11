// HLS init — created once on page load, reused on every stream() call (original behaviour)
const CDN = "https://sc-proxy.apati.workers.dev";
var hls = null;

if (Hls.isSupported()) {
  hls = new Hls({ maxBufferSize: 0, maxBufferLength: 30, startPosition: 0 });
  hls.on(Hls.Events.MANIFEST_PARSED, function() { video.play(); });
}

const rgx = /([a-z0-9]{10})(:?\/|$)/g;

// ── URL cleaner ──────────────────────────────────────────────────────────────
function cleanUrl(url) {
  if (!url.toLowerCase().includes("course")) return url;
  url = url.replace(/\/$/, '');
  const parts = url.split('/');
  if (parts.length > 0) parts.pop();
  const cleaned = parts.join('/');
  if (!cleaned || cleaned.length < 10) return url;
  return cleaned;
}

// ── UI helpers ───────────────────────────────────────────────────────────────
function setStatus(text, state) {
  document.getElementById("statusDot").className = 'status-dot' + (state ? ' ' + state : '');
  document.getElementById("status").textContent = text;
}

function setProgress(current, total) {
  const wrap = document.getElementById("progressWrap");
  if (!total) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'flex';
  const pct = Math.round((current / total) * 100);
  document.getElementById("progressFill").style.width = pct + '%';
  document.getElementById("progressLeft").textContent = 'segment ' + current + ' / ' + total;
  document.getElementById("progressRight").textContent = pct + '%';
}

// ── Stream ───────────────────────────────────────────────────────────────────
async function stream() {
  if (hls == null) {
    alert("hls not supported, please use a modern browser such as Chrome");
    return;
  }

  document.getElementById("downloadBtn").style.display = 'none';
  document.getElementById("metaRow").style.display = 'none';
  setProgress(0, 0);

  let rawUrl = document.getElementById("url").value;
  const cleanedUrl = cleanUrl(rawUrl);
  if (cleanedUrl !== rawUrl) {
    rawUrl = cleanedUrl;
    document.getElementById("url").value = rawUrl;
  }

  rgx.lastIndex = 0;
  let ids = [];
  let match = null;
  while (match = rgx.exec(rawUrl)) ids.push(match[1]);

  if (ids.length < 1) {
    alert("invalid url - no 10-character ID found");
    return;
  }

  const videoId = rawUrl.includes("browse3") ? ids[0] : ids[ids.length - 1];
  setStatus('Scanning — testing segment 0', 'active');

  let last = 0;
  let jump = true;

  for (let i = 300; i <= 1000; i++) {
    if (i == 1000) { alert("error finding last part"); return; }
    if (i == 0) i = 1;

    const url = `${CDN}/${videoId}/HIDDEN4500-${String(i).padStart(5, "0")}.ts`;
    setStatus('Scanning — testing segment ' + i, 'active');

    try {
      const resp = await fetch(url, { method: 'HEAD' });
      if (resp.status === 403) {
        if (i >= 50 && i % 50 == 0 && jump) { last = i; jump = true; i -= 51; continue; }
        break;
      }
      last = i;
      jump = false;
    } catch(e) {
      alert("fetch failed.\n\nError: " + e.message);
      setStatus('Fetch error.', 'error');
      return;
    }
  }

  // Build playlist — original logic preserved exactly
  let data = "#EXTM3U\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-TARGETDURATION:10";
  for (let i = 0; i <= last; i++) {
    data += `#EXTINF:10,\n${CDN}/${videoId}/HIDDEN4500-${String(i).padStart(5, "0")}.ts\n`;
  }

  // Original load order preserved exactly
  hls.loadSource("data:application/x-mpegURL;base64," + btoa(data));
  hls.attachMedia(video);

  document.getElementById("placeholder").style.display = 'none';
  document.getElementById("video").style.display = 'block';

  document.getElementById("metaRow").style.display = 'flex';
  document.getElementById("metaId").innerHTML = 'id <span>' + videoId + '</span>';
  document.getElementById("metaParts").innerHTML = 'segments <span>' + (last + 1) + '</span>';
  setStatus('Ready — ' + (last + 1) + ' segments', 'done');
  document.getElementById("downloadBtn").style.display = 'inline-block';

  window._lastVideoId = videoId;
  window._lastPartCount = last;
}

// ── Download ─────────────────────────────────────────────────────────────────
async function downloadVideo() {
  const lastVideoId = window._lastVideoId;
  const lastPartCount = window._lastPartCount;
  if (!lastVideoId) { alert("Stream a video first."); return; }

  const btn = document.getElementById("downloadBtn");
  btn.disabled = true;
  btn.textContent = 'Downloading...';

  const total = lastPartCount + 1;
  const chunks = [];
  let totalBytes = 0;

  for (let i = 0; i <= lastPartCount; i++) {
    const url = `${CDN}/${lastVideoId}/HIDDEN4500-${String(i).padStart(5, "0")}.ts`;
    setStatus('Downloading segment ' + (i + 1) + ' of ' + total, 'active');
    setProgress(i + 1, total);
    try {
      const resp = await fetch(url);
      if (!resp.ok) { console.warn('Skipping segment ' + i); continue; }
      const buf = await resp.arrayBuffer();
      chunks.push(new Uint8Array(buf));
      totalBytes += buf.byteLength;
    } catch(e) {
      alert("Download failed at segment " + i + ": " + e.message);
      btn.disabled = false; btn.textContent = 'Download';
      setStatus('Download error.', 'error');
      setProgress(0, 0);
      return;
    }
  }

  setStatus('Assembling file...', 'active');
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }

  const blob = new Blob([combined], { type: "video/mp2t" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = lastVideoId + '.ts';
  a.click();
  URL.revokeObjectURL(a.href);

  setStatus('Download complete.', 'done');
  setProgress(0, 0);
  btn.disabled = false;
  btn.textContent = 'Download';
}