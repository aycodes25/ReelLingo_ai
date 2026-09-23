"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getJob } from "@/lib/api";
import type { Job } from "@/lib/types";

export default function ResultPage() {
  const params = useParams<{ id: string }>();
  const [job, setJob] = useState<Job | null>(null);

  useEffect(() => {
    getJob(Number(params.id)).then(setJob);
  }, [params.id]);

  if (!job) {
    return <p className="p-8 text-gray-400">Loading...</p>;
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8 text-center">
      <h1 className="text-3xl font-bold text-white">Your video is ready! 🎉</h1>
      {job.output_video_url && (
        <video src={job.output_video_url} controls className="w-full rounded-2xl" />
      )}
      <div className="flex justify-center gap-4">
        {job.output_video_url && (
          <a
            href={job.output_video_url}
            download
            className="rounded-full bg-violet-600 px-6 py-3 font-semibold text-white"
          >
            Download Video
          </a>
        )}
        {job.output_srt_url && (
          <a
            href={job.output_srt_url}
            download
            className="rounded-full border border-gray-600 px-6 py-3 font-semibold text-white"
          >
            Download Subtitles (.SRT)
          </a>
        )}
      </div>
    </main>
  );
}
