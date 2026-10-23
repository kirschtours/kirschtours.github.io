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

  // פאנל הסינון: בתוך קבוצה - "או", בין קבוצות - "וגם", במתקנים - "וגם" (מלון שיש בו את כל מה שסומן). מחיר בסליידר.
  var grid = document.getElementById('grid');
  if (grid) {
    var cards = [].slice.call(grid.querySelectorAll('.card'));
    var panel = document.getElementById('fpanel'), empty = document.getElementById('empty');
    var boxes = [].slice.call(panel.querySelectorAll('input[type=checkbox][data-g]'));
    var rmin = document.getElementById('rmin'), rmax = document.getElementById('rmax');
    var has = function (c, key, v) { return (' ' + (c.dataset[key] || '') + ' ').indexOf(' ' + v + ' ') > -1; };
    var test = {
      when: function (c, v) { return c.dataset[v] === '1'; },
      dest: function (c, v) { return c.dataset.dest === v; },
      stars: function (c, v) { return c.dataset.stars === v; },
      board: function (c, v) { return c.dataset.board === v; },
      nights: function (c, v) { return c.dataset.nights.split(',').some(function (n) { n = +n; return v === 'short' ? n <= 3 : v === 'mid' ? n >= 4 && n <= 5 : n >= 6; }); },
      am: function (c, v) { return has(c, 'am', v); },
      kosher: function (c) { return c.dataset.kosher === '1'; },
    };
    // ספירה ליד כל אפשרות, ואפשרות בלי אף דיל מוסתרת. קבוצה שנשארה ריקה - מוסתרת כולה.
    boxes.forEach(function (b) {
      var n = cards.filter(function (c) { return test[b.dataset.g](c, b.value); }).length;
      b.parentElement.querySelector('.cnt').textContent = n;
      b.parentElement.hidden = n === 0;
    });
    panel.querySelectorAll('.fgroup').forEach(function (g) {
      if (g.dataset.group !== 'price') g.hidden = !g.querySelector('.opt:not([hidden])');
    });
    var more = panel.querySelector('.showmore');
    if (more) {
      if (!panel.querySelector('.opt.more:not([hidden])')) more.hidden = true;
      more.addEventListener('click', function () {
        var open = panel.classList.toggle('am-all');
        more.textContent = open ? 'הצג פחות' : 'הצג עוד';
        more.setAttribute('aria-expanded', open);
      });
    }

    var announce = false;
    var selected = function () {
      var s = {};
      boxes.forEach(function (b) { if (b.checked) (s[b.dataset.g] = s[b.dataset.g] || []).push(b.value); });
      return s;
    };
    var priceOn = function () { return rmin && (+rmin.value > +rmin.min || +rmax.value < +rmax.max); };
    var apply = function () {
      var s = selected(), shown = 0;
      cards.forEach(function (c) {
        var ok = Object.keys(s).every(function (g) {
          return g === 'am'
            ? s[g].every(function (v) { return test.am(c, v); })
            : s[g].some(function (v) { return test[g](c, v); });
        }) && (!rmin || (+c.dataset.price >= +rmin.value && +c.dataset.price <= +rmax.value));
        c.hidden = !ok;
        if (ok) { shown++; c.classList.add('in'); }
      });
      empty.hidden = shown > 0;
      var words = shown === 1 ? 'דיל אחד' : shown + ' דילים';
      document.getElementById('rcount').textContent = shown === cards.length ? words : words + ' מתוך ' + cards.length;
      document.getElementById('fapplyn').textContent = shown;
      if (announce) document.getElementById('count').textContent = shown ? 'מוצגים ' + words : 'אין דילים שמתאימים לסינון';
      announce = true;
      // תגיות של מה שמסומן, עם × לכל אחת
      var active = document.getElementById('active'), tags = [];
      boxes.forEach(function (b) {
        if (!b.checked) return;
        var label = b.parentElement.querySelector('.lbl').textContent.replace(/★/g, '').trim(); // בכוכבים נשאר רק "4 כוכבים"
        tags.push('<button class="atag" data-g="' + b.dataset.g + '" data-v="' + b.value + '" aria-label="הסרת ' + label + '">' + label + ' ×</button>');
      });
      if (priceOn()) tags.push('<button class="atag" data-g="price">' + (+rmin.value).toLocaleString('en-US') + '-' + (+rmax.value).toLocaleString('en-US') + ' ₪ ×</button>');
      if (tags.length) tags.push('<button class="linkbtn" data-clear>ניקוי הכל</button>');
      active.innerHTML = tags.join('');
      active.hidden = !tags.length;
      var n = tags.length ? tags.length - 1 : 0, fc = document.getElementById('fcount');
      fc.textContent = n; fc.hidden = !n;
    };
    var clearAll = function () {
      boxes.forEach(function (b) { b.checked = false; });
      if (rmin) { rmin.value = rmin.min; rmax.value = rmax.max; paintRange(); }
      apply();
    };
    panel.addEventListener('change', function (e) { if (e.target.matches('input[type=checkbox]')) apply(); });
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-clear]')) { clearAll(); return; }
      var t = e.target.closest('.atag'); if (!t) return;
      if (t.dataset.g === 'price') { rmin.value = rmin.min; rmax.value = rmax.max; paintRange(); }
      else boxes.forEach(function (b) { if (b.dataset.g === t.dataset.g && b.value === t.dataset.v) b.checked = false; });
      apply();
    });

    // סליידר מחיר עם שתי ידיות
    function paintRange() {
      if (!rmin) return;
      var lo = +rmin.min, span = (+rmin.max - lo) || 1;
      var a = (+rmin.value - lo) / span * 100, b = (+rmax.value - lo) / span * 100;
      var fill = document.getElementById('pfill');
      fill.style.insetInlineStart = a + '%'; fill.style.insetInlineEnd = (100 - b) + '%';
      document.getElementById('pmin').textContent = (+rmin.value).toLocaleString('en-US');
      document.getElementById('pmax').textContent = (+rmax.value).toLocaleString('en-US');
    }
    if (rmin) {
      var onRange = function (e) {
        if (+rmin.value > +rmax.value) { if (e.target === rmin) rmin.value = rmax.value; else rmax.value = rmin.value; }
        paintRange(); apply();
      };
      rmin.addEventListener('input', onRange); rmax.addEventListener('input', onRange);
      paintRange();
    }

    // בנייד הפאנל נפתח כמגירה
    var fopen = document.getElementById('fopen');
    var setOpen = function (open) {
      root.classList.toggle('drawer-open', open);
      fopen.setAttribute('aria-expanded', open);
      if (lenis) { if (open) lenis.stop(); else lenis.start(); }
      if (open) panel.querySelector('summary').focus(); else fopen.focus();
    };
    fopen.addEventListener('click', function () { setOpen(true); });
    document.getElementById('fclose').addEventListener('click', function () { setOpen(false); });
    document.getElementById('fapply').addEventListener('click', function () { setOpen(false); grid.scrollIntoView({ block: 'start' }); });
    addEventListener('keydown', function (e) { if (e.key === 'Escape' && root.classList.contains('drawer-open')) setOpen(false); });

    document.getElementById('sort').addEventListener('change', function (e) {
      var list = [].slice.call(grid.children);
      list.sort(e.target.value === 'price'
        ? function (a, b) { return a.dataset.price - b.dataset.price; }
        : function (a, b) { return b.dataset.round.localeCompare(a.dataset.round); });
      list.forEach(function (c) { grid.appendChild(c); });
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
