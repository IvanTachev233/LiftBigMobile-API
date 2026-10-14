import { contentSecurityPolicy, escapeHtml, renderPage } from './page';

export const PRIVACY_CSP = contentSecurityPolicy();

// Shown, highlighted, until the operator is configured
function configured(value: string | undefined, placeholder: string) {
  const text = value?.trim();
  return text
    ? { text, html: escapeHtml(text) }
    : { text: null, html: `<span class="placeholder">${placeholder}</span>` };
}

/**
 * The privacy policy, with the operator and contact email from
 * PRIVACY_OPERATOR_NAME and PRIVACY_CONTACT_EMAIL.
 */
export function privacyPageHtml(env: NodeJS.ProcessEnv): string {
  const operator = configured(env.PRIVACY_OPERATOR_NAME, '[OPERATOR NAME]');
  const contact = configured(env.PRIVACY_CONTACT_EMAIL, '[CONTACT EMAIL]');
  const contactLink = contact.text
    ? `<a href="mailto:${contact.html}">${contact.html}</a>`
    : contact.html;

  return renderPage({
    title: 'LiftBig privacy policy',
    body: `
<h1>Privacy policy</h1>
<p class="small">Last updated: 2026-10-14</p>
<p>This policy explains what the LiftBig app stores about you, why, who handles it for us, and how to delete it.</p>

<h2>Who runs LiftBig</h2>
<p>LiftBig is run by ${operator.html}. Questions about your data: ${contactLink}.</p>

<h2>What we store</h2>
<ul>
<li><strong>Email address</strong>: to sign in and to send you email codes.</li>
<li><strong>Name</strong>: shown in the app and to your coach.</li>
<li><strong>Password hash</strong>: a one-way hash of your password; the password itself is never stored.</li>
<li><strong>Role</strong>: whether you are a coach or a client.</li>
<li><strong>Coach link</strong>: the coach you train with, if any.</li>
<li><strong>Invites</strong>: pending invites a coach sent to an email address, so that person can join them.</li>
<li><strong>Workouts</strong>: your own workouts, those a coach assigned you and those from a program you follow, with their name, date, notes and status.</li>
<li><strong>Sets</strong>: the planned and logged reps and weight of each set, whether you made it, and notes.</li>
<li><strong>Lift records</strong>: your rep maxes and best lifts.</li>
<li><strong>Program enrollments</strong>: the programs you follow, their start date and the maxes you entered.</li>
<li><strong>Settings</strong>: your Weight unit (kg or lb) and Rest timer length.</li>
<li><strong>Email codes</strong>: the one-time codes that confirm your email and reset your password, stored only as a hash. A code stops working after 15 minutes.</li>
<li><strong>Sign-in security data</strong>: a count of wrong passwords and a temporary lock, and a counter that signs out your other devices when you change your password.</li>
<li>If you are a coach: the <strong>exercises</strong> you create and the <strong>programs</strong> you write.</li>
</ul>
<p>Our hosting provider also keeps standard request logs (such as IP address and time) to run and protect the service.</p>

<h2>Why</h2>
<p>We use your data only to run the app: to sign you in, to store and show your training, to let you and your coach work together, and to send you email codes.</p>

<h2>Who handles it for us</h2>
<ul>
<li><strong>Google Cloud</strong> (Cloud Run) hosts the LiftBig server.</li>
<li><strong>Neon</strong> hosts the database where your data is stored.</li>
<li><strong>Resend</strong> sends our emails: it receives your email address and the code we send you.</li>
</ul>

<h2>What we don't do</h2>
<ul>
<li>No ads.</li>
<li>No analytics or tracking.</li>
<li>We do not sell or share your data with anyone else. If you link to a coach, that coach sees your name, your email and the workouts they assign you, including how you logged them.</li>
</ul>

<h2>How long we keep it</h2>
<p>We keep your data until you delete your account. Email codes stop working after 15 minutes.</p>

<h2>Deleting your account</h2>
<p>In the app, open <strong>Profile → Delete account</strong>. Without the app, use the <a href="delete-account">account deletion page</a>.</p>
<ul>
<li><strong>Client</strong>: your account and everything in it are deleted: workouts, sets, lift records, program enrollments, settings, email codes and pending invites to your email.</li>
<li><strong>Coach</strong>: your account is anonymised: your email, name and password are removed and it can no longer sign in. Your own workouts and your invites are deleted and your clients are unlinked from you. The exercises you created, the programs you wrote and the workouts you assigned stay in your clients' history, without your name or email.</li>
</ul>

<h2>Contact</h2>
<p>${contactLink}</p>
`,
  });
}
