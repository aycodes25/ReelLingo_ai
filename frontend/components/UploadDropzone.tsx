"use client";

import { useState, useRef, type DragEvent, type ChangeEvent } from "react";

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
    const file = event.dataTransfer.files[0];
    if (file) {
      setFileName(file.name);
      onFileSelected(file);
    }
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      setFileName(file.name);
      onFileSelected(file);
    }
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`cursor-pointer rounded-2xl border-2 border-dashed p-12 text-center transition-colors ${
        isDragging ? "border-violet-500 bg-violet-500/10" : "border-gray-600"
      }`}
    >
      <input ref={inputRef} type="file" accept="video/*" className="hidden" onChange={handleChange} />
      <p className="text-gray-100">{fileName ?? "Drop your video here or click to browse"}</p>
    </div>
  );
}
