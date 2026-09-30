"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CircleCheck, ChevronDown, Gift, Info, Languages, Upload, Video, Zap } from "lucide-react";
import AppShell from "@/components/AppShell";
import NewProjectForm from "@/components/NewProjectForm";
import ProjectRow from "@/components/ProjectRow";
import { ApiError, clearStoredToken, getApiHealth, getJobs, getLanguages, getStoredToken, getUsage } from "@/lib/api";
import type { ApiHealth, Job, LanguageOption, Usage } from "@/lib/types";

export default function DashboardPage() {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [languages, setLanguages] = useState<LanguageOption[]>([]);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [health, setHealth] = useState<ApiHealth | null>(null);
  const [apiUnreachable, setApiUnreachable] = useState(false);

  useEffect(() => {
    if (!getStoredToken()) return;
    let active = true;
    const handleAuthError = (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) {
        clearStoredToken();
        router.replace("/login");
        return true;
      }
      return false;
    };
    getLanguages().then((items) => { if (active) setLanguages(items); }).catch(() => { if (active) setApiUnreachable(true); });
    getApiHealth().then((status) => { if (active) setHealth(status); }).catch(() => { if (active) setApiUnreachable(true); });
    getUsage().then((value) => { if (active) setUsage(value); }).catch(handleAuthError);
    getJobs(4).then((items) => { if (active) setJobs(items); }).catch((error: unknown) => {
      if (handleAuthError(error) || !active) return;
      setJobs([]);
      setErrorMessage(error instanceof Error ? error.message : "Could not load recent projects.");
    });
    return () => { active = false; };
  }, [router]);

  const setupProblem = health?.mode === "demo"
    ? "Add OPENAI_API_KEY to backend/.env to enable live transcription and translation."
    : health && !health.capabilities.voiceClone
      ? "Add ELEVENLABS_API_KEY to backend/.env to dub in the original speaker's voice."
      : null;

  const videoLimit = usage?.max_videos_per_month || 1;
  const usedPercent = usage ? Math.min(100, Math.round((usage.videos_this_month / videoLimit) * 100)) : 0;
  const engine = apiUnreachable ? { label: "OFFLINE", dot: "is-off" } : !health ? { label: "CHECKING", dot: "is-warn" } : setupProblem ? { label: "SETUP NEEDED", dot: "is-warn" } : { label: "ONLINE", dot: "" };

  return (
    <AppShell crumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Projects" }]}>
      <div className="page-head">
        <div>
          <h1>Creator Dashboard</h1>
          <p>Manage your video translations and reach new audiences across Africa.</p>
        </div>
        <div className="status-strip" role="status">
          <span><i className={`dot ${engine.dot}`} /><b>AI ENGINE: {engine.label}</b></span>
          <i className="sep" />
          <span className="usage"><Zap size={16} /><strong>{usage ? formatMinutes(usage.minutes_this_month) : "—"} min used</strong> this month</span>
        </div>
      </div>

      <div className="dash-grid">
        <section className="card create-card" id="new-project" aria-labelledby="create-title">
          <div className="create-card-head">
            <div>
              <h2 id="create-title"><Upload size={20} />Create New Project</h2>
              <p className="card-sub">Upload your video and configure your translation settings.</p>
            </div>
            <span title="Your original video stays unchanged. We create a new dubbed copy." style={{ color: "var(--muted)" }}><Info size={18} /></span>
          </div>
          <div className="create-card-body">
            <NewProjectForm languages={languages} usage={usage} health={health} setupProblem={setupProblem} />
            <div className="feature-chips">
              <span className="feature-chip"><span><CircleCheck size={15} /></span>Voice Cloning</span>
              <span className="feature-chip"><span><CircleCheck size={15} /></span>Background Music Kept</span>
              <span className="feature-chip"><span><CircleCheck size={15} /></span>SRT, VTT &amp; Burned-in Captions</span>
            </div>
            {errorMessage && <p role="alert" className="form-error">{errorMessage}</p>}
          </div>
        </section>

        <div className="dash-side">
          <section className="credits-card" aria-label="Usage credits">
            <div className="credits-head"><span><Languages size={16} /></span>USAGE CREDITS</div>
            <div className="credits-figure">
              <strong>{usage ? usage.videos_this_month.toLocaleString() : "—"}</strong>
              <span>of {videoLimit} video{videoLimit === 1 ? "" : "s"} used</span>
            </div>
            <div className="credits-bar" role="progressbar" aria-valuenow={usedPercent} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${usedPercent}%` }} /></div>
            <div className="credits-foot">
              <span>{usedPercent}% of monthly limit{usage?.credits.length ? ` · +${usage.credits.length} credit${usage.credits.length === 1 ? "" : "s"}` : ""}</span>
              <Link href="/billing">{usage?.tier === "free" ? "Upgrade Plan" : "Manage Plan"}</Link>
            </div>
          </section>

          <section className="card announcements" id="announcements" aria-labelledby="announcements-title">
            <h2 id="announcements-title">System Announcements</h2>
            {apiUnreachable ? (
              <div className="notice-box is-danger"><strong>API unreachable</strong>We can&apos;t reach the ReelLingo API. Check that the backend is running.</div>
            ) : setupProblem ? (
              <div className="notice-box is-danger"><strong>Live processing unavailable</strong>{setupProblem} Then restart the backend.</div>
            ) : health ? (
              <div className="notice-box is-success"><strong><CircleCheck size={13} />All systems operational</strong>Transcription, translation and voice cloning are ready.</div>
            ) : null}
            <div className="notice-box is-info">
              <strong><Zap size={13} />{health?.capabilities.languages || "50+"} Languages Available</strong>
              ReelLingo supports Yoruba, Igbo, Hausa, Swahili, Amharic, Wolof, Lingala and more for dubbing.
            </div>
            <div className="notice-box is-warm">
              <strong><Gift size={13} />Invite a creator, both get a free video</strong>
              Share your referral link from <Link href="/settings#referral" className="link">Settings</Link>. When they finish their first dub, you each get a bonus credit.
            </div>
            <div className="notice-box is-neutral">
              <strong>Your plan limits</strong>
              {usage ? `Videos up to ${usage.max_video_minutes} minute${usage.max_video_minutes === 1 ? "" : "s"} long, ${videoLimit} per month and ${usage.plan.max_targets} language${usage.plan.max_targets === 1 ? "" : "s"} per upload on the ${usage.plan.name} plan.${usage.plan.watermark ? " Exports carry a small ReelLingo watermark." : ""}` : "Loading your plan details…"}
            </div>
          </section>
        </div>
      </div>

      <div className="section-row">
        <div>
          <h2>Recent Projects</h2>
          <p>Keep track of your current and past translation jobs.</p>
        </div>
        <Link href="/projects" className="btn btn-outline btn-sm" style={{ borderColor: "var(--primary)" }}>View All Projects <ChevronDown size={16} style={{ transform: "rotate(-90deg)" }} /></Link>
      </div>
      {jobs === null ? (
        <div className="project-list">{[0, 1, 2].map((key) => <div key={key} className="skeleton" style={{ height: 82 }} />)}</div>
      ) : jobs.length ? (
        <ul className="project-list">{jobs.map((job) => <ProjectRow key={job.id} job={job} languages={languages} onRemoved={(id) => setJobs((current) => (current || []).filter((item) => item.id !== id))} />)}</ul>
      ) : (
        <div className="empty-state">
          <span><Video size={24} /></span>
          <strong>No projects yet</strong>
          Upload your first video above and it will show up here.
        </div>
      )}
    </AppShell>
  );
}

function formatMinutes(minutes: number) {
  return minutes >= 100 ? Math.round(minutes).toLocaleString() : minutes.toLocaleString(undefined, { maximumFractionDigits: 1 });
}
