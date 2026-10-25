import { TERMS_VERSION } from '../policies/policy-versions';
import {
  contentSecurityPolicy,
  operatorHtml,
  renderPage,
  versionLine,
} from './page';

export const TERMS_CSP = contentSecurityPolicy();

/**
 * The Terms of Use (docs/privacy/terms-of-use.md) at TERMS_VERSION, with the
 * operator and contact email from PRIVACY_OPERATOR_NAME and
 * PRIVACY_CONTACT_EMAIL.
 */
export function termsPageHtml(env: NodeJS.ProcessEnv): string {
  const operator = operatorHtml(env);

  return renderPage({
    title: 'LiftBig Terms of Use',
    body: `
<h1>Terms of Use</h1>
<p class="small">${versionLine(TERMS_VERSION)}</p>

<h2>1. About these terms</h2>
<p>These terms are an agreement between you and ${operator.name} ("LiftBig", "we", "us") for using the LiftBig app and the services behind it. By creating an account, or by accepting these terms in the app, you agree to them. Our <a href="privacy">Privacy Policy</a> explains how we handle your data; it is not part of this agreement.</p>

<h2>2. Who can use LiftBig</h2>
<ul>
<li>You must be <strong>18 or older</strong>.</li>
<li>Give a real email address and keep your password to yourself. You're responsible for what happens in your account; tell us at ${operator.contact} if you think someone else has used it.</li>
<li>One person per account.</li>
</ul>

<h2>3. Training safely</h2>
<ul>
<li>LiftBig helps you plan and log strength training. It is <strong>not medical advice</strong> and doesn't replace a doctor, physiotherapist or qualified coach in person.</li>
<li>Lifting carries a risk of injury. Check with a doctor before you start if you have a health condition, an injury, or haven't trained in a while. Use safe technique, suitable equipment and a spotter or safeties for heavy lifts, and stop if something hurts.</li>
<li>Weights, percentages and programs in the app are general suggestions. You decide what you lift.</li>
</ul>

<h2>4. Coaches and clients</h2>
<ul>
<li>Coaches on LiftBig are independent users. We don't employ, check or endorse them, and we aren't responsible for their advice or programs. Any agreement about coaching, including payment, is between you and your coach.</li>
<li>When a client links to a coach, the coach sees the client's name, email and the workouts the coach assigns, including how they were logged. Either side can end the link; deleting an account ends it too.</li>
<li>Coaches: only invite people who expect to hear from you, and use your clients' data only to coach them.</li>
</ul>

<h2>5. Your content</h2>
<ul>
<li>What you add to LiftBig (workouts, notes, exercises, programs and, once available, videos) stays yours.</li>
<li>You give us a licence to host, store, copy, process and show your content, only as needed to run LiftBig for you and for the people you choose to share it with (such as your coach). This licence ends when you delete the content or your account, except that a coach's exercises, programs and assigned workouts stay in their clients' history after the coach's account is deleted (without the coach's name or email), and copies in backups are overwritten in time.</li>
<li>We use your videos to train or improve lift analysis only if you turn on that choice (Profile → Privacy).</li>
<li>You confirm you have the right to add what you add, and that it follows these terms.</li>
</ul>

<h2>6. Filming and videos</h2>
<p>These apply once video features are in the app:</p>
<ul>
<li>Film only yourself, or people who have agreed to be filmed and to the video being uploaded.</li>
<li>Don't film anyone under 18.</li>
<li>Follow your gym's rules on filming, and don't film in changing rooms or other private areas.</li>
<li>Don't upload videos that are illegal, sexual, violent, or that you don't have the rights to (for example, someone else's video or music you can't use).</li>
</ul>

<h2>7. Acceptable use</h2>
<p>Don't:</p>
<ul>
<li>break the law, or use LiftBig to harass, threaten, or impersonate anyone;</li>
<li>add content that is hateful, sexual, illegal, or infringes someone else's rights;</li>
<li>try to get into other people's accounts or data, or test, probe or attack our systems;</li>
<li>copy, scrape or access LiftBig with bots or scripts, or put an unreasonable load on it;</li>
<li>reverse engineer the app, except as far as the law allows;</li>
<li>resell LiftBig or use it to build a competing service.</li>
</ul>
<p>We may remove content that breaks these terms.</p>

<h2>8. Our app</h2>
<ul>
<li>The app, its design and code, and the exercise library and programs we provide belong to us or our licensors. We give you a personal, non-transferable right to use the app under these terms.</li>
<li>Some exercises play videos from YouTube or Vimeo; those videos are covered by those services' own terms.</li>
<li>If you send us feedback or ideas, we may use them without owing you anything.</li>
</ul>

<h2>9. Price and paid features</h2>
<p>LiftBig is currently free. We may add paid features later; if we do, they come with their own terms and price, which you'll see and accept before you pay. Nothing is charged without your agreement.</p>

<h2>10. Availability and changes to the app</h2>
<ul>
<li>We work to keep LiftBig running and your data safe, but we can't promise it will always be available or free of errors. Changes made offline are saved on your phone and sent when you're back online; if you delete the app or sign out before they're sent, they may be lost.</li>
<li>We may change, add or remove features. If we stop running LiftBig, we'll tell you at least 30 days before and give you a way to get a copy of your data.</li>
<li>An old version of the app may have to be updated before you can keep using it.</li>
</ul>

<h2>11. Ending your use</h2>
<ul>
<li>You can stop using LiftBig and delete your account at any time (Profile → Delete account, or the <a href="delete-account">account deletion page</a>).</li>
<li>We may suspend or close an account that seriously or repeatedly breaks these terms, or where the law requires it. Unless that would be unsafe or unlawful, we tell you why first and give you a chance to respond.</li>
</ul>

<h2>12. Changes to these terms</h2>
<p>We may update these terms, for example when we add features or the law changes. The version and date above change with them. If a change matters to you, the app asks you to accept the new terms before you continue; you can delete your account instead. Small changes (such as fixing wording) apply from the date shown.</p>

<h2>13. Our responsibility to you</h2>
<ul>
<li>Nothing in these terms limits our liability for death or personal injury caused by our negligence, for fraud, or for anything else the law doesn't allow us to limit. Your legal rights as a consumer aren't affected.</li>
<li>We aren't responsible for how you train, for injuries that come from training you choose to do, or for advice or programs from a coach, unless we caused it through our own negligence.</li>
<li>We aren't responsible for losses we couldn't reasonably foresee, or for business losses: LiftBig is for personal use.</li>
<li>While LiftBig is free, our total liability to you for anything else is limited to £100.</li>
</ul>

<h2>14. Law and disputes</h2>
<p>These terms are governed by the law of England and Wales. You can bring a claim in the courts of England and Wales, or, if you live in Scotland or Northern Ireland, in the courts there. Please contact us first so we can try to sort it out.</p>

<h2>15. Contact</h2>
<p>${operator.name}, ${operator.contact}</p>
`,
  });
}
