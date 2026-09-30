"use client";

import { useState, useRef, type DragEvent, type ChangeEvent, type ReactNode } from "react";
import { CircleCheck, Upload } from "lucide-react";

interface UploadDropzoneProps {
  onFileSelected: (file: File) => void;
  children?: ReactNode;
}

export const ACCEPTED_TYPES = [
  "video/mp4", "video/quicktime", "video/x-msvideo", "video/webm", "video/x-matroska",
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/ogg", "audio/webm", "audio/flac",
];
const ACCEPTED_EXTENSIONS = [".mp4", ".mov", ".avi", ".webm", ".mkv", ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"];

function isAccepted(file: File) {
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  return ACCEPTED_TYPES.includes(file.type) || (!file.type && ACCEPTED_EXTENSIONS.includes(extension));
}

export default function UploadDropzone({ onFileSelected, children }: UploadDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<string | null>(null);
  const [rejected, setRejected] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    selectFile(event.dataTransfer.files[0]);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    selectFile(event.target.files?.[0]);
  }

  function selectFile(file: File | undefined) {
    if (!file) return;
    if (!isAccepted(file)) {
      setRejected(true);
      return;
    }
    setRejected(false);
    setFileName(file.name);
    setFileSize(`${(file.size / (1024 * 1024)).toFixed(1)} MB`);
    onFileSelected(file);
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={`dropzone ${isDragging ? "is-dragging" : ""} ${fileName ? "has-file" : ""}`}
    >
      <span className="dropzone-limit">MAX 2 GB</span>
      <input ref={inputRef} type="file" accept={[...ACCEPTED_TYPES, ...ACCEPTED_EXTENSIONS].join(",")} className="visually-hidden" onChange={handleChange} tabIndex={-1} />
      <button type="button" onClick={() => inputRef.current?.click()} className="dropzone-pick" aria-label={fileName ? `Selected ${fileName}. Choose a different video` : "Choose or drop a video file"}>
        <span className="dropzone-icon">{fileName ? <CircleCheck size={30} /> : <Upload size={30} />}</span>
        <span className="dropzone-title">{fileName ?? "Click to upload or drag and drop"}</span>
        <span className="dropzone-sub">
          {rejected ? "That file type isn't supported. Choose a video (MP4, MOV, AVI, WebM, MKV) or audio file (MP3, WAV, M4A)." : fileName ? `${fileSize} · Click to choose a different video` : "Video (MP4, MOV, AVI, WebM, MKV) or audio (MP3, WAV, M4A) — podcasts welcome"}
        </span>
      </button>
      {children}
    </div>
  );
}
