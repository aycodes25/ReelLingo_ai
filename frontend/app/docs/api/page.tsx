import type { Metadata } from "next";
import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";

export const metadata: Metadata = {
  title: "API Reference — ReelLingo",
  description: "Automate video translation and dubbing with the ReelLingo REST API.",
};

const API = process.env.NEXT_PUBLIC_API_URL || "https://api.reellingo.ai";

const ENDPOINTS: { method: string; path: string; summary: string }[] = [
  { method: "POST", path: "/uploads", summary: "Start a resumable (tus) upload. Send the file with any tus client; the last path segment of the Location header is your upload_id." },
  { method: "POST", path: "/jobs", summary: "Create dubbing or subtitle jobs from an upload_id, a multipart `file`, a `source_url` (Google Drive, Dropbox or a direct file link) or a `youtube_video_id` from your connected channel." },
  { method: "GET", path: "/jobs", summary: "List your jobs (limit, offset)." },
  { method: "GET", path: "/jobs/{id}", summary: "Job status, outputs with signed download URLs, transcript, translation and generated metadata." },
  { method: "GET", path: "/jobs/{id}/events", summary: "Server-sent events stream that pushes the job each time it changes." },
  { method: "PATCH", path: "/jobs/{id}/segments", summary: "Edit transcript/translation lines: {\"segments\":[{\"index\":0,\"text\":\"…\",\"source_text\":\"…\"}]}." },
  { method: "POST", path: "/jobs/{id}/segments/{index}/retranslate", summary: "Retranslate one line from its (edited) original text." },
  { method: "POST", path: "/jobs/{id}/approve", summary: "Continue a job created with review=true after you've checked the translation." },
  { method: "POST", path: "/jobs/{id}/redub", summary: "Regenerate the voice after edits. Unchanged lines reuse their audio, so only edited lines use minutes." },
  { method: "GET", path: "/jobs/{id}/redub-cost", summary: "Minutes a re-dub would use with the edits saved so far." },
  { method: "POST", path: "/jobs/{id}/clips", summary: "Cut 3-5 captioned vertical clips from a finished dub (uses minutes)." },
  { method: "POST", path: "/jobs/{id}/youtube-language", summary: "Add this dub's subtitles and translated title to one of your YouTube videos: {\"video_id\":\"…\"}." },
  { method: "POST", path: "/jobs/{id}/retry", summary: "Resume a failed job from its last completed step." },
  { method: "POST", path: "/jobs/{id}/share", summary: "Enable or disable the public watch page: {\"enabled\":true}." },
  { method: "DELETE", path: "/jobs/{id}", summary: "Delete a job and all of its files." },
  { method: "GET", path: "/usage", summary: "Plan and minutes left: the plan's monthly minutes plus never-expiring extra minutes." },
  { method: "GET", path: "/usage/minutes", summary: "History of every change to your minutes." },
  { method: "GET", path: "/integrations/youtube/videos", summary: "Your own YouTube uploads (after connecting your channel in Settings)." },
  { method: "GET", path: "/languages", summary: "Supported language codes (no authentication)." },
  { method: "GET", path: "/glossary", summary: "Your glossary terms (also POST, PUT /glossary/{id}, DELETE /glossary/{id})." },
];

const JOB_FIELDS: [string, string][] = [
  ["source_language", "Language code of the speech, or \"auto\"."],
  ["target_languages", "Comma-separated codes, e.g. \"en,fr\". One job is created per language; the video is transcribed once."],
  ["upload_id | file | source_url | youtube_video_id", "Where the video comes from. YouTube videos must be from your own connected channel."],
  ["rights_confirmed", "Required: true confirms you own the video or have permission to translate it."],
  ["voice_consent", "Required when cloning a voice: true confirms the voices are yours or every speaker agreed."],
  ["mode", "\"dub\" (default) or \"subtitles\" (translated subtitles only; uses a tenth of the minutes)."],
  ["human_review", "true to have a native speaker check the transcript and translation first (uses extra minutes)."],
  ["nigerian_voice", "Native voice for Yoruba, Hausa, Igbo or Pidgin, e.g. \"sade\", \"aliyu\", \"ngozi\", \"justice\"."],
  ["voice_mode", "\"clone\" (default), \"saved\" (with voice_id) or \"standard\"."],
  ["review", "true to pause after translation so you can edit before any voice is generated."],
  ["keep_background", "Keep music and sound effects (default true)."],
  ["multi_speaker", "Detect speakers and give each their own voice."],
  ["tone", "natural | formal | casual | keep_flavour"],
  ["captions", "Burn in captions: classic | boxed | bold | karaoke"],
  ["formats", "Extra aspect ratios: \"9:16,1:1,4:5,16:9\""],
  ["lip_sync", "Re-render mouth movements to the new language (premium add-on, uses extra minutes)."],
  ["trim_to_fit", "Dub only the part of the video your plan's length limit and your minutes allow."],
];

export default function ApiDocsPage() {
  return (
    <div className="docs-page">
      <header className="site-header">
        <div className="container">
          <BrandLogo variant="landing" size={32} />
          <nav className="site-nav" aria-label="Main navigation">
            <Link href="/">Home</Link>
            <Link href="/settings#api-keys">API keys</Link>
          </nav>
        </div>
      </header>
      <main className="container docs-body">
        <h1>ReelLingo API</h1>
        <p className="docs-lead">Translate and dub videos from your own CMS, agency tooling or content pipeline. API access is included in the <Link className="link" href="/billing">Studio plan</Link>.</p>

        <h2>Authentication</h2>
        <p>Create a key in <Link className="link" href="/settings#api-keys">Settings → API keys</Link> and send it on every request, either as a bearer token or in the <code>X-API-Key</code> header. To act in a team workspace, add <code>X-Workspace: &lt;team id&gt;</code>.</p>
        <pre><code>{`curl ${API}/usage \\
  -H "Authorization: Bearer rlk_your_key"`}</code></pre>

        <h2>Create a dub</h2>
        <p>Import from a link (the simplest option):</p>
        <pre><code>{`curl -X POST ${API}/jobs \\
  -H "Authorization: Bearer rlk_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "source_url": "https://www.dropbox.com/s/abc/episode.mp4?dl=0",
    "source_language": "yo",
    "target_languages": "en,fr",
    "captions": "bold",
    "formats": "9:16",
    "rights_confirmed": true,
    "voice_consent": true
  }'`}</code></pre>
        <p>Or upload a file directly (up to 2 GB):</p>
        <pre><code>{`curl -X POST ${API}/jobs \\
  -H "Authorization: Bearer rlk_your_key" \\
  -F file=@episode.mp4 \\
  -F source_language=auto \\
  -F target_languages=en \\
  -F rights_confirmed=true \\
  -F voice_consent=true`}</code></pre>
        <p>The response is the first job, plus a <code>jobs</code> array when several languages were requested. Poll <code>GET /jobs/&#123;id&#125;</code> or stream <code>GET /jobs/&#123;id&#125;/events</code> until <code>status</code> is <code>done</code>, then download from <code>outputs[].download_url</code> (links are valid for one hour; fetch the job again for fresh ones).</p>

        <h3>Job options</h3>
        <table className="data-table">
          <thead><tr><th>Field</th><th>Description</th></tr></thead>
          <tbody>{JOB_FIELDS.map(([field, description]) => <tr key={field}><td><code>{field}</code></td><td>{description}</td></tr>)}</tbody>
        </table>

        <h3>Job status</h3>
        <p><code>queued</code> → <code>processing</code> (see <code>current_step</code>) → <code>awaiting_review</code> (with human_review the <code>review_state</code> is <code>human_pending</code> until a reviewer submits; with review=true it waits for you) → <code>done</code> or <code>failed</code>. A failed job returns its minutes automatically.</p>

        <h2>Endpoints</h2>
        <table className="data-table">
          <thead><tr><th>Method</th><th>Path</th><th>Description</th></tr></thead>
          <tbody>{ENDPOINTS.map((endpoint) => <tr key={`${endpoint.method} ${endpoint.path}`}><td><span className={`method method-${endpoint.method.toLowerCase()}`}>{endpoint.method}</span></td><td><code>{endpoint.path}</code></td><td>{endpoint.summary}</td></tr>)}</tbody>
        </table>

        <h2>Errors &amp; limits</h2>
        <p>Errors return JSON with a <code>detail</code> message. <code>402</code> responses include a <code>code</code>: <code>minutes</code> (not enough minutes; includes <code>needed</code> and <code>available</code>), <code>too_long</code> (retry with <code>trim_to_fit</code>), <code>free_paused</code>, <code>targets</code> or <code>feature</code>. <code>400</code> with <code>rights</code> or <code>voice_consent</code> means a confirmation is missing. Requests are rate-limited; <code>429</code> means slow down.</p>
      </main>
    </div>
  );
}
