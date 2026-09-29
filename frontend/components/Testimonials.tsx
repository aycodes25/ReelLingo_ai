"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight, Star } from "lucide-react";

const STORIES = [
  { quote: "ReelLingo helped me reach 500k new subscribers in Francophone Africa by dubbing my existing content into French perfectly.", name: "nuel bassey", role: "Educational YouTuber", color: "#3d3a8f" },
  { quote: "The voice cloning is scary good. My fans in Kenya couldn't believe it was AI-dubbed Swahili. It sounds just like me!", name: "amina osei", role: "Lifestyle Influencer", color: "#d98a2b" },
  { quote: "Localizing my reviews into multiple local dialects has tripled my sponsorship value. A must-have for serious creators.", name: "osas king", role: "Tech Reviewer", color: "#1f6f78" },
  { quote: "I publish every episode in Yoruba, Hausa and English now. My community finally hears the show in the language they dream in.", name: "tolu adeyemi", role: "Podcast Host", color: "#b8475c" },
];

export default function Testimonials() {
  const trackRef = useRef<HTMLDivElement>(null);

  function scroll(direction: 1 | -1) {
    const track = trackRef.current;
    if (!track) return;
    const card = track.firstElementChild as HTMLElement | null;
    track.scrollBy({ left: direction * ((card?.offsetWidth ?? 320) + 32), behavior: "smooth" });
  }

  return (
    <>
      <div className="stories-head">
        <div>
          <span className="pill pill-coral">Success Stories</span>
          <h2>Built by creators, for creators.</h2>
        </div>
        <div className="stories-nav">
          <button type="button" className="round-btn" aria-label="Previous stories" onClick={() => scroll(-1)}><ChevronLeft size={18} /></button>
          <button type="button" className="round-btn" aria-label="Next stories" onClick={() => scroll(1)}><ChevronRight size={18} /></button>
        </div>
      </div>
      <div className="stories" ref={trackRef}>
        {STORIES.map((story) => (
          <article key={story.name} className="story">
            <div className="stars" aria-label="5 out of 5 stars">
              {Array.from({ length: 5 }, (_, index) => <Star key={index} size={16} fill="currentColor" strokeWidth={0} />)}
            </div>
            <blockquote>&ldquo;{story.quote}&rdquo;</blockquote>
            <div className="story-author">
              <span className="avatar" style={{ background: story.color }}>{initials(story.name)}</span>
              <div><strong>{story.name}</strong><span>{story.role}</span></div>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function initials(name: string) {
  return name.split(" ").map((part) => part[0]?.toUpperCase()).join("").slice(0, 2);
}
