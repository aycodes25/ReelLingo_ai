import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 text-center">
      <h1 className="bg-gradient-to-r from-violet-500 to-pink-500 bg-clip-text text-5xl font-bold text-transparent">
        Speak Local. Reach Global.
      </h1>
      <p className="max-w-xl text-gray-400">
        ReelLingo automatically translates and dubs your videos from African languages into
        English, Spanish, French, and more — in minutes, not days.
      </p>
      <Link
        href="/dashboard"
        className="rounded-full bg-gradient-to-r from-violet-600 to-pink-500 px-8 py-4 text-lg font-semibold text-white shadow-lg shadow-violet-900/50"
      >
        Try for Free (No Credit Card)
      </Link>
    </main>
  );
}
