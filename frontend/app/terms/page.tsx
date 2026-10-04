import type { Metadata } from "next";
import Link from "next/link";
import LegalLayout, { loadLegalDetails } from "@/components/LegalLayout";

export const metadata: Metadata = {
  title: "Terms of Service · ReelLingo",
  description: "The rules for using ReelLingo: your content, voice cloning, minutes, payments and refunds.",
};

export default async function TermsPage() {
  const legal = await loadLegalDetails();
  return (
    <LegalLayout title="Terms of Service" updated={legal.terms_version}>
      <p>
        These terms are an agreement between you and {legal.company}, {legal.address} (&ldquo;ReelLingo&rdquo;, &ldquo;we&rdquo;). By creating an account or
        using ReelLingo you accept them, together with our <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2>1. Who can use ReelLingo</h2>
      <p>You must be at least 18 and able to enter a binding contract. If you use ReelLingo for a business, church or other organisation, you accept these terms on its behalf.</p>

      <h2>2. Your account</h2>
      <p>Keep your password and API keys safe; you&apos;re responsible for what happens in your account. Tell us straight away at <a href={`mailto:${legal.support_email}`}>{legal.support_email}</a> if you think someone else has accessed it.</p>

      <h2>3. Your content</h2>
      <ul>
        <li><b>You keep ownership</b> of the videos you upload and of the dubs, subtitles and clips we make from them.</li>
        <li>You give us permission to store and process your content only to provide ReelLingo to you (for example to transcribe, translate, voice and render it), including through the service providers listed in our Privacy Policy.</li>
        <li><b>You must own your content or have permission</b> to translate and publish it. You confirm this for every project. Importing from social media is limited to your own connected YouTube channel.</li>
      </ul>

      <h2>4. Voice cloning</h2>
      <ul>
        <li>Only clone your own voice, or the voice of someone who has clearly agreed. You confirm this each time.</li>
        <li>Never use ReelLingo to impersonate anyone, to make someone appear to say something they didn&apos;t, or to deceive people about who is speaking.</li>
        <li>We may remove voices and suspend accounts that break these rules, and report illegal use to the authorities.</li>
      </ul>

      <h2>5. Things you must not do</h2>
      <p>Don&apos;t use ReelLingo to create or share content that is illegal; infringes copyright; is defamatory, hateful or harassing; sexualises children; incites violence; spreads election or health misinformation; or contains malware. Don&apos;t try to break, overload or get around the limits of the service, or resell it without our written agreement.</p>

      <h2>6. AI output</h2>
      <p>
        ReelLingo uses artificial intelligence. Translations, voices and subtitles can contain mistakes, especially with names, slang and tone. Review your
        results before you publish them; you&apos;re responsible for what you publish. Human review by a native speaker is available as an add-on.
      </p>

      <h2>7. Plans, minutes and payments</h2>
      <ul>
        <li><b>Minutes:</b> 1 minute dubs 1 minute of video into 1 language. Subtitles-only projects, lip-sync, human review and short clips use minutes at the rates shown in the app before you start.</li>
        <li><b>Plan minutes</b> renew every month on your billing date and don&apos;t roll over. <b>Extra minutes</b> you buy never expire while your account is open.</li>
        <li><b>Subscriptions</b> renew automatically if you pay by card with automatic renewal; you can cancel anytime in Billing and keep your plan until the end of the period you paid for. Yearly plans are paid upfront.</li>
        <li><b>Prices</b> are shown in Naira (via Paystack) or US dollars (via Stripe) and include any discounts shown. We&apos;ll tell you before prices change for your next renewal.</li>
        <li><b>Free plan:</b> includes a small monthly allowance and a watermark, and may be paused when demand is very high.</li>
      </ul>

      <h2>8. Refunds</h2>
      <ul>
        <li>If a project fails or you delete it before it finishes, its minutes are returned to your balance automatically.</li>
        <li>If a human review isn&apos;t picked up in time, the project continues without it and the review minutes are returned.</li>
        <li>Payments for plans and minutes are otherwise non-refundable once minutes have been used, except where the law requires a refund (including your rights under the Federal Competition and Consumer Protection Act). If something went wrong, contact us; we&apos;ll put it right.</li>
      </ul>

      <h2>9. Referrals</h2>
      <p>When someone joins with your link and makes their first payment, you both receive the free minutes shown in the app. Referring yourself or using fake accounts cancels the reward and may close the accounts involved.</p>

      <h2>10. Human reviewers</h2>
      <p>Reviewers are independent native speakers we vet. They only see the projects assigned to them, must keep them confidential, and are paid by us, not by you.</p>

      <h2>11. Availability and changes</h2>
      <p>We work hard to keep ReelLingo running, but we can&apos;t promise it will always be available or error-free. We may change or stop features, telling you in advance when a change affects what you&apos;ve paid for.</p>

      <h2>12. Suspension and closing your account</h2>
      <p>You can delete your account at any time in Settings. We may suspend or close accounts that break these terms or the law. If we close your account without a good reason, we&apos;ll refund unused extra minutes.</p>

      <h2>13. Liability</h2>
      <p>
        To the extent the law allows, ReelLingo is provided &ldquo;as is&rdquo;, we aren&apos;t liable for indirect losses (such as lost profits or audience), and our total
        liability to you is limited to what you paid us in the 12 months before the claim. Nothing in these terms limits liability that can&apos;t legally be limited.
        You agree to cover our costs if a claim is brought against us because of content you uploaded or published in breach of these terms.
      </p>

      <h2>14. Law and disputes</h2>
      <p>These terms are governed by the laws of the Federal Republic of Nigeria. Please contact us first so we can try to resolve any problem. Disputes that can&apos;t be settled will be heard by the courts of Lagos State, Nigeria.</p>

      <h2>15. Changes to these terms</h2>
      <p>We&apos;ll tell you in the app when these terms change and ask you to accept the new version. If you don&apos;t agree, you can stop using ReelLingo and delete your account.</p>

      <h2>16. Contact</h2>
      <p>{legal.company}, {legal.address} · <a href={`mailto:${legal.support_email}`}>{legal.support_email}</a></p>
    </LegalLayout>
  );
}
