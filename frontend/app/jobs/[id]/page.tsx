"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import StatusTimeline from "@/components/StatusTimeline";
import { getJob } from "@/lib/api";
import type { Job } from "@/lib/types";

export default function JobStatusPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(null);

  useEffect(() => {
    const jobId = Number(params.id);
    const interval = setInterval(async () => {
      const updated = await getJob(jobId);
      setJob(updated);
      if (updated.status === "done") {
        clearInterval(interval);
        router.push(`/result/${jobId}`);
      }
      if (updated.status === "failed") {
        clearInterval(interval);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [params.id, router]);

  return (
    <main className="mx-auto max-w-xl space-y-8 p-8">
      <h1 className="text-3xl font-bold text-white">Processing your video</h1>
      {job ? (
        job.status === "failed" ? (
          <p className="text-red-400">{job.error_message ?? "Something went wrong."}</p>
        ) : (
          <StatusTimeline currentStep={job.current_step} />
        )
      ) : (
        <p className="text-gray-400">Loading status...</p>
      )}
    </main>
  );
}
