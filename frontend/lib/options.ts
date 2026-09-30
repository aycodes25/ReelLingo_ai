// Mirrors the choices the API accepts (backend/src/translation.js and render.js).
export const TONES: { value: string; label: string }[] = [
  { value: "natural", label: "Natural and conversational" },
  { value: "formal", label: "Formal and polished" },
  { value: "casual", label: "Casual, social-media friendly" },
  { value: "keep_flavour", label: "Keep the local flavour (slang, Pidgin)" },
];

export const CAPTION_STYLES: { value: string; label: string }[] = [
  { value: "classic", label: "Classic — white with outline" },
  { value: "boxed", label: "Boxed — text on a dark band" },
  { value: "bold", label: "Bold — big yellow words (TikTok)" },
  { value: "karaoke", label: "Karaoke — words light up as spoken" },
];

export const FORMATS: { value: string; label: string; hint: string }[] = [
  { value: "9:16", label: "9:16", hint: "TikTok, Reels, Shorts" },
  { value: "1:1", label: "1:1", hint: "Instagram feed" },
  { value: "4:5", label: "4:5", hint: "Instagram, Facebook" },
  { value: "16:9", label: "16:9", hint: "YouTube" },
];
