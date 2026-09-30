import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ChevronRight, Languages } from "lucide-react";
import BrandLogo from "@/components/BrandLogo";
import VideoPlayer from "@/components/VideoPlayer";
import type { WatchData } from "@/lib/types";

export const dynamic = "force-dynamic";

// Server-side requests can reach the API on an internal address (e.g. http://backend:8000 in Docker).
const API = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function loadWatch(slug: string): Promise<WatchData | null> {
  try {
    const response = await fetch(`${API}/public/watch/${encodeURIComponent(slug)}`, { cache: "no-store" });
    return response.ok ? response.json() : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const data = await loadWatch((await params).slug);
  if (!data) return { title: "Video not found — ReelLingo" };
  const description = data.description || `Dubbed from ${data.source_language} into ${data.target_language} with ReelLingo.`;
  return {
    title: `${data.title} (${data.target_language}) — ReelLingo`,
    description,
    openGraph: {
      title: `${data.title} — now in ${data.target_language}`,
      description,
      type: "video.other",
      ...(data.video_url ? { videos: [{ url: data.video_url }] } : {}),
    },
    twitter: { card: "summary_large_image", title: `${data.title} — now in ${data.target_language}`, description },
  };
}

export default async function WatchPage({ params }: { params: Promise<{ slug: string }> }) {
  const data = await loadWatch((await params).slug);
  if (!data) notFound();

  return (
    <div className="watch-page">
      <header className="site-header">
        <div className="container">
          <BrandLogo variant="landing" size={32} />
          <div className="site-header-actions">
            <Link href="/signup" className="btn btn-primary btn-sm">Dub your videos free</Link>
          </div>
        </div>
      </header>
      <main className="container watch-body">
        <div className="lang-path watch-langs">
          <span>{data.source_language}</span><ChevronRight size={16} /><span className="to">{data.target_language}</span>
        </div>
        <h1>{data.title}</h1>
        <VideoPlayer
          src={data.video_url}
          label={`Dubbed · ${data.target_language}`}
          compareSrc={data.original_url}
          compareLabel={`Original · ${data.source_language}`}
          captionsSrc={data.captions_url}
          audioOnly={data.media_type === "audio"}
        />
        {data.original_url && <p className="watch-hint">Tap <b>Original</b> on the player to hear the same moment in {data.source_language}.</p>}
        {data.description && <p className="watch-description">{data.description}</p>}
        {data.hashtags.length > 0 && <p className="hashtags">{data.hashtags.map((tag) => <span key={tag}>{tag}</span>)}</p>}
        <section className="cta-panel watch-cta">
          <Languages size={28} />
          <h2>Speak to the world in your own voice</h2>
          <p>ReelLingo dubs African-language videos into English, French, Spanish and 50+ languages — keeping your voice and your music.</p>
          <Link href="/signup" className="btn btn-yellow btn-lg">Try it free <ArrowRight size={18} /></Link>
        </section>
      </main>
    </div>
  );
}
