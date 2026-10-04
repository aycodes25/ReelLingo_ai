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

// Native Nigerian voices (Spitch). Mirrors backend/src/spitch.js.
export const NIGERIAN_VOICES: Record<string, { value: string; label: string }[]> = {
  yo: [{ value: "femi", label: "Femi (man)" }, { value: "sade", label: "Sade (woman)" }, { value: "segun", label: "Segun (man)" }, { value: "funmi", label: "Funmi (woman)" }],
  ha: [{ value: "aliyu", label: "Aliyu (man)" }, { value: "amina", label: "Amina (woman)" }, { value: "hasan", label: "Hasan (man)" }, { value: "zainab", label: "Zainab (woman)" }],
  ig: [{ value: "obinna", label: "Obinna (man)" }, { value: "ngozi", label: "Ngozi (woman)" }, { value: "ebuka", label: "Ebuka (man)" }, { value: "amara", label: "Amara (woman)" }],
  pcm: [{ value: "justice", label: "Justice (man)" }, { value: "boma", label: "Boma (woman)" }, { value: "tega", label: "Tega (man)" }, { value: "ufoma", label: "Ufoma (woman)" }],
};
