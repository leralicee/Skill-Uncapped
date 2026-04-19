const CDN = "https://sc-proxy.apati.workers.dev";
var hls = null;

if (Hls.isSupported()) {
  hls = new Hls({ maxBufferSize: 0, maxBufferLength: 30, startPosition: 0 });
  hls.on(Hls.Events.MANIFEST_PARSED, function() { video.play(); });
}

const rgx = /([a-z0-9]{10})(:?\/|$)/g;

// URL cleaner
function cleanUrl(url) {
  if (!url.toLowerCase().includes("course")) return url;
  url = url.replace(/\/$/, '');
  const parts = url.split('/');
  if (parts.length > 0) parts.pop();
  const cleaned = parts.join('/');
  if (!cleaned || cleaned.length < 10) return url;
  return cleaned;
}

// UI helpers
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

// Stream
async function stream() {
  if (hls == null) {
    alert("hls not supported, please use a modern browser such as Chrome");
    return;
  }

  document.getElementById("downloadBtn").style.display = 'none';
  document.getElementById("notesBtn").style.display = 'none';
  document.getElementById("notesPanel").style.display = 'none';
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

  // Try to find subtitle track URL from the manifest
  window._subtitleUrl = null;
  try {
    const manifestUrl = `${CDN}/${videoId}/manifest.m3u8`;
    const mResp = await fetch(manifestUrl);
    if (mResp.ok) {
      const mText = await mResp.text();
      const vttMatch = mText.match(/URI="([^"]+\.vtt[^"]*)"/i) || mText.match(/^([^\s#]+\.vtt[^\s]*)$/im);
      if (vttMatch) {
        window._subtitleUrl = vttMatch[1].startsWith('http') ? vttMatch[1] : `${CDN}/${videoId}/${vttMatch[1]}`;
      }
    }
  } catch(e) { /* no manifest or no subs, that's fine */ }

  let data = "#EXTM3U\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-TARGETDURATION:10";
  for (let i = 0; i <= last; i++) {
    data += `#EXTINF:10,\n${CDN}/${videoId}/HIDDEN4500-${String(i).padStart(5, "0")}.ts\n`;
  }

  hls.loadSource("data:application/x-mpegURL;base64," + btoa(data));
  hls.attachMedia(video);

  document.getElementById("placeholder").style.display = 'none';
  document.getElementById("video").style.display = 'block';

  document.getElementById("metaRow").style.display = 'flex';
  document.getElementById("metaId").innerHTML = 'id <span>' + videoId + '</span>';
  document.getElementById("metaParts").innerHTML = 'segments <span>' + (last + 1) + '</span>';
  setStatus('Ready — ' + (last + 1) + ' segments', 'done');
  document.getElementById("downloadBtn").style.display = 'inline-block';
  document.getElementById("notesBtn").style.display = 'inline-block';

  window._lastVideoId = videoId;
  window._lastPartCount = last;
}

// Parse VTT text into plain transcript
function parseVtt(vttText) {
  return vttText
    .split('\n')
    .filter(line => {
      const t = line.trim();
      return t &&
        !t.startsWith('WEBVTT') &&
        !t.startsWith('NOTE') &&
        !/^\d+$/.test(t) &&
        !t.includes('-->');
    })
    .map(line => line.trim())
    .filter((line, i, arr) => line !== arr[i - 1]) // dedupe consecutive identical lines
    .join(' ');
}

// Take Notes
async function takeNotes() {
  const btn = document.getElementById("notesBtn");
  const panel = document.getElementById("notesPanel");
  const content = document.getElementById("notesContent");

  btn.disabled = true;
  btn.textContent = 'Generating...';
  panel.style.display = 'block';
  content.textContent = '';

  let transcript = null;

  // 1. Try fetching subtitles
  if (window._subtitleUrl) {
    try {
      setStatus('Fetching subtitles...', 'active');
      const vttResp = await fetch(window._subtitleUrl);
      if (vttResp.ok) {
        const vttText = await vttResp.text();
        transcript = parseVtt(vttText);
      }
    } catch(e) { /* fall through */ }
  }

  // 2. No subtitles found — show a clear message
  if (!transcript || transcript.length < 50) {
    content.innerHTML = '<span style="color:var(--text-secondary)">No subtitle track found in this stream.<br>Skill-Capped may not include .vtt files for this video.</span>';
    setStatus('No subtitles found.', 'error');
    btn.disabled = false;
    btn.textContent = 'Take Notes';
    return;
  }

  setStatus('Generating notes...', 'active');

  // 3. Call DeepSeek (OpenAI-compatible)
  try {
    const resp = await fetch("https://sc-proxy.apati.workers.dev/ai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        stream: true,
        messages: [
          {
            role: "system",
            content: `You are an expert gaming coach assistant. Given a video transcript from a game guide, produce clear structured notes using markdown.

Format your notes as:
## Summary
One or two sentences on what the video covers.

## Key Concepts
Bullet points of the main ideas or mechanics explained.

## Tips & Takeaways
Actionable advice the viewer should remember.

## Common Mistakes to Avoid
If any are mentioned, list them here.

Be concise. Use plain language. Do not repeat yourself.`
          },
          {
            role: "user",
            content: "Here is the transcript:\n\n" + transcript.slice(0, 12000)
          }
        ]
      })
    });

    if (!resp.ok) {
      const err = await resp.text();
      content.textContent = 'DeepSeek API error: ' + err;
      setStatus('API error.', 'error');
      btn.disabled = false;
      btn.textContent = 'Take Notes';
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let raw = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;
        try {
          const json = JSON.parse(trimmed.slice(6));
          const delta = json.choices?.[0]?.delta?.content || '';
          raw += delta;
          content.innerHTML = markdownToHtml(raw);
          content.scrollTop = content.scrollHeight;
        } catch(e) { /* incomplete chunk */ }
      }
    }

    setStatus('Notes ready.', 'done');
  } catch(e) {
    content.textContent = 'Error: ' + e.message;
    setStatus('Notes error.', 'error');
  }

  btn.disabled = false;
  btn.textContent = 'Take Notes';
}

// Minimal markdown → HTML (headers, bullets, bold)
function markdownToHtml(md) {
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)(?=\n|$)/g, '<ul>$1</ul>')
    .replace(/<\/ul>\s*<ul>/g, '')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/^(?!<[hul]|<\/[hul]|<li|<\/li)(.+)$/gm, (m) => m.startsWith('<') ? m : '<p>' + m + '</p>');
}

// Download
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