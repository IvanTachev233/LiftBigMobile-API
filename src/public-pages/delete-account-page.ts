import { contentSecurityPolicy, renderPage } from './page';

// Asks for confirmation, then posts the credentials as JSON to the form's
// action (POST /delete-account) and shows the outcome. Text is set with
// textContent only.
const SCRIPT = `
(() => {
  const form = document.getElementById('credentials');
  const confirmStep = document.getElementById('confirm');
  const confirmEmail = document.getElementById('confirm-email');
  const deleteButton = document.getElementById('delete');
  const cancelButton = document.getElementById('cancel');
  const error = document.getElementById('error');
  const done = document.getElementById('done');
  const { email, password } = form.elements;

  const showError = (text) => {
    error.textContent = text;
    error.hidden = !text;
  };
  const backToForm = () => {
    confirmStep.hidden = true;
    form.hidden = false;
  };
  const fail = (text) => {
    deleteButton.disabled = false;
    cancelButton.disabled = false;
    password.value = '';
    backToForm();
    showError(text);
    password.focus();
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    showError('');
    confirmEmail.textContent = email.value;
    form.hidden = true;
    confirmStep.hidden = false;
    deleteButton.focus();
  });
  cancelButton.addEventListener('click', backToForm);

  deleteButton.addEventListener('click', async () => {
    deleteButton.disabled = true;
    cancelButton.disabled = true;
    let res;
    try {
      res = await fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.value,
          password: password.value,
          confirm: true,
        }),
      });
    } catch {
      fail('Could not reach LiftBig. Check your connection and try again.');
      return;
    }
    if (res.status === 204) {
      form.reset();
      confirmStep.hidden = true;
      done.hidden = false;
      done.focus();
    } else if (res.status === 429) {
      const body = await res.json().catch(() => ({}));
      const minutes = Number(body.retryAfterMinutes);
      fail(
        minutes > 0
          ? 'Too many wrong passwords. Try again in ' + minutes + ' min.'
          : 'Too many wrong passwords. Try again later.',
      );
    } else if (res.status === 400 || res.status === 401) {
      fail('Email or password is incorrect.');
    } else {
      fail('Something went wrong. Try again later.');
    }
  });
})();
`;

export const DELETE_ACCOUNT_CSP = contentSecurityPolicy([SCRIPT]);

/** The account deletion page: how to delete in the app, and a web form */
export const DELETE_ACCOUNT_HTML = renderPage({
  title: 'Delete your LiftBig account',
  script: SCRIPT,
  body: `
<h1>Delete your account</h1>
<p>You can delete your LiftBig account in the app or on this page. Deleting cannot be undone.</p>

<h2>In the app</h2>
<p>Open <strong>Profile → Delete account</strong>, enter your password and confirm.</p>

<h2>What is deleted</h2>
<ul>
<li><strong>Client</strong>: your account and everything in it: workouts, sets, lift records, program enrollments, settings, email codes and pending invites to your email.</li>
<li><strong>Coach</strong>: your account is anonymised: your email, name and password are removed and it can no longer sign in. Your own workouts and your invites are deleted, and your clients are unlinked from you. The exercises you created, the programs you wrote and the workouts you assigned stay in your clients' history, without your name or email.</li>
</ul>
<p>The same email can be used to sign up again later. See the <a href="privacy">privacy policy</a> for what LiftBig stores.</p>

<h2>Delete on the web</h2>
<div class="card">
<p id="error" class="alert" role="alert" hidden></p>
<form id="credentials" action="delete-account" method="post">
<p class="muted">Sign in with the email and password of the account to delete. Only accounts with a confirmed email can be deleted here. Forgot your password? Reset it in the app first.</p>
<label for="email">Email</label>
<input id="email" name="email" type="email" autocomplete="username" required>
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="current-password" required>
<button type="submit" class="primary">Continue</button>
</form>
<div id="confirm" hidden>
<p><strong>This deletes your account and cannot be undone.</strong></p>
<p class="muted">Account: <span id="confirm-email"></span></p>
<button type="button" id="delete" class="danger">Delete my account</button>
<button type="button" id="cancel" class="secondary">Cancel</button>
</div>
<p id="done" class="success" tabindex="-1" hidden>Your account has been deleted.</p>
<noscript><p class="alert">This form needs JavaScript. You can also delete your account in the app.</p></noscript>
</div>
`,
});
