import type { Job } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function createJob(
  file: File,
  sourceLanguage: string,
  targetLanguage: string,
  voiceClone: boolean
): Promise<Job> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("source_language", sourceLanguage);
  formData.append("target_language", targetLanguage);
  formData.append("voice_clone", String(voiceClone));

  const response = await fetch(`${API_URL}/jobs`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Failed to create job: ${response.status}`);
  }

  return response.json();
}

export async function getJob(jobId: number): Promise<Job> {
  const response = await fetch(`${API_URL}/jobs/${jobId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch job: ${response.status}`);
  }
  return response.json();
}
