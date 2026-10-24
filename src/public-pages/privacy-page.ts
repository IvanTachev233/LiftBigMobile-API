import { PRIVACY_VERSION } from '../policies/policy-versions';
import {
  contentSecurityPolicy,
  operatorHtml,
  renderPage,
  versionLine,
} from './page';

export const PRIVACY_CSP = contentSecurityPolicy();

/**
 * The privacy policy (docs/privacy/privacy-policy.md) at PRIVACY_VERSION,
 * with the operator and contact email from PRIVACY_OPERATOR_NAME and
 * PRIVACY_CONTACT_EMAIL.
 */
export function privacyPageHtml(env: NodeJS.ProcessEnv): string {
  const operator = operatorHtml(env);

  return renderPage({
    title: 'LiftBig privacy policy',
    body: `
<h1>Privacy policy</h1>
<p class="small">${versionLine(PRIVACY_VERSION)}</p>
<p>This policy explains what the LiftBig app stores about you, why, on what legal basis, who handles it for us, how long we keep it, and your rights. LiftBig is for people aged 18 or over.</p>

<h2>Who runs LiftBig</h2>
<p>LiftBig is run by ${operator.name} ("LiftBig", "we", "us"), the controller of your personal data. Questions about your data or this policy: ${operator.contact}.</p>

<h2>What we store</h2>
<p>Your account:</p>
<ul>
<li><strong>Email address</strong>: to sign in and to send you email codes.</li>
<li><strong>Name</strong>: shown in the app and to your coach.</li>
<li><strong>Password hash</strong>: a one-way hash of your password; the password itself is never stored.</li>
<li><strong>Role</strong>: whether you are a coach or a client.</li>
<li><strong>Coach link</strong>: the coach you train with, if any.</li>
<li><strong>Settings</strong>: your weight unit (kg or lb) and rest timer length.</li>
</ul>
<p>Your training:</p>
<ul>
<li><strong>Workouts</strong>: your own workouts, those a coach assigned you and those from a program you follow, with their name, date, start time, notes and status.</li>
<li><strong>Sets</strong>: the planned and logged reps and weight of each set, whether you made it, and notes, including notes your coach writes for you.</li>
<li><strong>Lift records</strong>: your rep maxes and best lifts.</li>
<li><strong>Program enrollments</strong>: the programs you follow, their start date and the maxes you entered.</li>
<li>If you are a coach: the <strong>exercises</strong> you create, the <strong>programs</strong> you write and the <strong>invites</strong> you send. An invite holds the email address you typed in, so that person can join you.</li>
</ul>
<p>Keeping your account safe:</p>
<ul>
<li><strong>Email codes</strong>: the one-time codes that confirm your email and reset your password, stored only as a hash. A code stops working after 15 minutes.</li>
<li><strong>Sessions</strong>: for each device you're signed in on, a hash of its sign-in token and when it started and was last used.</li>
<li><strong>Sign-in security data</strong>: a count of wrong passwords and a temporary lock, and a counter that signs out your other devices when you change your password.</li>
</ul>
<p>Your agreements and choices:</p>
<ul>
<li><strong>Terms and policy acceptance</strong>: which version of the Terms of Use you accepted and which version of this policy you were shown, when, and from which app version.</li>
<li><strong>Consent choices</strong>: each time you give or withdraw a consent (see "Your choices"), which one, the wording version you saw, and when.</li>
</ul>
<p>Our hosting provider also keeps standard request logs (such as IP address, time and the address requested) to run and protect the service.</p>

<h2>On your device</h2>
<p>The app keeps your sign-in token (in the phone's secure storage), your theme choice, a copy of the workouts and exercises you last opened so you can use them offline, and workout changes waiting to be sent. Waiting changes are removed once they're sent, or after 30 days; the offline copy after 30 days. Uninstalling the app removes all of it. LiftBig uses no cookies, advertising IDs or trackers.</p>

<h2>Why we use it, and our legal basis</h2>
<table>
<thead><tr><th>What we do</th><th>Data</th><th>Legal basis</th></tr></thead>
<tbody>
<tr><td>Create and run your account, sign you in, send email codes</td><td>Account, email codes, sessions</td><td>Contract: needed to provide the app you signed up for</td></tr>
<tr><td>Store and show your training, work out personal bests, run programs</td><td>Training data</td><td>Contract, and your explicit consent because training data can say something about your health (see below)</td></tr>
<tr><td>Let you and your coach work together</td><td>Name, email, coach link, invites, the workouts your coach assigns you</td><td>Contract, and your explicit consent for training data</td></tr>
<tr><td>Keep accounts secure: wrong-password locks, signing out other devices, request logs</td><td>Sign-in security data, sessions, request logs</td><td>Legitimate interests: protecting your account and the service</td></tr>
<tr><td>Keep a record of what you agreed to and chose</td><td>Acceptance and consent records</td><td>Legitimate interests: being able to show what you agreed to and chose, which the law expects of us for consent</td></tr>
<tr><td>Use your videos to train and improve lift analysis (only once video features exist)</td><td>Videos you upload and what's measured from them</td><td>Your consent (<code>video_training</code>), off unless you turn it on</td></tr>
<tr><td>Email you LiftBig news and offers</td><td>Email address, name</td><td>Your consent (<code>product_emails</code>), off unless you turn it on</td></tr>
</tbody>
</table>
<p>Giving us your email, name and password is needed to have an account. Everything else is up to you.</p>

<h2>Training data and your health</h2>
<p>Your workouts, lifts and notes can say something about your health, for example your strength over time or an injury you mention in a note. Under data protection law this may be health data, so we ask for your <strong>explicit consent</strong> to store and use it when you sign up. We use it only to run the app for you and to show it to a coach you link to. LiftBig can't log your training without it, so to withdraw this consent you delete your account (see below) or email us and we delete it for you.</p>
<p>Please don't put medical details in notes that you don't want stored or seen by your coach.</p>

<h2>Your choices</h2>
<p>These are optional, off unless you turn them on, and never a condition of using LiftBig:</p>
<ul>
<li><strong>Help improve lift analysis</strong> (<code>video_training</code>): when you upload videos, LiftBig may use them, and what's measured from them, to train and improve its lift analysis. Video features aren't in the app yet; this choice applies once they are.</li>
<li><strong>News and offers by email</strong> (<code>product_emails</code>): occasional emails about LiftBig. Each email also has an unsubscribe link.</li>
</ul>
<p>Change either at any time in <strong>Profile → Privacy</strong>; withdrawing is as easy as giving. Withdrawing doesn't affect what we did before (including models already trained), but from then on we stop and won't include your videos in future training sets.</p>

<h2>Who sees your data</h2>
<ul>
<li><strong>Your coach</strong>: while you are linked to a coach, they see your name, your email and the workouts they assign you, including how you logged them and your notes on them (and, once available, your videos of those workouts). They don't see your own workouts, lift records or program maxes.</li>
<li><strong>Service providers</strong> that handle data for us, under data processing agreements that only let them use it to provide their service to us:
<ul>
<li><strong>Google Cloud</strong> (Cloud Run, Belgium) hosts the LiftBig server and its request logs.</li>
<li><strong>Neon</strong> hosts the database where your data is stored (AWS London, UK).</li>
<li><strong>Resend</strong> sends our emails: it receives your email address and the email we send you, and stores its records in the United States.</li>
</ul>
</li>
<li><strong>Exercise videos</strong>: some exercises show a video from <strong>YouTube</strong> or <strong>Vimeo</strong>. When you open such an exercise, the player loads from that service, which receives your IP address and device information and may store cookies under its own privacy policy. LiftBig doesn't send them anything about you.</li>
<li><strong>Others</strong>: only if the law requires it, for example a court order.</li>
</ul>

<h2>Data outside the UK</h2>
<p>Your data is stored in the UK (the Neon database is in London). Some of our providers process data outside the UK: Google Cloud runs the LiftBig server in the EU, which the UK recognises as giving adequate protection. Resend stores its records in the United States, and Neon and Google may process data elsewhere to run their services; those transfers are covered by the safeguards in each provider's data processing agreement. Ask us for details.</p>

<h2>What we don't do</h2>
<ul>
<li>No ads.</li>
<li>No analytics or tracking.</li>
<li>We don't sell your data or share it with anyone other than the people and providers above.</li>
<li>No automated decisions that have legal or similarly significant effects on you.</li>
</ul>

<h2>How long we keep it</h2>
<table>
<thead><tr><th>Data</th><th>Kept</th></tr></thead>
<tbody>
<tr><td>Account, training, settings, acceptance and consent records</td><td>Until you delete your account</td></tr>
<tr><td>Email codes</td><td>Stop working after 15 minutes; removed at your next code request after an hour, or with your account</td></tr>
<tr><td>Sessions</td><td>Until you sign out or the session ends (30 days unused, 90 days at most); removed at your next sign-in, or with your account</td></tr>
<tr><td>Invites</td><td>Until accepted, or until the coach or the invited person deletes their account</td></tr>
<tr><td>Request logs</td><td>30 days</td></tr>
<tr><td>Database backups</td><td>Overwritten within 7 days</td></tr>
</tbody>
</table>

<h2>Deleting your account</h2>
<p>In the app, open <strong>Profile → Delete account</strong>. Without the app, use the <a href="delete-account">account deletion page</a>.</p>
<ul>
<li><strong>Client</strong>: your account and everything in it are deleted: workouts, sets, lift records, program enrollments, settings, email codes, sessions, acceptance and consent records, and pending invites to your email.</li>
<li><strong>Coach</strong>: your account is anonymised: your email, name and password are removed and it can no longer sign in. Your own workouts, your invites, and your acceptance and consent records are deleted and your clients are unlinked from you. The exercises you created, the programs you wrote and the workouts you assigned stay in your clients' history, without your name or email.</li>
</ul>

<h2>Your rights</h2>
<p>You can ask us to:</p>
<ul>
<li>give you a copy of your data (access), including in a machine-readable form (portability);</li>
<li>correct it (you can change your name and settings in the app);</li>
<li>delete it (you can delete your account in the app);</li>
<li>restrict or object to how we use it, where we rely on legitimate interests;</li>
<li>stop using it for anything you consented to, by withdrawing that consent.</li>
</ul>
<p>Email ${operator.contact}. We answer within one month. If you're unhappy with how we handle your data, you can complain to the Information Commissioner's Office (ICO): <a href="https://ico.org.uk/make-a-complaint">ico.org.uk/make-a-complaint</a>, 0303 123 1113. We'd appreciate the chance to sort it out first.</p>

<h2>Changes to this policy</h2>
<p>When this policy changes, the version and date above change. If a change matters to you, the app tells you the next time you open it. We ask for your consent again only for new optional uses.</p>

<h2>Contact</h2>
<p>${operator.name}, ${operator.contact}</p>
`,
  });
}
