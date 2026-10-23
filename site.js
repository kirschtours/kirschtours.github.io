// Kirsh Tours - התנהגות האתר: מסך פתיחה, גלילה חלקה (Lenis), כניסה בגלילה, פרלקסה, ספירה, סינון, גלריה,
// והורדת דילים שפג תוקפם גם אם האתר לא נבנה מחדש באותו יום.
(function () {
  var root = document.documentElement;
  var still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  document.querySelectorAll('[data-exp]').forEach(function (el) { if (el.dataset.exp < today) el.remove(); });
  document.querySelectorAll('[data-o]').forEach(function (el) { if (el.dataset.o <= today) el.remove(); });

  // מסך הפתיחה מוצג פעם אחת לביקור
  var seen = false;
  try { seen = sessionStorage.getItem('kt-intro') === '1'; sessionStorage.setItem('kt-intro', '1'); } catch (e) {}
  var intro = document.querySelector('.intro');
  if ((seen || still) && intro) intro.remove();
  setTimeout(function () { root.classList.add('loaded'); }, seen || still ? 50 : 1300);

  // גלילה חלקה
  var lenis = null;
  if (window.Lenis && !still) {
    lenis = new Lenis({ duration: 1.2, smoothWheel: true });
    (function raf(t) { lenis.raf(t); requestAnimationFrame(raf); })(0);
    document.querySelectorAll('a[href*="#"]').forEach(function (a) {
      var id = a.getAttribute('href').split('#')[1];
      var target = id && document.getElementById(id);
      if (target && a.pathname === location.pathname) a.addEventListener('click', function (e) { e.preventDefault(); lenis.scrollTo(target, { offset: -60 }); });
    });
  }

  // כניסה בגלילה
  // אלמנט עם clip-path סגור לא "נראה" ל-IntersectionObserver, ולכן עוקבים אחרי ההורה שלו
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      e.target.querySelectorAll(':scope > [data-reveal="clip"]').forEach(function (c) { c.classList.add('in'); });
      io.unobserve(e.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  document.querySelectorAll('[data-reveal]').forEach(function (el) { io.observe(el.dataset.reveal === 'clip' ? el.parentElement : el); });

  // ספירה במספרים של ההירו
  document.querySelectorAll('[data-count]').forEach(function (el) {
    var to = +el.dataset.count, t0 = null;
    if (still) return;
    el.textContent = '0';
    setTimeout(function () {
      requestAnimationFrame(function step(t) {
        t0 = t0 || t;
        var k = Math.min((t - t0) / 1600, 1), v = Math.round(to * (1 - Math.pow(1 - k, 3)));
        el.textContent = v.toLocaleString('en-US');
        if (k < 1) requestAnimationFrame(step);
      });
    }, seen ? 300 : 1600);
  });

  // פרלקסה + כותרת שמתכהה + כפתור הזמנה בנייד
  var par = [].slice.call(document.querySelectorAll('[data-parallax]'));
  var top = document.querySelector('.top'), mob = document.querySelector('.mobile-book'), side = document.querySelector('.book .btn');
  function onScroll() {
    var y = scrollY, h = innerHeight;
    top.classList.toggle('solid', y > 40);
    if (mob && side) { var r = side.getBoundingClientRect(); mob.classList.toggle('on', y > h * 0.6 && (r.top > h || r.bottom < 0)); }
    if (still) return;
    par.forEach(function (el) {
      var r = el.parentElement.getBoundingClientRect();
      if (r.bottom < 0 || r.top > h) return;
      el.style.transform = 'translate3d(0,' + ((r.top + r.height / 2 - h / 2) * -parseFloat(el.dataset.parallax)).toFixed(1) + 'px,0)';
    });
  }
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // מצגת תמונות בהירו
  var slides = document.querySelectorAll('.hero .slides img'), cur = 0;
  if (slides.length > 1 && !still) setInterval(function () {
    slides[cur].classList.remove('on');
    cur = (cur + 1) % slides.length;
    slides[cur].classList.add('on');
  }, 6000);

  // דקה 90 = יציאה בתוך LAST_MINUTE ימים. מחושב בדפדפן מול היום, כדי שיישאר נכון גם בלי בנייה מחדש.
  var LAST_MINUTE = 7, MONTH = 30;
  var daysTo = function (o) { return Math.round((Date.parse(o + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 864e5); };
  var futureDays = function (el) { return (el.dataset.dates || '').split(',').filter(Boolean).map(daysTo).filter(function (n) { return n > 0; }); };
  var inDays = function (n) { return n === 1 ? 'מחר' : 'בעוד ' + n + ' ימים'; };
  document.querySelectorAll('.card').forEach(function (c) {
    var ds = futureDays(c);
    c.dataset.lm = ds.some(function (n) { return n <= LAST_MINUTE; }) ? 1 : 0;
    c.dataset.month = ds.some(function (n) { return n <= MONTH; }) ? 1 : 0;
    c.dataset.later = ds.some(function (n) { return n > MONTH; }) ? 1 : 0;
    if (c.dataset.lm === '1') c.querySelector('.tags').insertAdjacentHTML('afterbegin', '<span class="tag lm"><i></i>דקה 90 · יוצאים ' + inDays(Math.min.apply(null, ds)) + '</span>');
  });
  document.querySelectorAll('.date[data-o]').forEach(function (row) {
    var n = daysTo(row.dataset.o);
    if (n > 0 && n <= LAST_MINUTE) { row.classList.add('lm'); row.querySelector('.when').insertAdjacentHTML('beforeend', '<span class="lm-tag">דקה 90 · יוצאים ' + inDays(n) + '</span>'); }
  });
  var lmHero = document.querySelector('.lm-hero');
  if (lmHero) {
    var hs = futureDays(lmHero).filter(function (n) { return n <= LAST_MINUTE; });
    if (hs.length) { lmHero.innerHTML = '<i></i>דקה 90 · יוצאים ' + inDays(Math.min.apply(null, hs)); lmHero.hidden = false; }
  }

  // סינון (יעד × מועד) ומיון
  var grid = document.getElementById('grid');
  if (grid) {
    var empty = document.getElementById('empty'), filter = 'all', when = 'all';
    var cards = [].slice.call(grid.querySelectorAll('.card'));
    document.querySelectorAll('#when [data-w]').forEach(function (b) {
      if (b.dataset.w === 'all') return;
      var n = cards.filter(function (c) { return c.dataset[b.dataset.w] === '1'; }).length;
      b.querySelector('.cnt').textContent = n;
      b.hidden = n === 0;
    });
    // מסננים נוספים: משך, כוכבים, אירוח ומחיר. אפשרות שאין לה אף דיל מוסתרת, ומסנן עם פחות משתי אפשרויות - כולו
    var more = {};
    var test = {
      nights: function (c, v) { return c.dataset.nights.split(',').some(function (n) { n = +n; return v === 'short' ? n <= 3 : v === 'mid' ? n >= 4 && n <= 5 : n >= 6; }); },
      stars: function (c, v) { return c.dataset.stars === v; },
      board: function (c, v) { return c.dataset.board === v; },
      price: function (c, v) { return +c.dataset.price <= +v; },
    };
    document.querySelectorAll('#more select').forEach(function (sel) {
      var k = sel.dataset.k, live = 0;
      [].slice.call(sel.options).forEach(function (o) {
        if (!o.value) return;
        var n = cards.filter(function (c) { return test[k](c, o.value); }).length;
        o.hidden = o.disabled = n === 0 || n === cards.length; // אפשרות שמחזירה הכל או כלום לא מסננת
        if (!o.hidden) { live++; o.textContent += ' (' + n + ')'; }
      });
      sel.parentElement.hidden = live === 0;
      sel.addEventListener('change', function () { more[k] = sel.value; apply(); });
    });
    var clear = document.getElementById('clear');
    clear.addEventListener('click', function () {
      more = {};
      document.querySelectorAll('#more select').forEach(function (sel) { sel.value = ''; });
      apply();
    });
    var apply = function () {
      var shown = 0;
      clear.hidden = !Object.keys(more).some(function (k) { return more[k]; });
      cards.forEach(function (c) {
        var ok = (filter === 'all' || (filter === 'kosher' ? c.dataset.kosher === '1' : c.dataset.dest === filter))
          && (when === 'all' || c.dataset[when] === '1')
          && Object.keys(more).every(function (k) { return !more[k] || test[k](c, more[k]); });
        c.hidden = !ok;
        if (ok) { shown++; c.classList.add('in'); }
      });
      empty.hidden = shown > 0;
      if (announce) document.getElementById('count').textContent = shown === 1 ? 'מוצג דיל אחד' : shown ? 'מוצגים ' + shown + ' דילים' : 'אין דילים שמתאימים לסינון';
      announce = true;
    };
    var announce = false;
    var press = function (sel, b) { document.querySelectorAll(sel).forEach(function (x) { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); };
    document.querySelectorAll('#when [data-w]').forEach(function (x) { x.setAttribute('aria-pressed', x.classList.contains('on')); });
    document.getElementById('filters').addEventListener('click', function (e) {
      var b = e.target.closest('.chip'); if (!b) return;
      press('.chip', b);
      filter = b.dataset.f; apply();
    });
    document.getElementById('when').addEventListener('click', function (e) {
      var b = e.target.closest('[data-w]'); if (!b) return;
      if (b.dataset.w === when && when !== 'all') b = document.querySelector('#when [data-w="all"]'); // לחיצה שנייה מבטלת
      press('#when [data-w]', b);
      when = b.dataset.w; apply();
    });
    document.getElementById('sort').addEventListener('change', function (e) {
      var cards = [].slice.call(grid.children);
      cards.sort(e.target.value === 'price'
        ? function (a, b) { return a.dataset.price - b.dataset.price; }
        : function (a, b) { return b.dataset.round.localeCompare(a.dataset.round); });
      cards.forEach(function (c) { grid.appendChild(c); });
    });
    apply();
  }

  // גלריה בתוך הכרטיס: החלקה בנייד, חיצים במחשב. החיצים לא עוברים לדף הדיל.
  document.querySelectorAll('.card .slides').forEach(function (track) {
    var card = track.closest('.card'), dots = card.querySelectorAll('.dots i');
    if (dots.length < 2) return;
    var at = function () { return Math.round(Math.abs(track.scrollLeft) / track.clientWidth); };
    var go = function (dir) { track.scrollBy({ left: dir * track.clientWidth * (getComputedStyle(track).direction === 'rtl' ? -1 : 1), behavior: still ? 'auto' : 'smooth' }); };
    card.querySelector('.next').addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); go(at() >= dots.length - 1 ? -dots.length : 1); });
    card.querySelector('.prev').addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); go(at() <= 0 ? dots.length : -1); });
    track.addEventListener('scroll', function () { var i = at(); dots.forEach(function (d, n) { d.classList.toggle('on', n === i); }); }, { passive: true });
  });

  // גלריה במסך מלא - גם מהמקלדת (Enter / רווח לפתיחה, Esc לסגירה, הפוקוס חוזר לתמונה)
  var lb = document.getElementById('lb'), opener = null;
  if (lb) {
    var close = function () { lb.classList.remove('on'); if (opener) opener.focus(); };
    document.querySelectorAll('.gallery img, .deal-hero .bg img').forEach(function (img) {
      var box = img.parentElement;
      var open = function () { opener = box; lb.firstChild.src = img.src; lb.firstChild.alt = img.alt; lb.classList.add('on'); lb.focus(); };
      box.addEventListener('click', open);
      box.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
    lb.addEventListener('click', close);
    addEventListener('keydown', function (e) { if (e.key === 'Escape' && lb.classList.contains('on')) close(); });
  }

  // "דלגו לתוכן" גם כשהגלילה החלקה פעילה
  var skip = document.querySelector('.skip');
  if (skip) skip.addEventListener('click', function (e) { e.preventDefault(); var m = document.getElementById('main'); if (lenis) lenis.scrollTo(m, { immediate: true }); m.focus({ preventScroll: !!lenis }); });
})();
