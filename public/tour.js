/* Interactive tutorial: a floating card that highlights real buttons and
   moves on by itself when the visitor actually does each step. */
(() => {
  const $ = (s, r = document) => {
    const all = [...r.querySelectorAll(s)];
    return all.find((e) => e.offsetParent !== null) || all[0] || null;
  };
  const dlg = $('#dlg');
  const loggedIn = () => !!$('[data-act="logout"]');
  const isAdminUser = () => !!$('[data-act="admin"]');
  const cartCount = () => +((($('[data-act="cart"]') || {}).textContent || '').match(/\((\d+)\)/) || [])[1] || 0;
  const firstAdd = () => $('.grid [data-act="add"]:not(:disabled)');
  const authOpen = () => dlg.open && !!$('input[name="username"]', dlg);
  const cartOpen = () => dlg.open && dlg.textContent.includes('Your cart');
  const onOrders = () => !!$('#mine');

  const S = [
    { t: 'Welcome!', x: 'This quick tour shows you how to create an account, log in and order. You will try each step on the real site, so click along. The tour moves on by itself when you do.' },
    { t: 'Browse the products', x: 'Each product shows its photo, price and description. Items marked Sold out are greyed out and cannot be ordered.', target: () => $('.grid .card') },
    { when: () => !isAdminUser(), t: 'Custom orders', x: 'Cannot find what you want? Use Custom order to describe it. The shop replies with a price or tells you it cannot provide it. Some external charges may apply, and nothing is ordered until you accept the price.', target: () => $('[data-act="custom"]') },
    { when: () => !loggedIn(), t: 'Step 1: open the sign-up window', x: 'Click Log in / Sign up in the top bar.', target: () => $('[data-act="auth"]'), wait: authOpen },
    { when: () => !loggedIn(), t: 'Step 2: create your account or log in',
      x: 'New here? Pick a username (letters, numbers or _) and a password of 8+ characters, then press Create account. Already registered? Type your details and press Log in.',
      target: () => $('[data-mode="signup"]', dlg), wait: loggedIn },
    { when: loggedIn, t: 'You are logged in', x: 'Your name now shows in the top bar. Press Log out there when you are finished, and use Log in next time with the same username and password.', target: () => $('#nav .pill, #acct .pill') },
    { when: () => !!firstAdd() || cartCount() > 0, t: 'Add something to your cart', x: 'Tap the round + button on any product.', target: firstAdd, wait: () => cartCount() > 0 },
    { t: 'Open your cart', x: 'Click Cart in the top bar to see what you picked.', target: () => $('[data-act="cart"]'), wait: cartOpen },
    { t: 'Place your order', x: 'Check the items and total. Press Place order to send it to the shop (this is a real order). Or press Next to carry on without ordering.',
      target: () => $('[data-act="checkout"]', dlg), wait: onOrders },
    { when: () => !isAdminUser(), t: 'See your orders', x: 'Close the cart if it is open, then click My orders to see every order and its status.', target: () => $('[data-act="orders"]'), wait: onOrders },
    { when: () => !isAdminUser(), t: 'What the statuses mean', x: 'Pending: the shop received your order. Packed - ready: it is ready, and you get a popup when that happens. Completed: all done. You can press Cancel order only while it is Pending.', target: () => $('#mine .panel') },
    { t: 'Light or dark', x: 'Switch between light and dark mode here. The shop remembers your choice.', target: () => $('#theme, #foot-theme') },
    { t: 'You are all set!', x: 'Open this tour again any time with the Tutorial button.' },
  ];

  let i = -1, card = null, hl = null, timer = null, armed = false, pending = false;
  const ok = (s) => !s.when || s.when();

  function go(dir) {
    let j = i + dir;
    while (S[j] && !ok(S[j])) j += dir;
    if (j < 0) return;
    if (j >= S.length) return finish();
    i = j; armed = !(S[i].wait && S[i].wait()); draw();
  }

  function draw() {
    const s = S[i], last = i === S.length - 1;
    card.innerHTML = `
      <div class="tour-bar"><i style="width:${((i + 1) / S.length) * 100}%"></i></div>
      <h3>${s.t}</h3><p>${s.x}</p>
      ${s.wait && armed ? '<p class="tour-hint">Try it now. The tour continues when you do, or press Next to skip this step.</p>' : ''}
      <div class="tour-actions">
        ${last ? '' : '<button type="button" data-t="skip">Skip tour</button>'}
        ${i > 0 ? '<button type="button" data-t="back">Back</button>' : ''}
        <button type="button" class="primary" data-t="next">${i === 0 ? 'Start' : last ? 'Finish' : 'Next'}</button>
      </div>`;
    tick();
  }

  function tick() {
    if (!card) return;
    const s = S[i];
    const host = dlg.open ? dlg : document.body;
    if (card.parentNode !== host) host.appendChild(card);
    card.classList.toggle('in-dlg', dlg.open);

    const el = s.target ? s.target() : null;
    if (el !== hl) {
      if (hl) hl.classList.remove('tour-hl');
      hl = el;
      if (el) {
        el.classList.add('tour-hl');
        if (!dlg.contains(el)) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
    if (s.wait && armed && !pending && s.wait()) {
      pending = true;
      const cur = i;
      setTimeout(() => { pending = false; if (i === cur) go(1); }, 700);
    }
  }

  function finish() {
    clearInterval(timer);
    if (hl) hl.classList.remove('tour-hl');
    if (card) card.remove();
    card = hl = null; i = -1;
    try { localStorage.tourDone = '1'; } catch (e) {}
  }

  function start() {
    finish();
    card = document.createElement('div');
    card.id = 'tour'; card.className = 'glass'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-live', 'polite');
    card.addEventListener('click', (e) => {
      const b = e.target.closest('[data-t]');
      if (!b) return;
      if (b.dataset.t === 'next') go(1); else if (b.dataset.t === 'back') go(-1); else finish();
    });
    document.body.appendChild(card);
    timer = setInterval(tick, 300);
    go(1);
  }

  $('#tour-btn').addEventListener('click', start);
  let seen = false, hasToken = false;
  try { seen = !!localStorage.tourDone; hasToken = !!localStorage.token; } catch (e) {}
  if (!seen && !hasToken) setTimeout(() => { if (!isAdminUser()) start(); }, 900);
})();
