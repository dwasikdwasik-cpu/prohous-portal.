(() => {
  'use strict';
  const steps = ['Odbiór techniczny','Projektowanie','Zabezpieczenie lokalu','Demontaż i zmiany','Łazienka','Ściany i sufity','Prace montażowe','Biały montaż','Meble na wymiar','Ostatnie poprawki','Sprzątanie','Odbiór końcowy'];
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function button(label, className, onClick) {
    const node = element('button', label, className);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  }
  function showPlan(opener) {
    const dialog = element('dialog', '', 'ph-dialog');
    dialog.setAttribute('aria-labelledby', 'ph-plan-heading');
    const top = element('div', '', 'ph-dialog-head');
    top.append(element('strong','Panel klienta · ProHouse'), button('Zamknij', '', () => dialog.close()));
    const body = element('article');
    const title = element('h2','Plan realizacji');
    title.id = 'ph-plan-heading';
    body.append(element('div','12 etapów','ph-kicker'), title, element('p','To standardowa kolejność prac ProHouse. Zakres i terminy Twojej inwestycji określa uzgodniony harmonogram.'));
    const list = element('ol');
    steps.forEach(step => list.append(element('li', step)));
    body.append(list);
    dialog.append(top, body);
    document.body.append(dialog);
    dialog.addEventListener('close', () => { dialog.remove(); if (opener.isConnected) opener.focus(); }, {once:true});
    dialog.addEventListener('click', e => {
      if(e.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      if(e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom) dialog.close();
    });
    dialog.showModal();
  }
  function navButton(app, label) {
    return [...app.querySelectorAll('aside nav button')].find(n => n.textContent.trim().endsWith(label));
  }
  function scheduleDocument(app) {
    return [...app.querySelectorAll('.two-col .doc-row')].find(row => /harmonogram/i.test(row.querySelector('b')?.textContent || ''))?.querySelector('button');
  }
  function apply() {
    const app = document.querySelector('.app');
    if (!app) return;
    const aside = app.querySelector('aside');
    const nav = aside?.querySelector('nav');
    if (nav && !aside.querySelector('.ph-menu')) {
      const toggle = button('Menu', 'ph-menu', () => toggle.setAttribute('aria-expanded', String(toggle.getAttribute('aria-expanded') !== 'true')));
      if (!nav.id) nav.id='ph-navigation';
      toggle.setAttribute('aria-controls',nav.id);
      toggle.setAttribute('aria-expanded','false');
      nav.before(toggle);
      nav.addEventListener('click', e => { if (e.target.closest('button')) toggle.setAttribute('aria-expanded','false'); });
    }
    const banner = app.querySelector('.summary-banner');
    const grid = app.querySelector('main > .two-col');
    if (!banner || !grid) return;
    const copy = banner.firstElementChild;
    if (copy && !copy.querySelector('.ph-primary')) {
      const overviewPlan = button('Zobacz plan prac','ph-primary', () => {
        const doc = scheduleDocument(app);
        if (doc && !doc.disabled) doc.click(); else showPlan(overviewPlan);
      });
      copy.append(overviewPlan);
    }
    if (!grid.querySelector('.ph-plan')) {
      const card = element('section','','panel ph-plan');
      const title = element('h2','Harmonogram prac');
      const description = element('p','Sprawdź kolejność prac od odbioru technicznego po wykończenie i odbiór mieszkania.');
      const plan = button('Zobacz 12 etapów', '', () => showPlan(plan));
      card.append(element('div','Plan inwestycji','ph-kicker'),title,description,plan);
      const photos = navButton(app, 'Zdjęcia inwestycji');
      if (photos) {
        const shortcuts = element('div','','ph-shortcuts');
        shortcuts.append(button('Zdjęcia z inwestycji', '', () => navButton(app,'Zdjęcia inwestycji')?.click()));
        card.append(shortcuts);
      }
      grid.append(card);
    }
  }
  let pending=false;
  function queue() {
    if(pending)return;
    pending=true;
    requestAnimationFrame(()=>{pending=false;apply();});
  }
  function start() {
    if(document.documentElement.dataset.prohouseTheme === '20261122')return;
    document.documentElement.dataset.prohouseTheme='20261122';
    new MutationObserver(queue).observe(document.body, {childList:true,subtree:true});
    apply();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
})();
