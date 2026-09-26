"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, AudioLines, CircleAlert, Clock3, Languages, Sparkles } from "lucide-react";
import AppHeader from "@/components/AppHeader";
import UploadDropzone from "@/components/UploadDropzone";
import LanguagePicker from "@/components/LanguagePicker";
import VoiceMatchStatus from "@/components/VoiceMatchStatus";
import { ApiError, clearStoredToken, createJob, getApiHealth, getJobs, getLanguages, getStoredToken } from "@/lib/api";
import type { ApiHealth, Job, LanguageOption } from "@/lib/types";

export default function DashboardPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [sourceLanguage, setSourceLanguage] = useState("auto");
  const [targetLanguage, setTargetLanguage] = useState("en");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [languages, setLanguages] = useState<LanguageOption[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [health, setHealth] = useState<ApiHealth | null>(null);

  useEffect(() => {
    if (!getStoredToken()) {
      router.replace("/login");
      return;
    }
    let active = true;
    getLanguages().then((items) => {
      if (active) setLanguages(items);
    }).catch(() => {
      if (active) setErrorMessage("Could not reach the language service. Check that the API is running.");
    });
    getApiHealth().then((status) => {
      if (!active) return;
      if (status.mode === "live" && getStoredToken() === "local-demo-token") {
        clearStoredToken();
        router.replace("/login");
        return;
      }
      setHealth(status);
    }).catch(() => undefined);
    getJobs().then((items) => {
      if (active) setJobs(items);
    }).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 401) {
        clearStoredToken();
        router.replace("/login");
        return;
      }
      if (!active) return;
      setErrorMessage(error instanceof Error ? error.message : "Could not load recent projects.");
    });
    return () => { active = false; };
  }, [router]);

  async function handleSubmit() {
    if (!file) {
      setErrorMessage("Please select a video first.");
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      if (sourceLanguage === targetLanguage) {
        throw new Error("Choose a different target language.");
      }
      if (health?.mode !== "live") {
        throw new Error("Add OPENAI_API_KEY to backend/.env to enable live transcription and translation.");
      }
      if (!health.capabilities.voiceClone) {
        throw new Error("Add ELEVENLABS_API_KEY to backend/.env to dub in the original speaker's voice.");
      }
      const job = await createJob(file, sourceLanguage, targetLanguage, true);
      router.push(`/jobs/${job.id}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="app-shell">
      <AppHeader active="studio" />
      <main className="studio-main">
        <section className="studio-heading">
          <div>
            <p className="eyebrow"><span className="eyebrow-dot" /> CREATOR STUDIO</p>
            <h1>Make your next video <span>travel.</span></h1>
            <p className="studio-intro">Bring your words to new audiences. Start with a video and choose where it should go.</p>
          </div>
          <div className="studio-count"><Languages size={17} /><strong>{(health?.capabilities.languages ?? languages.length) || "50+"}</strong><span>languages</span></div>
        </section>

        {health?.mode === "demo" && (
          <div className="notice notice-demo"><CircleAlert size={18} /><span><strong>Live processing is unavailable.</strong> Add OPENAI_API_KEY and ELEVENLABS_API_KEY to backend/.env, then restart the backend.</span></div>
        )}
        {health?.mode === "live" && !health.capabilities.voiceClone && (
          <div className="notice notice-demo"><CircleAlert size={18} /><span><strong>Speaker matching is unavailable.</strong> Add ELEVENLABS_API_KEY to backend/.env, then restart the backend.</span></div>
        )}

        <div className="studio-grid">
          <section className="studio-form" aria-labelledby="new-dub-title">
            <div className="section-heading">
              <div className="step-index">01</div>
              <div><h2 id="new-dub-title">New translation</h2><p>One video, a whole new audience.</p></div>
            </div>
            <UploadDropzone onFileSelected={setFile} />
            <div className="language-pair">
              <LanguagePicker label="FROM" options={languages} value={sourceLanguage} onChange={setSourceLanguage} />
              <span className="language-arrow" aria-hidden="true"><ArrowRight size={17} /></span>
              <LanguagePicker label="TO" options={languages.filter((language) => language.code !== "auto")} value={targetLanguage} onChange={setTargetLanguage} />
            </div>
            <VoiceMatchStatus enabled={Boolean(health?.capabilities.voiceClone)} />
            {errorMessage && <p role="alert" className="form-error">{errorMessage}</p>}
            <button type="button" onClick={handleSubmit} disabled={isSubmitting || !file || languages.length === 0 || health?.mode !== "live" || !health.capabilities.voiceClone} className="primary-action">
              {isSubmitting ? "Uploading video…" : "Translate video"}<ArrowRight size={17} />
            </button>
            <p className="form-footnote"><Sparkles size={14} /> Your original video stays unchanged.</p>
          </section>

          <aside className="project-rail">
            <div className="section-heading recent-heading">
              <div className="step-index step-index-muted"><Clock3 size={17} /></div>
              <div><h2>Recent projects</h2><p>Your latest translations</p></div>
            </div>
            {jobs.length ? (
              <ul className="project-list">
                {jobs.map((job) => (
                  <li key={job.id}>
                    <Link href={job.status === "done" ? `/result/${job.id}` : `/jobs/${job.id}`} className="project-row">
                      <span className="project-icon"><AudioLines size={18} /></span>
                      <span className="project-copy"><strong>{sourceLabel(job, languages)} <span>to</span> {languageName(languages, job.target_language)}</strong><small>Project #{job.id} · {job.current_step.replaceAll("_", " ")}</small></span>
                      <span className={`status-chip status-${job.status}`}>{job.status}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-projects"><span className="empty-project-icon"><AudioLines size={21} /></span><strong>Your projects will show up here</strong><span>Finished and in-progress dubs, all in one place.</span></div>
            )}
            <div className="studio-tip"><span className="tip-mark">✳</span><p><strong>Made for every accent.</strong> Yoruba, Hausa, Swahili, French, Hindi, Japanese and more.</p></div>
          </aside>
        </div>
      </main>
    </div>
  );
}

function languageName(languages: LanguageOption[], code: string) {
  return languages.find((language) => language.code === code)?.name || code;
}

function sourceLabel(job: Job, languages: LanguageOption[]) {
  if (job.source_language === "auto" && job.detected_languages.length) {
    return job.detected_languages.map((language) => language.name).join(" + ");
  }
  return languageName(languages, job.source_language);
}
