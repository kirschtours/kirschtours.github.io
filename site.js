// Kirsh Tours - התנהגות האתר: מסך פתיחה, גלילה חלקה (Lenis), כניסה בגלילה, פרלקסה, ספירה, סינון, גלריה,
// והורדת דילים שפג תוקפם גם אם האתר לא נבנה מחדש באותו יום.
(function () {
  var root = document.documentElement;
  // הגדרות תפריט הנגישות. ה-classes כבר הוחלו בסקריפט שב-<head>, כאן רק קוראים אותן.
  var a11y = {};
  try { a11y = JSON.parse(localStorage.getItem('kt-a11y') || '{}') || {}; } catch (e) {}
  var still = matchMedia('(prefers-reduced-motion: reduce)').matches || !!a11y.still;
  var today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  // סטטיסטיקה (GoatCounter, 28.10.2026): כניסות נספרות לבד. כאן נספרות פעולות - לחיצה על וואטסאפ לפי הדף שבו היא קרתה, וטפסים שנשלחו.
  function track(path, title) { try { if (window.goatcounter && goatcounter.count) goatcounter.count({ path: path, title: title, event: true }); } catch (e) {} }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href*="wa.me"], a[href*="chat.whatsapp.com"]');
    if (!a) return;
    var group = a.href.indexOf('chat.whatsapp.com') > -1;
    var page = decodeURIComponent(location.pathname).replace(/\/index\.html$/, '/');
    track((group ? 'קבוצה' : 'וואטסאפ') + page, (group ? 'הצטרפות לקבוצה מ-' : 'לחיצה על וואטסאפ מ-') + (document.querySelector('h1') || document).textContent.trim().slice(0, 60));
  });
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
      if (target && a.pathname === location.pathname) a.addEventListener('click', function (e) { e.preventDefault(); lenis.scrollTo(target, { offset: a.closest('.toc') ? -90 : -60 }); }); // מתוכן העניינים: מרווח גדול יותר, שהכותרת לא תיחבא מתחת לסרגל העליון
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
    if (mob && side) { var r = side.getBoundingClientRect(); mob.classList.toggle('on', r.top > h || r.bottom < 0); } // בנייד המחיר וכפתור ההזמנה מוצגים כבר במסך הראשון
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
  // כל לשונית (חבילות / טיולים) היא shop עם מזהים משלה: בלי סיומת לדילים, "-t" לטיולים
  function initShop(sfx) {
    var $ = function (id) { return document.getElementById(id + sfx); };
    var grid = $('grid');
    if (!grid) return;
    var cards = [].slice.call(grid.querySelectorAll('.card'));
    var panel = $('fpanel'), empty = $('empty');
    var boxes = [].slice.call(panel.querySelectorAll('input[type=checkbox][data-g]'));
    var rmin = $('rmin'), rmax = $('rmax');
    var has = function (c, key, v) { return (' ' + (c.dataset[key] || '') + ' ').indexOf(' ' + v + ' ') > -1; };
    var test = {
      when: function (c, v) { return c.dataset[v] === '1'; },
      dest: function (c, v) { return c.dataset.dest === v; },
      stars: function (c, v) { return c.dataset.stars === v; },
      board: function (c, v) { return has(c, 'board', v); },
      nights: function (c, v) { return c.dataset.nights.split(',').some(function (n) { n = +n; return v === 'short' ? n <= 3 : v === 'mid' ? n >= 4 && n <= 5 : n >= 6; }); },
      am: function (c, v) { return has(c, 'am', v); },
      kosher: function (c) { return c.dataset.kosher === '1'; },
      vip: function (c) { return c.dataset.vip === '1'; },
      holiday: function (c, v) { return c.dataset.holiday === v; },
      mon: function (c, v) { return (c.dataset.dates || '').split(',').some(function (o) { return o.slice(0, 7) === v; }); },
      dur: function (c, v) { return c.dataset.dur === v; },
      op: function (c, v) { return c.dataset.op === v; },
      style: function (c, v) { return c.dataset[v] === '1'; },
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
      grid.classList.toggle('hol-on', !!s.holiday); // דיל שאוחד עם דיל חג מציג את מחיר החג כשמסננים לפי החג
      empty.hidden = shown > 0;
      var words = shown === 1 ? (grid.dataset.one || 'דיל אחד') : shown + ' ' + (grid.dataset.many || 'דילים');
      $('rcount').textContent = shown === cards.length ? words : words + ' מתוך ' + cards.length;
      $('fapplyn').textContent = shown;
      if (announce) $('count').textContent = shown ? 'מוצגים ' + words : 'אין ' + (grid.dataset.many || 'דילים') + ' שמתאימים לסינון';
      announce = true;
      // תגיות של מה שמסומן, עם × לכל אחת
      var active = $('active'), tags = [];
      boxes.forEach(function (b) {
        if (!b.checked) return;
        var label = b.parentElement.querySelector('.lbl').textContent.replace(/★/g, '').trim(); // בכוכבים נשאר רק "4 כוכבים"
        tags.push('<button class="atag" data-g="' + b.dataset.g + '" data-v="' + b.value + '" aria-label="הסרת ' + label + '">' + label + ' ×</button>');
      });
      if (priceOn()) tags.push('<button class="atag" data-g="price">' + (+rmin.value).toLocaleString('en-US') + '-' + (+rmax.value).toLocaleString('en-US') + ' ₪ ×</button>');
      if (tags.length) tags.push('<button class="linkbtn" data-clear>ניקוי הכל</button>');
      active.innerHTML = tags.join('');
      active.hidden = !tags.length;
      var n = tags.length ? tags.length - 1 : 0, fc = $('fcount');
      fc.textContent = n; fc.hidden = !n;
    };
    var clearAll = function () {
      boxes.forEach(function (b) { b.checked = false; });
      if (rmin) { rmin.value = rmin.min; rmax.value = rmax.max; paintRange(); }
      apply();
    };
    panel.addEventListener('change', function (e) { if (e.target.matches('input[type=checkbox]')) apply(); });
    var shop = grid.closest('.shop');
    document.addEventListener('click', function (e) {
      if (!shop.contains(e.target)) return;
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
      var fill = $('pfill');
      fill.style.insetInlineStart = a + '%'; fill.style.insetInlineEnd = (100 - b) + '%';
      $('pmin').textContent = (+rmin.value).toLocaleString('en-US');
      $('pmax').textContent = (+rmax.value).toLocaleString('en-US');
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
    var fopen = $('fopen');
    var setOpen = function (open) {
      root.classList.toggle('drawer-open', open);
      fopen.setAttribute('aria-expanded', open);
      if (lenis) { if (open) lenis.stop(); else lenis.start(); }
      if (open) panel.querySelector('summary').focus(); else fopen.focus();
    };
    fopen.addEventListener('click', function () { setOpen(true); });
    $('fclose').addEventListener('click', function () { setOpen(false); });
    $('fapply').addEventListener('click', function () { setOpen(false); grid.scrollIntoView({ block: 'start' }); });
    addEventListener('keydown', function (e) { if (e.key === 'Escape' && root.classList.contains('drawer-open') && !shop.hidden) setOpen(false); });

    $('sort').addEventListener('change', function (e) {
      var list = [].slice.call(grid.children);
      // "יוצאים בקרוב": לפי תאריך היציאה הקרוב ביותר שעוד לא עבר
      var today = new Date().toISOString().slice(0, 10);
      var soon = function (c) { return (c.dataset.dates || '').split(',').filter(function (o) { return o >= today; }).sort()[0] || '9999'; };
      list.sort(e.target.value === 'price'
        ? function (a, b) { return a.dataset.price - b.dataset.price; }
        : e.target.value === 'soon'
          ? function (a, b) { return soon(a).localeCompare(soon(b)); }
          : function (a, b) { return b.dataset.round.localeCompare(a.dataset.round); });
      list.forEach(function (c) { grid.appendChild(c); });
    });
    apply();
  }
  initShop('');
  initShop('-k');
  initShop('-t');

  // לשוניות חבילות נופש / חבילות כשרות / טיולים מאורגנים. #kosher או #tours בכתובת פותחים ישר את הלשונית.
  var tabs = [].slice.call(document.querySelectorAll('.tabs [role=tab]'));
  var showTab = function (tab, focus) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    });
    if (focus) tab.focus();
    document.getElementById(tab.getAttribute('aria-controls')).querySelectorAll('[data-reveal]').forEach(function (el) { el.classList.add('in'); });
  };
  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () { showTab(t); history.replaceState(null, '', '#' + t.dataset.hash); });
    t.addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowRight' ? -1 : 0; // RTL: שמאלה = הלשונית הבאה
      if (d) { e.preventDefault(); showTab(tabs[(i + d + tabs.length) % tabs.length], true); }
    });
  });
  var goHash = function () {
    var tab = tabs.filter(function (t) { return t.dataset.hash !== 'deals' && '#' + t.dataset.hash === location.hash; })[0];
    if (!tab) return;
    var deals = document.getElementById('deals');
    showTab(tab);
    if (deals) { if (lenis) lenis.scrollTo(deals, { offset: -60, immediate: true }); else deals.scrollIntoView(); }
  };
  goHash();
  addEventListener('hashchange', goHash);

  // גלריה בתוך הכרטיס: החלקה בנייד, חיצים במחשב. החיצים לא עוברים לדף הדיל.
  // זמן פרסום יחסי בכרטיס ("עלה היום"). מחושב בדפדפן, כי האתר לא נבנה מחדש בסופ"ש
  var day0 = function (s) { var p = s.split('-'); return Date.UTC(+p[0], p[1] - 1, +p[2]); };
  var nowIl = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  document.querySelectorAll('.pub[data-round]').forEach(function (el) {
    var n = Math.round((day0(nowIl) - day0(el.dataset.round)) / 864e5);
    if (n >= 0) el.textContent = n === 0 ? 'עלה היום' : n === 1 ? 'עלה אתמול' : 'עלה לפני ' + n + ' ימים';
  });
  // שיתוף דיל: בטלפון - תפריט השיתוף של המכשיר, ואם אין - וואטסאפ
  document.querySelectorAll('.share[data-share]').forEach(function (a) {
    if (!navigator.share) return;
    a.addEventListener('click', function (e) {
      e.preventDefault();
      track('שיתוף' + location.pathname, document.title);
      navigator.share({ text: a.dataset.share }).catch(function () {});
    });
  });

  // תמונה עם data-src נטענת רק כשצריך אותה (חוסך הורדה של כל הגלריות מראש)
  var wake = function (img) {
    if (img.dataset.srcset) { img.srcset = img.dataset.srcset; img.removeAttribute('data-srcset'); }
    if (img.dataset.src) { img.src = img.dataset.src; img.removeAttribute('data-src'); }
  };
  addEventListener('load', function () { document.querySelectorAll('.hero .slides img[data-src]').forEach(wake); });
  document.querySelectorAll('.card .slides').forEach(function (track) {
    var card = track.closest('.card'), dots = card.querySelectorAll('.dots i');
    if (dots.length < 2) return;
    var loadAll = function () { track.querySelectorAll('img[data-src]').forEach(wake); };
    ['pointerenter', 'touchstart', 'focusin'].forEach(function (ev) { card.addEventListener(ev, loadAll, { once: true, passive: true }); });
    track.addEventListener('scroll', loadAll, { once: true, passive: true });
    var at = function () { return Math.round(Math.abs(track.scrollLeft) / track.clientWidth); };
    var go = function (dir) { track.scrollBy({ left: dir * track.clientWidth * (getComputedStyle(track).direction === 'rtl' ? -1 : 1), behavior: still ? 'auto' : 'smooth' }); };
    card.querySelector('.next').addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); go(at() >= dots.length - 1 ? -dots.length : 1); });
    card.querySelector('.prev').addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); go(at() <= 0 ? dots.length : -1); });
    track.addEventListener('scroll', function () { var i = at(); dots.forEach(function (d, n) { d.classList.toggle('on', n === i); }); }, { passive: true });
  });

  // רצועת ההמלצות: חיצים מזיזים כרטיס אחד, ובמקלדת חיצים כשהרצועה בפוקוס (גלילה רגילה של הדפדפן)
  var rvTrack = document.querySelector('.rv-track');
  if (rvTrack) {
    var rvGo = function (dir) {
      var item = rvTrack.querySelector('.rv');
      var step = item ? item.getBoundingClientRect().width + parseFloat(getComputedStyle(rvTrack).columnGap || 0) : rvTrack.clientWidth;
      rvTrack.scrollBy({ left: dir * step * (getComputedStyle(rvTrack).direction === 'rtl' ? -1 : 1), behavior: still ? 'auto' : 'smooth' });
    };
    var rvNext = document.querySelector('.rv-next'), rvPrev = document.querySelector('.rv-prev');
    if (rvNext) rvNext.addEventListener('click', function () { rvGo(1); });
    if (rvPrev) rvPrev.addEventListener('click', function () { rvGo(-1); });
  }

  // גלריה במסך מלא - גם מהמקלדת (Enter / רווח לפתיחה, Esc לסגירה, הפוקוס חוזר לתמונה)
  var lb = document.getElementById('lb'), opener = null;
  if (lb) {
    var close = function () { lb.classList.remove('on'); if (opener) opener.focus(); };
    document.querySelectorAll('.gallery img, .deal-hero .bg img, .rv-shot img').forEach(function (img) {
      var box = img.parentElement;
      var open = function () { opener = box; lb.firstChild.src = img.src; lb.firstChild.alt = img.alt; lb.classList.add('on'); lb.focus(); };
      box.addEventListener('click', open);
      box.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
    lb.addEventListener('click', close);
    addEventListener('keydown', function (e) { if (e.key === 'Escape' && lb.classList.contains('on')) close(); });
  }

  // תפריט בנייד: הכפתור פותח וסוגר, לחיצה על קישור, Esc או לחיצה מחוץ לתפריט סוגרים
  var menuBtn = document.querySelector('.menu-btn'); // top - הכותרת, מוגדר למעלה
  if (top && menuBtn) {
    var setMenu = function (open) {
      top.classList.toggle('menu-open', open);
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      menuBtn.setAttribute('aria-label', open ? 'סגירת התפריט' : 'פתיחת התפריט');
    };
    menuBtn.addEventListener('click', function () { setMenu(!top.classList.contains('menu-open')); });
    top.querySelectorAll('nav a').forEach(function (a) { a.addEventListener('click', function () { setMenu(false); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && top.classList.contains('menu-open')) { setMenu(false); menuBtn.focus(); } });
    document.addEventListener('click', function (e) { if (top.classList.contains('menu-open') && !top.contains(e.target)) setMenu(false); });
  }

  // "דלגו לתוכן" גם כשהגלילה החלקה פעילה
  var skip = document.querySelector('.skip');
  if (skip) skip.addEventListener('click', function (e) { e.preventDefault(); var m = document.getElementById('main'); if (lenis) lenis.scrollTo(m, { immediate: true }); m.focus({ preventScroll: !!lenis }); });

  // תפריט נגישות: גודל טקסט 0-3, ומתגים. עצירת אנימציות נכנסת לתוקף מלא (Lenis, פרלקסה) אחרי רענון - ולכן מרעננים.
  var abtn = document.getElementById('a11y-btn'), apanel = document.getElementById('a11y-panel');
  if (abtn && apanel) {
    var SIZES = ['100%', '115%', '130%', '150%'];
    var save = function () { try { localStorage.setItem('kt-a11y', JSON.stringify(a11y)); } catch (e) {} };
    var paint = function () {
      root.className = root.className.replace(/\ba11y-\S+/g, '').trim();
      Object.keys(a11y).forEach(function (k) { if (a11y[k]) root.classList.add(k === 'size' ? 'a11y-size-' + a11y[k] : 'a11y-' + k); });
      apanel.querySelectorAll('[data-a11y]').forEach(function (b) { b.setAttribute('aria-pressed', !!a11y[b.dataset.a11y]); });
      document.getElementById('a11y-size-v').textContent = SIZES[a11y.size || 0];
    };
    var setPanel = function (open) {
      apanel.hidden = !open;
      abtn.setAttribute('aria-expanded', open);
      if (open) apanel.querySelector('button').focus(); else abtn.focus();
    };
    abtn.addEventListener('click', function () { setPanel(apanel.hidden); });
    apanel.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-a11y-close')) { setPanel(false); return; }
      var wasStill = !!a11y.still;
      if (b.hasAttribute('data-a11y-reset')) a11y = {};
      else if (b.dataset.a11ySize) a11y.size = Math.max(0, Math.min(SIZES.length - 1, (a11y.size || 0) + +b.dataset.a11ySize));
      else if (b.dataset.a11y) a11y[b.dataset.a11y] = !a11y[b.dataset.a11y];
      save(); paint();
      if (wasStill !== !!a11y.still) location.reload();
    });
    // Esc סוגר, ו-Tab נשאר בתוך הפאנל
    apanel.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { setPanel(false); return; }
      if (e.key !== 'Tab') return;
      var items = apanel.querySelectorAll('button, a'), first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    document.addEventListener('click', function (e) { if (!apanel.hidden && !apanel.contains(e.target) && !abtn.contains(e.target)) setPanel(false); });
    paint();
  }

  // דף ההזמנה: הדיל נטען לפי ?id= מ-data/deals.json או data/tours.json, והטופס נשלח ל-Apps Script של גיליון הלקוחות.
  var form = document.getElementById('bform');
  if (form) {
    var q = new URLSearchParams(location.search), id = q.get('id') || '', base = form.dataset.base;
    var sum = document.getElementById('bsum'), dateSel = document.getElementById('date'), paxSel = document.getElementById('pax');
    var trav = document.getElementById('travelers'), err = document.getElementById('berr');
    var fmtN = function (n) { return Number(n).toLocaleString('en-US'); };
    var val = function (fid) { return document.getElementById(fid).value.trim(); }; // לא form.name - זה שם הטופס עצמו
    var escH = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    var item = null;
    var waMsg = function () {
      var t = item ? (item.title || item.dest + ' - ' + item.hotel) : '';
      return 'https://wa.me/' + form.dataset.phone + '?text=' + encodeURIComponent('היי חיים, אני רוצה להזמין' + (t ? ' את ' + t : '') + (dateSel.value ? ' (' + dateSel.selectedOptions[0].dataset.label + ')' : '') + '.');
    };
    var getJson = function (f) { return fetch(base + 'data/' + f, { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }); };
    Promise.all([getJson('deals.json'), getJson('tours.json')]).then(function (res) {
      var deals = res[0].deals || [], tours = res[1].tours || [];
      item = deals.filter(function (d) { return d.id === id; })[0] || tours.filter(function (t) { return t.id === id; })[0];
      var dates = item ? item.dates.filter(function (x) { return x.o > today; }) : [];
      if (!item || !dates.length) { sum.hidden = true; document.getElementById('bnone').hidden = false; return; }
      var isTour = !!item.title;
      var when = isTour ? item.days + ' ימים / ' + item.nights + ' לילות' : item.nightsLabel;
      sum.innerHTML = '<img src="' + base + 'img/' + escH(item.id) + '/1.jpg" alt="">' +
        '<div><div class="dest">' + escH(item.dest) + (item.country ? ', ' + escH(item.country) : '') + '</div>' +
        '<h2>' + escH(isTour ? item.title : item.hotel) + '</h2>' +
        '<div class="meta"><span>' + escH(when) + '</span>' + (isTour ? '<span>טיול מאורגן · ' + escH(item.operator) + '</span>' : '<span>טיסה + מלון ' + escH(item.stars) + '★</span>') + '</div>' +
        '<a class="go" href="' + base + (isTour ? 'tour/' : 'deal/') + escH(item.id) + '/index.html">חזרה לדיל</a></div>' +
        '<div class="bprice"><small>לאדם בחדר זוגי</small><span id="bprice"></span></div>';
      dateSel.innerHTML = dates.map(function (x) {
        return '<option value="' + escH(x.o) + '" data-r="' + escH(x.r || '') + '" data-label="' + escH(x.label) + '" data-price="' + escH(x.price) + '">' + escH(x.label) + ' · ' + fmtN(x.price) + ' ₪ לאדם</option>';
      }).join('');
      var cheapest = dates.reduce(function (a, b) { return b.price < a.price ? b : a; });
      dateSel.value = dates.some(function (x) { return x.o === q.get('o'); }) ? q.get('o') : cheapest.o;
      var showPrice = function () { document.getElementById('bprice').textContent = fmtN(dateSel.selectedOptions[0].dataset.price) + ' ₪'; checkPassports(); };
      dateSel.addEventListener('change', showPrice);
      form.hidden = false;
      drawTravelers();
      showPrice();
    });

    // בלוק לכל נוסע. מה שכבר הוקלד נשמר כשמשנים את מספר הנוסעים.
    var tField = function (i, k, label, attrs) {
      var fid = 't' + i + '-' + k;
      return '<div class="field"><label for="' + fid + '">' + label + '</label><input id="' + fid + '" data-k="' + k + '" required ' + attrs + '></div>';
    };
    function drawTravelers() {
      var n = +paxSel.value, have = trav.children.length;
      for (var i = have; i < n; i++) {
        trav.insertAdjacentHTML('beforeend', '<div class="trav" data-i="' + i + '"><h3>נוסע/ת ' + (i + 1) + '</h3><div class="row">' +
          tField(i, 'first', 'שם פרטי באנגלית', 'autocomplete="off" dir="ltr" maxlength="40" pattern="[A-Za-z\\- \']+"') +
          tField(i, 'last', 'שם משפחה באנגלית', 'autocomplete="off" dir="ltr" maxlength="40" pattern="[A-Za-z\\- \']+"') +
          tField(i, 'passport', 'מספר דרכון', 'autocomplete="off" dir="ltr" maxlength="15" pattern="[A-Za-z0-9]{5,15}"') +
          tField(i, 'expiry', 'תוקף הדרכון', 'type="date" min="' + today + '"') +
          tField(i, 'birth', 'תאריך לידה', 'type="date" max="' + today + '" min="1920-01-01"') +
          '</div><p class="warn" id="t' + i + '-warn" hidden></p></div>');
      }
      while (trav.children.length > n) trav.lastElementChild.remove();
    }
    paxSel.addEventListener('change', function () { drawTravelers(); checkPassports(); });

    // דרכון שפג פחות מ-6 חודשים אחרי החזרה - אזהרה בלבד, לא חוסם
    function checkPassports() {
      var opt = dateSel.selectedOptions[0];
      if (!opt) return;
      var back = new Date((opt.dataset.r || opt.value) + 'T12:00:00Z');
      back.setUTCMonth(back.getUTCMonth() + 6);
      trav.querySelectorAll('.trav').forEach(function (t) {
        var v = t.querySelector('[data-k=expiry]').value, w = t.querySelector('.warn');
        var short = v && new Date(v + 'T12:00:00Z') < back;
        w.hidden = !short;
        w.textContent = short ? 'שימו לב: הדרכון בתוקף פחות מ-6 חודשים אחרי החזרה. יש יעדים שלא מכניסים כך - נבדוק את זה יחד.' : '';
      });
    }
    trav.addEventListener('change', function (e) { if (e.target.dataset.k === 'expiry') checkPassports(); });
    // שם באנגלית באותיות גדולות, כמו בדרכון
    trav.addEventListener('input', function (e) { var k = e.target.dataset.k; if (k === 'first' || k === 'last' || k === 'passport') e.target.value = e.target.value.toUpperCase(); });

    var MSG = { first: 'שם פרטי באנגלית', last: 'שם משפחה באנגלית', passport: 'מספר דרכון (אותיות ומספרים בלבד)', expiry: 'תוקף הדרכון', birth: 'תאריך לידה', name: 'שם מלא', phone: 'טלפון נייד תקין', email: 'כתובת מייל תקינה', consent: 'אישור מדיניות הפרטיות' };
    var phoneOk = function (p) { var d = p.replace(/\D/g, ''); return d.length >= 9 && d.length <= 15; };
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var bad = [];
      form.querySelectorAll('input[required], select[required]').forEach(function (el) {
        var ok = el.type === 'checkbox' ? el.checked : el.value.trim() !== '' && el.checkValidity() && (el.id !== 'phone' || phoneOk(el.value));
        el.setAttribute('aria-invalid', !ok);
        if (!ok) bad.push(el);
      });
      if (bad.length) {
        var names = bad.map(function (el) { return MSG[el.dataset.k || el.id] || el.labels[0].textContent; });
        err.textContent = 'חסר או לא תקין: ' + names.filter(function (v, i) { return names.indexOf(v) === i; }).join(', ') + '.';
        err.hidden = false;
        bad[0].focus();
        return;
      }
      err.hidden = true;
      var opt = dateSel.selectedOptions[0];
      var payload = {
        action: 'booking', website: val('website'),
        id: item.id, item: item.title || item.dest + ' - ' + item.hotel, kind: item.title ? 'tour' : 'deal', dest: item.dest, kosher: !!item.kosher,
        date: opt.value, ret: opt.dataset.r || '', dateLabel: opt.dataset.label, price: +opt.dataset.price,
        url: location.href.split('?')[0].replace(/book\/(index\.html)?$/, '') + (item.title ? 'tour/' : 'deal/') + item.id + '/',
        name: val('name'), phone: val('phone'), email: val('email'), notes: val('notes'),
        travelers: [].map.call(trav.querySelectorAll('.trav'), function (t) {
          var o = {};
          t.querySelectorAll('[data-k]').forEach(function (el) { o[el.dataset.k] = el.value.trim(); });
          return o;
        }),
      };
      var send = form.querySelector('.bsend');
      var fail = function () {
        send.disabled = false; send.textContent = 'שליחת ההזמנה';
        err.innerHTML = 'השליחה לא הצליחה. אפשר לנסות שוב, או <a href="' + waMsg() + '">לכתוב לי ישר בוואטסאפ</a>.';
        err.hidden = false;
      };
      if (!form.dataset.url) { location.href = waMsg(); return; }
      send.disabled = true; send.textContent = 'שולח…';
      // text/plain = בקשה פשוטה, בלי preflight, ש-Apps Script מקבל
      fetch(form.dataset.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (!res.ok) { fail(); if (res.error) err.insertAdjacentText('afterbegin', res.error + ' '); return; }
          track('הזמנה-נשלחה' + location.search, 'טופס הזמנה נשלח');
          form.hidden = true; sum.hidden = true;
          document.getElementById('bdone-wa').href = waMsg();
          var done = document.getElementById('bdone');
          done.hidden = false; done.focus();
          scrollTo(0, 0);
        })
        .catch(fail);
    });
  }

  // טופס "ספרו איך היה": נכנס לגיליון כ"ממתין" (action: 'review'). אם השליחה נכשלת - אותה המלצה בוואטסאפ.
  var rform = document.getElementById('rform');
  if (rform) {
    var rv = function (id) { return document.getElementById(id); };
    var rerr = rv('rerr'), rdest = rv('rdest'), rother = rv('rother-f');
    rdest.addEventListener('change', function () { rother.hidden = rdest.value !== 'אחר'; });
    var rDest = function () { return rdest.value === 'אחר' ? rv('rother').value.trim() : rdest.value; };
    var rWa = function () { return 'https://wa.me/' + rform.dataset.phone + '?text=' + encodeURIComponent('היי חיים, רציתי לספר איך היה ב' + (rDest() || 'חופשה') + ': ' + rv('rtext').value.trim()); };
    rform.addEventListener('submit', function (e) {
      e.preventDefault();
      rerr.hidden = true;
      var phone = rv('rphone').value.replace(/\D/g, '');
      var bad = !rv('rname').value.trim() ? 'rname' : !rDest() ? (rdest.value === 'אחר' ? 'rother' : 'rdest') : !rv('rmonth').value ? 'rmonth'
        : rv('rtext').value.trim().length < 10 ? 'rtext' : phone.length < 9 ? 'rphone' : !rv('rconsent').checked ? 'rconsent' : '';
      if (bad) {
        rerr.textContent = { rname: 'חסר שם פרטי.', rdest: 'בחרו יעד.', rother: 'כתבו לאיזה יעד נסעתם.', rmonth: 'בחרו את חודש הנסיעה.', rtext: 'ההמלצה קצרה מדי.', rphone: 'חסר מספר טלפון תקין.', rconsent: 'כדי לפרסם צריך לסמן את תיבת ההסכמה.' }[bad];
        rerr.hidden = false;
        rv(bad).focus();
        return;
      }
      if (!rform.dataset.url) { location.href = rWa(); return; }
      var send = rform.querySelector('.rsend');
      var fail = function (msg) {
        send.disabled = false; send.textContent = 'שליחה';
        rerr.innerHTML = '';
        if (msg) rerr.appendChild(document.createTextNode(msg + ' '));
        rerr.insertAdjacentHTML('beforeend', 'אפשר לנסות שוב, או <a href="' + rWa() + '">לשלוח לי את ההמלצה בוואטסאפ</a>.');
        rerr.hidden = false;
      };
      send.disabled = true; send.textContent = 'שולח…';
      fetch(rform.dataset.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({
        action: 'review', website: rv('rwebsite').value, name: rv('rname').value.trim(), dest: rDest(),
        month: rv('ryear').value + '-' + rv('rmonth').value, text: rv('rtext').value.trim(), phone: rv('rphone').value.trim(), consent: rv('rconsent').checked,
      }) })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (!res.ok) { fail(res.error); return; }
          track('המלצה-נשלחה', 'טופס המלצה נשלח');
          rform.hidden = true;
          var done = rv('rdone');
          done.hidden = false; done.focus();
          scrollTo(0, 0);
        })
        .catch(function () { fail('השליחה לא הצליחה.'); });
    });
  }
})();
