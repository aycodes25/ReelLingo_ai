"use client";

import { useState, useRef, type DragEvent, type ChangeEvent } from "react";
import { Check, UploadCloud, Video } from "lucide-react";

interface UploadDropzoneProps {
  onFileSelected: (file: File) => void;
}

export default function UploadDropzone({ onFileSelected }: UploadDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
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
    if (!file.type.startsWith("video/")) return;
    setFileName(file.name);
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
      <input ref={inputRef} type="file" accept="video/mp4,video/quicktime,video/x-msvideo" className="visually-hidden" onChange={handleChange} />
      <button type="button" onClick={() => inputRef.current?.click()} className="dropzone-content" aria-label="Choose or drop a video file">
        <span className="dropzone-icon">{fileName ? <Check size={22} /> : <UploadCloud size={22} />}</span>
        <span className="dropzone-title">{fileName ?? "Drop your video here"}</span>
        <span className="dropzone-subtitle">{fileName ? "Ready to translate" : "or browse your files · MP4, MOV, AVI"}</span>
        <span className="dropzone-meta"><Video size={15} /> Up to 2 GB · choose a video under your plan limit</span>
      </button>
    </div>
  );
}
