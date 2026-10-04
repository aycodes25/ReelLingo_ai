import type { Metadata } from "next";
import Link from "next/link";
import LegalLayout, { loadLegalDetails } from "@/components/LegalLayout";

export const metadata: Metadata = {
  title: "Privacy Policy · ReelLingo",
  description: "How ReelLingo collects, uses and protects your personal data, and your rights under Nigeria's Data Protection Act 2023.",
};

export default async function PrivacyPage() {
  const legal = await loadLegalDetails();
  return (
    <LegalLayout title="Privacy Policy" updated={legal.terms_version}>
      <p>
        This policy explains what personal data {legal.company} (&ldquo;ReelLingo&rdquo;, &ldquo;we&rdquo;) collects when you use our website and apps,
        why, who we share it with, and the rights you have under the Nigeria Data Protection Act 2023 (NDPA) and other laws that may apply to you.
      </p>

      <h2 id="controller">1. Who we are</h2>
      <p>
        {legal.company}, {legal.address}, is the data controller for your account data. For privacy questions or to use any of your rights,
        email <a href={`mailto:${legal.privacy_email}`}>{legal.privacy_email}</a>.
      </p>

      <h2 id="data">2. What we collect</h2>
      <ul>
        <li><b>Account details:</b> your name, email address, password (stored securely by our login provider, never in plain text), creator type, and optionally your WhatsApp number.</li>
        <li><b>Your content:</b> the videos and audio you upload or import, and what we make from them: transcripts, translations, subtitles, dubbed audio and video, short clips and titles.</li>
        <li><b id="voice">Voice data:</b> when you choose voice cloning or save a voice, we create a digital model of the speaker&apos;s voice. Voice models can identify a person, so we treat them as sensitive personal data and only create them with your explicit consent (see section 4).</li>
        <li><b>Payments:</b> what you bought, amounts and dates. Card and bank details are handled by Paystack or Stripe; we never see or store your full card number.</li>
        <li><b>Connected accounts:</b> if you connect YouTube, we store an access token (encrypted) and your channel name, and read your list of uploads when you ask us to.</li>
        <li><b>Usage and technical data:</b> minutes used, projects created, when you last signed in, your IP address, browser type, and error reports, to keep the service secure and working.</li>
      </ul>

      <h2 id="use">3. Why we use it, and our lawful basis</h2>
      <ul>
        <li><b>To provide the service</b> you sign up for (contract): transcribing, translating, dubbing and subtitling your videos, storing your projects, and running your account and minutes.</li>
        <li><b>To take payments</b> and keep financial records (contract and legal obligation).</li>
        <li><b>To clone or save a voice</b> (your explicit consent, given each time you choose it).</li>
        <li><b>To send you notifications</b> about your projects by email or WhatsApp (contract; WhatsApp only if you turn it on).</li>
        <li><b>To keep ReelLingo safe</b>, prevent fraud and abuse, scan uploads for viruses, and fix problems (legitimate interests).</li>
        <li><b>To improve ReelLingo</b> using usage statistics (legitimate interests). We do <b>not</b> use your videos or voice to train our own AI models, and we do not sell your personal data.</li>
      </ul>

      <h2 id="voice-consent">4. Voice cloning and consent</h2>
      <p>
        Before a voice is cloned, you must confirm it is your own voice or that every speaker has agreed. Temporary voice clones made for a project are
        deleted from our voice provider as soon as the dub is finished. Saved voices are kept until you delete them in Settings, which also deletes them
        from our voice provider. You can withdraw consent at any time by deleting the voice; this doesn&apos;t affect dubs already made.
      </p>

      <h2 id="sharing">5. Who we share data with</h2>
      <p>We share only what each service needs to do its job, under contracts that require them to protect it:</p>
      <ul>
        <li><b>Supabase</b>: database and sign-in.</li>
        <li><b>Cloudflare (R2)</b>: storage of your uploaded and finished files.</li>
        <li><b>OpenAI</b>: transcription, translation, titles and short-clip selection.</li>
        <li><b>ElevenLabs</b>: voice generation, voice cloning and transcription.</li>
        <li><b>Spitch</b>: Nigerian-language voices, translation and Yoruba tone marks.</li>
        <li><b>sync.so</b>: lip-sync, only when you choose it.</li>
        <li><b>Paystack and Stripe</b>: payments.</li>
        <li><b>Resend and Meta (WhatsApp)</b>: notifications.</li>
        <li><b>Google (YouTube)</b>: only when you connect your channel and ask us to import, publish or add a language.</li>
        <li><b>Sentry</b>: error reports to help us fix problems.</li>
        <li><b>Human reviewers:</b> if you choose human review, a vetted native-speaker reviewer sees that project&apos;s transcript, translation and video, and is bound to keep it confidential.</li>
      </ul>
      <p>We may also disclose data when the law requires it, for example to comply with a court order.</p>

      <h2 id="transfers">6. International transfers</h2>
      <p>
        Some of the services above process data outside Nigeria (for example in the United States or the European Union). When that happens we rely
        on the safeguards the NDPA allows, such as the provider&apos;s data-protection terms and standard contractual clauses, and we only send what is needed.
      </p>

      <h2 id="retention">7. How long we keep data</h2>
      <ul>
        <li>Uploaded and finished video files are deleted automatically a set number of days after a project is created (currently 30 days unless we tell you otherwise). Transcripts and project details stay in your account until you delete the project or your account.</li>
        <li>Saved voices are kept until you delete them.</li>
        <li>Payment records are kept for as long as tax and accounting laws require (usually six years), even if you delete your account.</li>
        <li>When you delete your account we delete your profile, projects, files, voices and minutes history.</li>
      </ul>

      <h2 id="rights">8. Your rights</h2>
      <p>Under the NDPA you have the right to:</p>
      <ul>
        <li><b>Be informed</b> about how we use your data (this policy).</li>
        <li><b>Access</b> your data and get a copy: <Link href="/settings#privacy">Settings → Your data → Download my data</Link>.</li>
        <li><b>Correct</b> inaccurate data: edit your profile in Settings, or ask us.</li>
        <li><b>Delete</b> your data: <Link href="/settings#privacy">Settings → Your data → Delete my account</Link>, or delete individual projects and voices.</li>
        <li><b>Restrict or object</b> to some uses, and <b>withdraw consent</b> at any time.</li>
        <li><b>Data portability:</b> the download is a machine-readable JSON file.</li>
        <li><b>Not be subject to decisions made only by automated means</b> that significantly affect you. We don&apos;t make such decisions.</li>
      </ul>
      <p>
        Email <a href={`mailto:${legal.privacy_email}`}>{legal.privacy_email}</a> to use any right. We reply within 30 days. If you&apos;re not satisfied,
        you can complain to the Nigeria Data Protection Commission (NDPC) at <a href="https://ndpc.gov.ng" target="_blank" rel="noreferrer">ndpc.gov.ng</a>.
      </p>

      <h2 id="security">9. Security and breaches</h2>
      <p>
        We use encryption in transit, encrypted storage of connection tokens, private file links that expire, access controls, virus scanning of uploads
        and regular backups. If a breach is likely to put your rights at risk, we will notify the NDPC within 72 hours and tell you without undue delay.
      </p>

      <h2 id="children">10. Children</h2>
      <p>ReelLingo is for people aged 18 and over. Don&apos;t upload videos of children unless you are their parent or guardian or have that person&apos;s consent.</p>

      <h2 id="cookies">11. Cookies and local storage</h2>
      <p>
        We use your browser&apos;s storage only for things the site needs to work: keeping you signed in, remembering your workspace and a referral code.
        We don&apos;t use advertising cookies or sell data to advertisers.
      </p>

      <h2 id="changes">12. Changes to this policy</h2>
      <p>If we change this policy in a way that matters, we&apos;ll tell you in the app and ask you to accept the new version before you continue.</p>
    </LegalLayout>
  );
}
