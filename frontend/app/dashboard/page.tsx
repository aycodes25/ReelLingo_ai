"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import UploadDropzone from "@/components/UploadDropzone";
import LanguagePicker from "@/components/LanguagePicker";
import VoiceToggle from "@/components/VoiceToggle";
import { createJob } from "@/lib/api";

const SOURCE_LANGUAGES = [
  { code: "yo", label: "Yoruba", flag: "🇳🇬" },
  { code: "pcm", label: "Pidgin", flag: "🇳🇬" },
  { code: "tw", label: "Twi", flag: "🇬🇭" },
];

const TARGET_LANGUAGES = [
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "es", label: "Spanish", flag: "🇪🇸" },
  { code: "fr", label: "French", flag: "🇫🇷" },
];

export default function DashboardPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [sourceLanguage, setSourceLanguage] = useState("yo");
  const [targetLanguage, setTargetLanguage] = useState("en");
  const [voiceClone, setVoiceClone] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit() {
    if (!file) {
      setErrorMessage("Please select a video first.");
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const job = await createJob(file, sourceLanguage, targetLanguage, voiceClone);
      router.push(`/jobs/${job.id}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl space-y-8 p-8">
      <h1 className="text-3xl font-bold text-white">Dashboard</h1>
      <UploadDropzone onFileSelected={setFile} />
      <LanguagePicker
        label="Source language"
        options={SOURCE_LANGUAGES}
        value={sourceLanguage}
        onChange={setSourceLanguage}
      />
      <LanguagePicker
        label="Target language"
        options={TARGET_LANGUAGES}
        value={targetLanguage}
        onChange={setTargetLanguage}
      />
      <VoiceToggle checked={voiceClone} onChange={setVoiceClone} />
      {errorMessage && <p className="text-red-400">{errorMessage}</p>}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={isSubmitting}
        className="rounded-full bg-gradient-to-r from-violet-600 to-pink-500 px-6 py-3 font-semibold text-white disabled:opacity-50"
      >
        {isSubmitting ? "Uploading..." : "Dub My Video"}
      </button>
    </main>
  );
}
